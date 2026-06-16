---
status: draft
last_reviewed: 2026-06-14
owner: '@raphaelfh'
supersedes: '009-extraction-excel-export'
---

# Publication-Ready Extraction .xlsx Export — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the extraction `.xlsx` export into a publication-ready, template-agnostic supplemental-material workbook whose values are correct across consensus / single-user / all-users modes — fixing the data-corruption, non-publishable-format, and duplicate-UI failures of the shipped 009 feature.

**Architecture:** A pure, no-IO sub-builder package (`app/services/exports/extraction/`) where each sheet is a `build_<sheet>(layout) -> SheetSpec` function rendered by one `workbook.py` orchestrator; a single envelope-aware `resolve_value` feeding every value map and the AI columns; snapshot-driven layout read from each Run's frozen template version (with obsolete-field diffing); structural-only styling; every reference-workbook formula baked to a static literal.

**Tech Stack:** Python 3.11+, SQLAlchemy 2.0 async, openpyxl, pytest (backend); React 19 + Vite + TanStack Query + in-house i18n, vitest + Playwright (frontend). Layering enforced by `scripts/fitness/check_layered_arch.py`.

> **Already shipped (do not re-plan):** the AI-proposal `id`-tiebreak determinism fix (spec §6.2 **A6**) + the empty-`instance_meta` crash guard landed in **[PR #291](https://github.com/raphaelfh/prumo/pull/291)**. Tasks below treat it as a completed prerequisite.

---


## File Structure

### Backend — new pure sub-builder package `backend/app/services/exports/extraction/`

| Path | Responsibility |
|---|---|
| `backend/app/services/exports/extraction/__init__.py` | Package marker; re-exports `build_workbook` and `SheetSpec` so callers import from the package root. |
| `backend/app/services/exports/extraction/workbook.py` | Orchestrator. Keeps the **PUBLIC** `build_workbook(layout: ExportLayout) -> bytes` signature unchanged (endpoint/worker/tests untouched). Creates the openpyxl `Workbook`, calls every `build_<sheet>(layout) -> SheetSpec | None` in spec order (§4), renders each non-`None` `SheetSpec` onto a worksheet via the shared `_render_sheet_spec(ws, spec)` writer, applies structural styling, runs the §5.5 column guard, returns bytes. |
| `backend/app/services/exports/extraction/sheet_spec.py` | Defines `SheetSpec` (the pure, openpyxl-free intermediate representation every sub-builder returns) plus its row/cell/merge/style value objects and the `_render_sheet_spec` openpyxl writer. The single place openpyxl is imported in the package. |
| `backend/app/services/exports/extraction/front_matter.py` | `build_front_matter(layout) -> SheetSpec` — README/Methods sheet (#1): template name+version, project, mode, `generated_at`, counts, generated contents list, glyph/sentinel legend, provenance caveats; absorbs today's `Notes` content incl. activated `obsolete_fields_per_article`. |
| `backend/app/services/exports/extraction/summary.py` | `build_summary(layout) -> SheetSpec` — Summary sheet (#2): one row per record (article, or article×model when a `MODEL_CONTAINER` exists), identity cols + per-record completeness + omitted-by-stage counts. |
| `backend/app/services/exports/extraction/matrix.py` | `build_matrix(layout) -> SheetSpec` — Extraction matrix (#3): fields-as-rows × record-columns, reviewer-axis fan-out, merged record headers, study-field repeat-not-merge. Lifts current `_write_main_sheet` logic verbatim first, then restyled (structural only). |
| `backend/app/services/exports/extraction/tidy_tables.py` | `build_tidy_tables(layout) -> list[SheetSpec]` — one records-as-rows sheet per section at its cardinality grain (§5.3); the publication "Table 1" sheets. |
| `backend/app/services/exports/extraction/appraisal_summary.py` | `build_appraisal_summary(layout) -> SheetSpec | None` — per-domain verdict + derived worst-case `Overall`, mode-aware (consensus/all-users/single-user, §7). Returns `None` when `layout.appraisal is None`. |
| `backend/app/services/exports/extraction/data_dictionary.py` | `build_data_dictionary(layout) -> SheetSpec` — one column-group per field: label·type·unit·description/`llm_description`·`allowed_values`·`is_required`·`allow_other` (§4 #k+2). |
| `backend/app/services/exports/extraction/dropdown_lists.py` | `build_dropdown_lists(layout) -> SheetSpec | None` — the dropdown catalogue projected from `FieldDictEntry.allowed_values`; merged into / co-located with the data dictionary per §4 ("doubles as the dropdown catalogue"). Returns `None` when no field carries `allowed_values`. |
| `backend/app/services/exports/extraction/ai_metadata.py` | `build_ai_metadata(layout) -> SheetSpec | None` — the optional AI-metadata sheet (#last), rebuilt for A1–A6 correctness; routes both AI value columns through the shared value resolver + format helper. Returns `None` when `not layout.include_ai_metadata`. |

### Backend — shared resolver + snapshot reader

| Path | Responsibility |
|---|---|
| `backend/app/services/exports/value_envelope.py` | **Shared value resolver.** `resolve_value(raw, *, field=None) -> ScalarOrStr` — the single envelope-aware unwrapper that replaces `_unwrap_value`; feeds every value map (consensus/single-user/all-users) and the AI value columns. Pure, no IO. Never returns a dict. |
| `backend/app/services/exports/extraction_snapshot_reader.py` | **Snapshot section reader.** `load_export_sections(db, *, version_id) -> tuple[SnapshotSection, ...]` — reads the frozen per-Run snapshot (`db.get(ExtractionTemplateVersion, version_id)` → `schema_["entity_types"]`, validated via `RunViewEntityType`/`RunViewField`) and the active-version anchor, returning ordered `SnapshotSection`s carrying role + cardinality + parent + full field metadata. Replaces the live-table `_load_sections`. Lives in `exports/` (not the package) because it does IO and is shared by the service. |

### Backend — modified

| Path | Responsibility |
|---|---|
| `backend/app/services/extraction_export_service.py` | Grow `FieldDescriptor`/`SectionDescriptor`/`ArticleDescriptor`/`ExportLayout` (new fields below); switch `_load_sections` to the snapshot reader; replace every `_unwrap_value` call site (`_build_consensus_value_map`, `_build_single_user_value_map`, `_build_all_users_value_map`, `_load_ai_proposal_rows`) with `resolve_value`; **delete** `_unwrap_value`; populate `obsolete_fields_per_article`; per-`entity_type` ordered study-instance lists (fix `study_instances.setdefault` collapse); rewrite `_infer_reviewer_outcome` (A2/A4) + thread `mode`/`reviewer_id` into `_load_ai_proposal_rows` (A3/A5/A6); particle-aware `_build_header_label`; remove the `NotImplementedError until US2/US3` / dead-`else` docstrings; build `tidy_tables`/`data_dictionary`/`front_matter`/`appraisal` onto `ExportLayout`. |
| `backend/app/services/exports/extraction_xlsx_builder.py` | **Delete** (replaced by the `extraction/` package). Its `build_workbook` import sites move to `app.services.exports.extraction.workbook` (or the package `__init__`). The silent `str(dict)` fallback in `_xlsx_safe` is removed in the process. |

### Frontend — deletions / edits

| Path | Responsibility |
|---|---|
| `frontend/components/extraction/ExtractionExport.tsx` | **Delete** (295-line legacy card). |
| `frontend/components/extraction/header/HeaderMoreMenu.tsx` | Remove the `ExtractionExport` import (line 23), the "Export Data" menu item (lines 233–236), and the Export `Dialog` block (lines 250–266) + `exportOpen` state; drop the now-dead `template`/`instances`/`values` props. |
| `frontend/components/extraction/ExtractionHeader.tsx` | Drop the now-dead `template`/`instances`/`values` props + their pass-through to `HeaderMoreMenu`. |
| `frontend/lib/copy/extraction.ts` | Delete the 29 orphaned legacy export copy keys + the 3 `moreExport*` keys (`moreExportData`, `moreExportDialogTitle`, `moreExportDialogDesc`). |
| `frontend/services/extractionExportService.ts` | Route `startExport` through the typed API client (`frontend/integrations/api/client.ts`); remove raw `fetch` + `import.meta.env.VITE_API_URL` + `supabase.auth` (frontend data-access rule). `ExtractionExportDialog.tsx` is **kept** (single entry point) — touched only if its `startExport` call shape changes. |

### Tests

| Path | Responsibility |
|---|---|
| `backend/tests/unit/test_value_envelope.py` | **New.** Unit tests for `resolve_value`: `None`, `{value}` (recursive/double-wrap), `{value,unit}`, `{selected,other_text}`, `{selected:[…],other_texts:[…]}`, list, scalar, `boolean`, `multiselect`, `"No information"` sentinel. |
| `backend/tests/unit/test_extraction_export_snapshot_sections.py` | **New.** Unit tests for `load_export_sections` shape + obsolete-field diff (anchor vs older-run snapshot). |
| `backend/tests/unit/test_extraction_matrix_builder.py` | **New** (split from `test_extraction_xlsx_builder.py`). Matrix sub-builder, incl. reviewer-axis fan-out + many-cardinality study fan-out + envelope cells. |
| `backend/tests/unit/test_extraction_tidy_tables_builder.py` | **New.** Per-section tidy table grain (one vs many cardinality), header ordering, baked values. |
| `backend/tests/unit/test_extraction_summary_builder.py` | **New.** Summary sheet rows + completeness. |
| `backend/tests/unit/test_extraction_appraisal_summary_builder.py` | **New.** Mode-aware `Overall` worst-case rollup (consensus / all-users per-reviewer / single-user). |
| `backend/tests/unit/test_extraction_data_dictionary_builder.py` | **New.** Field column-group + dropdown catalogue. |
| `backend/tests/unit/test_extraction_front_matter_builder.py` | **New.** README/Methods rows + obsolete-field legend. |
| `backend/tests/unit/test_extraction_ai_metadata_builder.py` | **New.** AI sheet value columns through resolver; outcome labels. |
| `backend/tests/unit/test_extraction_xlsx_builder.py` | **Rewrite/retarget** to the new `build_workbook` orchestrator (sheet order, column guard, empty-articles). |
| `backend/tests/unit/test_extraction_export_determinism.py` | **Extend** to the new sheets + a 500×100 / 16,384-column-guard case. |
| `backend/tests/unit/test_extraction_export_header_label.py` | **New.** Particle-aware surname ("De Feo" → "De Feo"). |
| `backend/tests/integration/test_extraction_export_snapshot_diff.py` | **New.** Snapshot-diff + obsolete-field path against real Supabase; scope by `project_id`. |
| `backend/tests/integration/test_extraction_export_many_cardinality_fanout.py` | **New.** Many-cardinality study-section fan-out (N instances, no collapse). |
| `backend/tests/integration/test_extraction_export_ai_outcome_ordering.py` | **Existing** (A6) — kept; extend for A2/A3/A4/A5. |
| `frontend/e2e/flows/extraction-export.e2e.ts` | **Update** to the single consolidated `ExtractionExportDialog` entry point. |

---

## Shared Interfaces & Types

All names are final. Slices reference them verbatim.

### 1. `resolve_value` — `backend/app/services/exports/value_envelope.py`

```python
from typing import Any
from app.services.extraction_export_service import FieldDescriptor  # type-only; or a Protocol

# An openpyxl-writable scalar. NEVER a dict, NEVER a list.
ResolvedScalar = str | int | float | bool | None

def resolve_value(raw: Any, *, field: "FieldDescriptor | None" = None) -> ResolvedScalar:
    """Resolve a persisted extraction value envelope to one openpyxl-writable scalar.

    This is the single envelope-aware resolver. It replaces the too-narrow
    ``_unwrap_value`` and is shared by every value map (consensus / single-user /
    all-users) and the AI-metadata value columns. It NEVER returns a dict or a
    list — every shape collapses to a scalar or ``str``, so no Python-repr dict
    string can ever reach a cell.

    Envelope contract (exhaustive — each shape verified against the write path):

      * ``None``                          -> ``None`` (blank cell).
      * scalar (str/int/float/bool)       -> returned unchanged.
      * ``{"value": <inner>}``            -> resolve(<inner>) RECURSIVELY, so the
                                             double-wrapped ``{"value": {"value": x}}``
                                             and ``{"value": {"value": n, "unit": u}}``
                                             produced by the decisions/proposals write
                                             path (section_extraction_service wraps
                                             ``{"value": inner}``) both collapse correctly.
      * ``{"value": <n>, "unit": <u>}``   -> the scalar with the unit surfaced:
                                             numeric value rendered then unit appended
                                             as ``"5 mg"``. ``field.unit`` is used as the
                                             fallback unit when the envelope omits one;
                                             the envelope ``unit`` wins when present.
                                             A null/empty unit yields the bare scalar.
      * ``{"selected": "other",
           "other_text": <t>}``           -> the free text ``<t>`` (single "other").
      * ``{"selected": [...],
           "other_texts": [...]}``        -> labels + other texts joined ``"; "``
                                             (multi "other").
      * ``list``                          -> non-null items joined ``"; "`` (multiselect).
      * the ``"No information"`` sentinel -> preserved verbatim.

    ``field`` is optional and used only for (a) the unit fallback and (b) boolean
    rendering (``True/False`` -> ``"Yes"/"No"``) when ``field.type`` is BOOLEAN.
    When ``field`` is ``None`` the resolver still produces a safe scalar (the
    AI-metadata value columns call it without a field for some rows, then route
    the result through the sheet's format helper).

    Unit surfacing rule: unit is appended to the rendered numeric scalar with a
    single space (``"5 mg"``); the result is a ``str`` whenever a unit is present,
    otherwise the native numeric type is preserved (typed cell).
    """
```

### 2. Sub-builder convention — `build_<sheet>(layout) -> SheetSpec`

**Chosen:** `build_<sheet>(layout: ExportLayout) -> SheetSpec | None` (returns a pure spec; never touches a `Workbook`).

**Justification:** the spec mandates "pure, no-IO sub-builders … testable without an openpyxl workbook" (§9). A `write_<sheet>(workbook, layout) -> None` convention forces every unit test to construct a real `Workbook` and re-read cells through `load_workbook`, coupling each test to openpyxl. Returning a `SheetSpec` lets sub-builder tests assert on plain Python rows/cells, confines openpyxl to one writer (`sheet_spec._render_sheet_spec`), and matches the multi-sheet sub-builders that must emit `list[SheetSpec]` (tidy tables) or `None` (conditional sheets). `workbook.py` owns the only openpyxl object.

```python
# backend/app/services/exports/extraction/sheet_spec.py
from dataclasses import dataclass, field
from typing import Any

CellValue = str | int | float | bool | None

@dataclass(frozen=True)
class CellStyle:
    """Structural-only styling (no conditional formatting — §9)."""
    bold: bool = False
    fill: str | None = None            # hex fill, e.g. "EEEEEE"; None = no fill
    align: str | None = None           # "left" | "center" | "right"
    wrap: bool = False

@dataclass(frozen=True)
class Cell:
    value: CellValue
    style: CellStyle | None = None

@dataclass(frozen=True)
class MergeSpan:
    """1-based inclusive merge range."""
    start_row: int
    start_col: int
    end_row: int
    end_col: int

@dataclass(frozen=True)
class SheetSpec:
    """Pure, openpyxl-free description of one worksheet."""
    title: str                                  # already sheet-name-safe (≤31, no forbidden chars)
    rows: tuple[tuple[Cell, ...], ...]          # row-major; ragged rows allowed
    merges: tuple[MergeSpan, ...] = ()
    column_widths: tuple[float | None, ...] = ()  # per-column; None = default
    freeze: str | None = None                   # openpyxl freeze ref, e.g. "C3"; None = no freeze
    tab_color: str | None = None                # hex tab colour or None
```

Sub-builder signatures (final):

```python
build_front_matter(layout: ExportLayout) -> SheetSpec
build_summary(layout: ExportLayout) -> SheetSpec
build_matrix(layout: ExportLayout) -> SheetSpec
build_tidy_tables(layout: ExportLayout) -> list[SheetSpec]
build_appraisal_summary(layout: ExportLayout) -> SheetSpec | None   # None when layout.appraisal is None
build_data_dictionary(layout: ExportLayout) -> SheetSpec
build_dropdown_lists(layout: ExportLayout) -> SheetSpec | None      # None when no allowed_values
build_ai_metadata(layout: ExportLayout) -> SheetSpec | None         # None when not include_ai_metadata
```

### 3. Snapshot section reader output — `backend/app/services/exports/extraction_snapshot_reader.py`

```python
from dataclasses import dataclass
from uuid import UUID
from app.models.extraction import ExtractionEntityRole, ExtractionCardinality, ExtractionFieldType

@dataclass(frozen=True)
class SnapshotField:
    """One field as frozen in the per-Run version snapshot (mirrors RunViewField)."""
    field_id: UUID
    name: str
    label: str
    type: ExtractionFieldType
    description: str | None
    llm_description: str | None
    unit: str | None
    allowed_values: tuple["AllowedValue", ...]   # value+label pairs, ordered
    is_required: bool
    allow_other: bool
    sort_order: int

@dataclass(frozen=True)
class AllowedValue:
    value: str
    label: str            # value == label in prumo (§11), but both preserved

@dataclass(frozen=True)
class SnapshotSection:
    """One entity_type as frozen in the snapshot (mirrors RunViewEntityType)."""
    entity_type_id: UUID
    name: str
    label: str
    role: ExtractionEntityRole
    cardinality: ExtractionCardinality
    parent_entity_type_id: UUID | None
    sort_order: int
    fields: tuple[SnapshotField, ...]

async def load_export_sections(
    db: AsyncSession,
    *,
    version_id: UUID,
) -> tuple[SnapshotSection, ...]:
    """Read the frozen entity_types tree for a Run's version snapshot, ordered by
    sort_order. Reads ``ExtractionTemplateVersion.schema_["entity_types"]`` and
    validates each via ``RunViewEntityType``/``RunViewField`` (same path the
    run-read service uses), falling back to the live tables only for a pre-0026
    narrow snapshot. This is the column-layout anchor (§5.1)."""
```

### 4. Grown `ExportLayout` + descriptor dataclasses — `backend/app/services/extraction_export_service.py`

**`FieldDescriptor`** — add 4 fields (all keep `frozen=True`):

```python
@dataclass(frozen=True)
class FieldDescriptor:
    field_id: UUID
    label: str
    type: ExtractionFieldType
    allowed_values: tuple[str, ...]
    parent_section_id: UUID
    # NEW (from snapshot):
    description: str | None = None          # field.description, falls back to llm_description in builders
    unit: str | None = None                 # field.unit — surfaced by resolve_value
    is_required: bool = False               # field.is_required
    allow_other: bool = False               # field.allow_other
```

**`SectionDescriptor`** — add `cardinality` (the fan-out key, §5.2) and ordered nesting:

```python
@dataclass(frozen=True)
class SectionDescriptor:
    entity_type_id: UUID
    label: str
    role: ExtractionEntityRole
    parent_entity_type_id: UUID | None
    fields: tuple[FieldDescriptor, ...]
    # NEW:
    cardinality: ExtractionCardinality = ExtractionCardinality.ONE   # drives tidy-table grain + fan-out
    sort_order: int = 0
    description: str | None = None
```

**`ArticleDescriptor`** — replace the single-instance `study_instances: dict[UUID, UUID]` collapse with **ordered per-entity_type instance lists** (fixes the §6 medium bug); keep `model_instances`:

```python
@dataclass(frozen=True)
class ArticleDescriptor:
    article_id: UUID
    header_label: str
    run_id: UUID | None
    run_stage: ExtractionRunStage | None
    version_id: UUID | None                 # NEW — the Run's snapshot, for per-Run obsolete-field diff
    model_instances: tuple[UUID, ...]
    # CHANGED: was dict[UUID, UUID] (kept only first instance). Now one ORDERED
    # list of instance ids per study/section entity_type for many-cardinality fan-out.
    section_instances: dict[UUID, tuple[UUID, ...]]
```

> Migration note for slices: `study_instances` is renamed to `section_instances` and its value type changes `UUID -> tuple[UUID, ...]`. Single-cardinality sections carry a 1-tuple. The matrix `_resolve_instance_id` and AI `instance_index_by_id` must iterate the tuple.

**New element dataclasses** (consumed by the grown `ExportLayout`):

```python
@dataclass(frozen=True)
class TidyTable:
    """One publication table at a section's cardinality grain (§5.3)."""
    section_id: UUID
    title: str                              # sheet-name-safe section label
    cardinality: ExtractionCardinality
    column_field_ids: tuple[UUID, ...]      # ordered by sort_order
    column_labels: tuple[str, ...]
    # one row per record; each row aligns to column_field_ids; values pre-resolved scalars
    rows: tuple["TidyRow", ...]

@dataclass(frozen=True)
class TidyRow:
    article_id: UUID
    instance_id: UUID | None                # the fanned-out instance for many; None for one
    record_label: str                       # e.g. "Gaca, 2011" or "Gaca, 2011 — Model 2"
    values: tuple[Any, ...]                 # aligned to TidyTable.column_field_ids, already resolved

@dataclass(frozen=True)
class FieldDictEntry:
    """One row of the Data dictionary / dropdown catalogue (§4 #k+2)."""
    field_id: UUID
    section_label: str
    label: str
    type: ExtractionFieldType
    unit: str | None
    description: str | None                 # description, else llm_description
    allowed_values: tuple[AllowedValue, ...]  # value+label
    is_required: bool
    allow_other: bool

@dataclass(frozen=True)
class FrontMatter:
    """README/Methods content (§4 #1) — absorbs the old Notes sheet."""
    project_name: str
    template_name: str
    template_version: int
    export_mode_label: str
    generated_at: datetime
    article_count: int
    record_count: int
    contents: tuple[str, ...]               # generated sheet-name list
    legend: tuple[tuple[str, str], ...]     # (glyph/sentinel, meaning)
    caveats: tuple[str, ...]                # provenance + best-effort-outcome caveats
    obsolete_fields_per_article: dict[UUID, tuple[str, ...]]  # activated §5.1

@dataclass(frozen=True)
class AppraisalModel:
    """Computed appraisal roll-up (§7); None on ExportLayout when no appraisal layer."""
    domain_section_ids: tuple[UUID, ...]    # the appraisal sections (one per domain)
    domain_labels: tuple[str, ...]
    rows: tuple["AppraisalRow", ...]

@dataclass(frozen=True)
class AppraisalRow:
    article_id: UUID
    record_label: str
    domain_verdicts: tuple[Any, ...]        # aligned to domain_labels, resolved
    overall: Any                            # worst-case rollup (consensus / single-user)
    per_reviewer_overall: dict[UUID, Any]   # all-users mode only; reviewer_id -> Overall
```

**`ExportLayout`** — add four resolved projections (back-compat defaults so existing `()`-arg call sites still construct):

```python
@dataclass(frozen=True)
class ExportLayout:
    project_name: str
    template_name: str
    template_version: int
    sections: tuple[SectionDescriptor, ...]
    articles: tuple[ArticleDescriptor, ...]
    reviewers: tuple[ReviewerDescriptor, ...]
    mode: ExportMode
    include_ai_metadata: bool
    anonymize_reviewer_names: bool
    notes: ExportNotes
    value_map: dict[tuple[Any, ...], Any]
    ai_proposal_rows: tuple[AIProposalRow, ...] = ()
    # NEW resolved projections (built in resolve_layout):
    tidy_tables: tuple[TidyTable, ...] = ()
    data_dictionary: tuple[FieldDictEntry, ...] = ()
    front_matter: FrontMatter | None = None
    appraisal: AppraisalModel | None = None   # None => appraisal_summary sheet omitted (§7)
```

`ExportNotes.obsolete_fields_per_article` (already declared, currently unpopulated) is now populated by `resolve_layout` and surfaced through `FrontMatter.obsolete_fields_per_article`.

### Key invariants slices must hold

- `resolve_value` is the **only** unwrapper; `_unwrap_value` is deleted. The matrix/tidy/appraisal/AI builders all consume already-resolved scalars from `value_map`/`TidyRow.values`/`AppraisalRow` — they never re-handle envelopes, and `_xlsx_safe`'s silent `str(dict)` fallback is removed.
- Fan-out key is `SectionDescriptor.cardinality == ExtractionCardinality.MANY` for **any** role (§5.2) — never a `role == MODEL_SECTION` allow-list.
- Column layout comes from `load_export_sections(db, version_id=...)` (snapshot), not the live `extraction_entity_types`/`extraction_fields` tables.
- All-users value-map keys stay 4-tuple `(run_id, instance_id, field_id, reviewer_id|None)`; consensus/single-user stay 3-tuple — unchanged by this redesign.

**Authoritative files referenced above (absolute paths):**
- `backend/app/services/extraction_export_service.py`
- `backend/app/services/exports/extraction_xlsx_builder.py` (to delete)
- `backend/app/services/extraction_snapshot.py`
- `backend/app/services/extraction_run_read_service.py` (snapshot-read pattern to mirror)
- `backend/app/schemas/extraction_run.py` (`RunViewEntityType`/`RunViewField`)


---

## Phase S1 — Envelope-aware value resolver

### Task 1: Create the envelope-aware `resolve_value` resolver (pure, no IO)

**Files:**
- Create: `backend/app/services/exports/value_envelope.py`
- Test: `backend/tests/unit/test_value_envelope.py`

A structural `_FieldLike` Protocol keeps the resolver dependency-free (avoids the `value_envelope` → `extraction_export_service` → builder import cycle). `FieldDescriptor` already satisfies it duck-typed once it grows `unit`/`type` (a later slice); for this slice the resolver reads `.type` and `.unit` defensively via `getattr`.

- [ ] **Step 1: Write the failing unit-test module.** Create `backend/tests/unit/test_value_envelope.py` covering every envelope shape from the §6 contract. This file imports `resolve_value` which does not exist yet, so collection fails.

```python
"""Unit tests for the envelope-aware export value resolver.

Pure-function tests — no DB, no openpyxl. Each case maps to one row of
the §6 / §6.2-A1 envelope contract in the redesign spec.
"""

from __future__ import annotations

from dataclasses import dataclass

import pytest

from app.models.extraction import ExtractionFieldType
from app.services.exports.value_envelope import resolve_value


@dataclass(frozen=True)
class _Field:
    """Minimal structural stand-in for FieldDescriptor (type + unit)."""

    type: ExtractionFieldType
    unit: str | None = None


def test_none_returns_none() -> None:
    assert resolve_value(None) is None


def test_scalar_passthrough() -> None:
    assert resolve_value("hello") == "hello"
    assert resolve_value(5) == 5
    assert resolve_value(3.14) == 3.14


def test_single_wrap_value() -> None:
    assert resolve_value({"value": "x"}) == "x"
    assert resolve_value({"value": 7}) == 7


def test_double_wrapped_value() -> None:
    # Decisions/proposals write path wraps {"value": inner}; inner may be
    # itself a {"value": ...} or a {"value", "unit"} envelope.
    assert resolve_value({"value": {"value": "deep"}}) == "deep"


def test_value_unit_appends_unit() -> None:
    field = _Field(type=ExtractionFieldType.NUMBER, unit=None)
    assert resolve_value({"value": 5, "unit": "mg"}, field=field) == "5 mg"


def test_double_wrapped_value_unit() -> None:
    field = _Field(type=ExtractionFieldType.NUMBER)
    assert resolve_value({"value": {"value": 5, "unit": "mg"}}, field=field) == "5 mg"


def test_value_unit_falls_back_to_field_unit() -> None:
    field = _Field(type=ExtractionFieldType.NUMBER, unit="kg")
    # Envelope omits unit → field.unit is used.
    assert resolve_value({"value": 12}, field=field) == "12 kg"


def test_envelope_unit_wins_over_field_unit() -> None:
    field = _Field(type=ExtractionFieldType.NUMBER, unit="kg")
    assert resolve_value({"value": 5, "unit": "mg"}, field=field) == "5 mg"


def test_empty_unit_yields_bare_scalar() -> None:
    field = _Field(type=ExtractionFieldType.NUMBER, unit=None)
    assert resolve_value({"value": 9, "unit": ""}, field=field) == 9
    assert resolve_value({"value": 9, "unit": None}, field=field) == 9


def test_single_other() -> None:
    assert resolve_value({"selected": "other", "other_text": "freetext"}) == "freetext"


def test_multi_other_joins_labels_and_texts() -> None:
    raw = {"selected": ["a", "b"], "other_texts": ["c", "d"]}
    assert resolve_value(raw) == "a; b; c; d"


def test_multi_other_empty_other_texts() -> None:
    raw = {"selected": ["a", "b"], "other_texts": []}
    assert resolve_value(raw) == "a; b"


def test_list_multiselect_joins() -> None:
    assert resolve_value(["a", "b", None, "c"]) == "a; b; c"


def test_boolean_rendering_with_field() -> None:
    field = _Field(type=ExtractionFieldType.BOOLEAN)
    assert resolve_value({"value": True}, field=field) == "Yes"
    assert resolve_value({"value": False}, field=field) == "No"


def test_boolean_without_field_is_native_bool() -> None:
    # No field context → leave the native bool for the format helper.
    assert resolve_value({"value": True}) is True


def test_no_information_sentinel_preserved() -> None:
    assert resolve_value("No information") == "No information"
    assert resolve_value({"value": "No information"}) == "No information"


def test_never_returns_dict() -> None:
    # Any unexpected dict shape must NOT leak as a Python-repr str of dict;
    # it collapses to a deterministic key:value rendering.
    out = resolve_value({"unexpected": 1, "shape": 2})
    assert not isinstance(out, dict)
    assert isinstance(out, str)
```

- [ ] **Step 2: Run the test, expect FAIL (ModuleNotFoundError).**
  Command (from `backend/`): `uv run pytest tests/unit/test_value_envelope.py -q`
  Expected: `ModuleNotFoundError: No module named 'app.services.exports.value_envelope'` (collection error, 0 passed).

- [ ] **Step 3: Implement `resolve_value` with COMPLETE code.** Create `backend/app/services/exports/value_envelope.py`:

```python
"""Envelope-aware value resolver for extraction exports.

The single source of truth for collapsing a persisted extraction value
envelope to one openpyxl-writable scalar. It replaces the too-narrow
``_unwrap_value`` and is shared by every value map (consensus /
single-user / all-users) and the AI-metadata value columns.

PURE: no DB, no storage, no network, no openpyxl. Layer-legal (services,
no IO) under ``scripts/fitness/check_layered_arch.py``.

Key invariant: ``resolve_value`` NEVER returns a ``dict`` and NEVER
returns a raw ``list`` — every envelope shape collapses to a scalar or
``str``, so no Python-repr dict string can ever reach a worksheet cell.
"""

from __future__ import annotations

from typing import Any, Protocol, runtime_checkable

from app.models.extraction import ExtractionFieldType

# An openpyxl-writable scalar. NEVER a dict, NEVER a list.
ResolvedScalar = str | int | float | bool | None


@runtime_checkable
class _FieldLike(Protocol):
    """Structural view of FieldDescriptor used by the resolver.

    Declared structurally to keep this module free of an import cycle
    with ``extraction_export_service`` (which the builder imports from).
    ``FieldDescriptor`` satisfies it once it carries ``type`` + ``unit``.
    """

    type: ExtractionFieldType
    unit: str | None


def resolve_value(raw: Any, *, field: _FieldLike | None = None) -> ResolvedScalar:
    """Resolve a persisted value envelope to one openpyxl-writable scalar.

    See the redesign spec §6 / §6.2-A1 for the exhaustive shape contract.
    Never returns a dict or a list.
    """
    if raw is None:
        return None

    # --- Recursive single-wrap {"value": inner} ---------------------------
    # Handles {"value": x}, double-wrapped {"value": {"value": x}}, and
    # {"value": {"value": n, "unit": u}} from the decisions/proposals write
    # path (section_extraction_service wraps {"value": inner}).
    if isinstance(raw, dict) and set(raw.keys()) == {"value"}:
        return resolve_value(raw["value"], field=field)

    # --- number+unit {"value": n, "unit": u} ------------------------------
    if isinstance(raw, dict) and set(raw.keys()) == {"value", "unit"}:
        inner = resolve_value(raw["value"], field=field)
        unit = raw.get("unit")
        return _apply_unit(inner, unit, field)

    # --- single "other" {"selected": "other", "other_text": t} ------------
    if (
        isinstance(raw, dict)
        and raw.get("selected") == "other"
        and "other_text" in raw
    ):
        text = raw.get("other_text")
        return str(text) if text is not None else None

    # --- multi "other" {"selected": [...], "other_texts": [...]} ----------
    if (
        isinstance(raw, dict)
        and isinstance(raw.get("selected"), list)
        and isinstance(raw.get("other_texts"), list)
    ):
        parts = [
            str(item)
            for item in [*raw["selected"], *raw["other_texts"]]
            if item is not None
        ]
        return "; ".join(parts)

    # --- any other dict shape — collapse deterministically, never leak ----
    if isinstance(raw, dict):
        return "; ".join(f"{k}: {v}" for k, v in raw.items())

    # --- list (multiselect) ----------------------------------------------
    if isinstance(raw, list):
        return "; ".join(str(item) for item in raw if item is not None)

    # --- scalar ----------------------------------------------------------
    if field is not None and getattr(field, "type", None) is ExtractionFieldType.BOOLEAN:
        if isinstance(raw, bool):
            return "Yes" if raw else "No"

    return raw


def _apply_unit(
    inner: ResolvedScalar,
    envelope_unit: Any,
    field: _FieldLike | None,
) -> ResolvedScalar:
    """Append a unit to a numeric scalar (``"5 mg"``); bare scalar otherwise.

    Envelope ``unit`` wins; ``field.unit`` is the fallback. A null/empty
    unit yields the bare scalar (native numeric type preserved).
    """
    unit = envelope_unit
    if unit is None or unit == "":
        unit = getattr(field, "unit", None) if field is not None else None
    if unit is None or unit == "":
        return inner
    if inner is None:
        return None
    return f"{inner} {unit}"
```

- [ ] **Step 4: Run the test, expect PASS.**
  Command (from `backend/`): `uv run pytest tests/unit/test_value_envelope.py -q`
  Expected: all tests pass (17 passed).

- [ ] **Step 5: Lint + format the new files.**
  Command (from `backend/`): `uv run ruff check app/services/exports/value_envelope.py tests/unit/test_value_envelope.py && uv run ruff format app/services/exports/value_envelope.py tests/unit/test_value_envelope.py`
  Expected: `All checks passed!` and files left formatted.

- [ ] **Step 6: Commit.**
  `git add backend/app/services/exports/value_envelope.py backend/tests/unit/test_value_envelope.py && git commit -m "feat(export): add envelope-aware resolve_value resolver

Single source of truth that collapses every persisted extraction value
envelope ({value}, {value,unit}, single/multi other, double-wrapped) to
one openpyxl-writable scalar. Never returns a dict/list, so no Python
-repr dict string can reach a worksheet cell. Pure, no IO.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"`

---

### Task 2: Grow `FieldDescriptor` with `type`-compatible `unit` so `resolve_value(field=...)` surfaces units

This slice needs `FieldDescriptor` to carry `unit` (and already carries `type`) so the value-map builders and AI columns can pass it to `resolve_value`. `FieldDescriptor.type` already exists; add `unit` with a back-compat default. (The fuller `description`/`is_required`/`allow_other` growth belongs to the snapshot-reader slice; this slice adds only `unit`, the field the resolver reads.)

**Files:**
- Modify: `backend/app/services/extraction_export_service.py` (`FieldDescriptor` @72-80)
- Test: `backend/tests/unit/test_value_envelope.py` (extend with a real-`FieldDescriptor` case)

- [ ] **Step 1: Add a failing test that drives `resolve_value` with a real `FieldDescriptor`.** Append to `backend/tests/unit/test_value_envelope.py`:

```python
def test_resolves_with_real_field_descriptor_unit() -> None:
    from uuid import uuid4

    from app.services.extraction_export_service import FieldDescriptor

    fd = FieldDescriptor(
        field_id=uuid4(),
        label="Dose",
        type=ExtractionFieldType.NUMBER,
        allowed_values=(),
        parent_section_id=uuid4(),
        unit="mg",
    )
    # Envelope omits unit → FieldDescriptor.unit fills it in.
    assert resolve_value({"value": 5}, field=fd) == "5 mg"
```

- [ ] **Step 2: Run the test, expect FAIL (TypeError unexpected kwarg `unit`).**
  Command (from `backend/`): `uv run pytest tests/unit/test_value_envelope.py::test_resolves_with_real_field_descriptor_unit -q`
  Expected: `TypeError: __init__() got an unexpected keyword argument 'unit'`.

- [ ] **Step 3: Add `unit` to `FieldDescriptor`.** Edit the dataclass (`extraction_export_service.py` @72-80) from:

```python
@dataclass(frozen=True)
class FieldDescriptor:
    """One field within an entity_type (= one row on the main sheet)."""

    field_id: UUID
    label: str
    type: ExtractionFieldType
    allowed_values: tuple[str, ...]
    parent_section_id: UUID
```

to:

```python
@dataclass(frozen=True)
class FieldDescriptor:
    """One field within an entity_type (= one row on the main sheet)."""

    field_id: UUID
    label: str
    type: ExtractionFieldType
    allowed_values: tuple[str, ...]
    parent_section_id: UUID
    # Surfaced by ``resolve_value`` as the fallback unit for number+unit
    # envelopes that omit their own ``unit`` (e.g. ``5`` -> ``"5 mg"``).
    unit: str | None = None
```

- [ ] **Step 4: Run the test, expect PASS.**
  Command (from `backend/`): `uv run pytest tests/unit/test_value_envelope.py -q`
  Expected: all pass (18 passed).

- [ ] **Step 5: Lint + format.**
  Command (from `backend/`): `uv run ruff check app/services/extraction_export_service.py tests/unit/test_value_envelope.py && uv run ruff format app/services/extraction_export_service.py tests/unit/test_value_envelope.py`
  Expected: `All checks passed!`.

- [ ] **Step 6: Commit.**
  `git add backend/app/services/extraction_export_service.py backend/tests/unit/test_value_envelope.py && git commit -m "feat(export): add unit field to FieldDescriptor for resolver

resolve_value uses FieldDescriptor.unit as the fallback unit when a
number+unit envelope omits its own unit. Back-compat default None.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"`

---

### Task 3: Route the four value-map call sites through `resolve_value` (replace `_unwrap_value`)

Replace `_unwrap_value` in the consensus (@666), single-user (@833-835), and all-users (@1098, @1131-1133) value maps with `resolve_value`, passing the field descriptor so units surface. The value maps are keyed by `field_id`, so each builder needs a `field_id → FieldDescriptor` lookup threaded in.

**Files:**
- Modify: `backend/app/services/extraction_export_service.py` (`_build_consensus_value_map` @642, `_build_single_user_value_map` @783, `_build_all_users_value_map` @1062; their call sites in `resolve_layout`/`_resolve_*`)
- Test: `backend/tests/integration/test_extraction_export_value_resolution.py` (new)

First confirm the call sites pass a `sections`/field map. Read the call sites before editing.

- [ ] **Step 1: Read the three value-map builder call sites.** Run, from repo root: `grep -n "_build_consensus_value_map\|_build_single_user_value_map\|_build_all_users_value_map" backend/app/services/extraction_export_service.py` — note each caller so the `fields_by_id` argument can be threaded from the already-resolved `sections`. (No code yet; this is a read step to pin the exact caller signatures.)

- [ ] **Step 2: Write a failing integration test for unit/other value rendering in consensus mode.** Create `backend/tests/integration/test_extraction_export_value_resolution.py`, mirroring the run/instance/published-state setup of `test_extraction_manual_only_flow.py`, scoping all queries by `project_id`. It seeds a published state whose `value` is the double-wrapped `{"value": {"value": 5, "unit": "mg"}}` shape and a single-"other" shape, builds the layout via `ExtractionExportService.resolve_layout`, and asserts the resulting `value_map` entries are the resolved scalars `"5 mg"` and the free text — NOT a dict.

```python
"""Integration: number+unit and 'other' envelopes resolve to scalars.

Regression for the §6 dict-leak: real persisted envelopes
({value,unit}, double-wrapped, single 'other') must reach the
ExportLayout.value_map as openpyxl-writable scalars, never dicts.
"""

from __future__ import annotations

import pytest

from app.services.extraction_export_service import ExportMode, ExtractionExportService

pytestmark = pytest.mark.asyncio


async def test_consensus_value_map_resolves_unit_and_other(
    db_session,
    seeded_export_fixture,  # builds a finalized run + published states; see helper below
):
    """value_map carries '5 mg' (number+unit) and the free text (single
    other), never a dict."""
    fx = seeded_export_fixture
    service = ExtractionExportService(db_session, storage=fx.storage)

    layout = await service.resolve_layout(
        project_id=fx.project_id,
        template_id=fx.template_id,
        mode=ExportMode.CONSENSUS,
        article_ids=[fx.article_id],
        include_ai_metadata=False,
        requesting_user_id=fx.manager_id,
    )

    key_unit = (fx.run_id, fx.instance_id, fx.number_field_id)
    key_other = (fx.run_id, fx.instance_id, fx.select_field_id)
    assert layout.value_map[key_unit] == "5 mg"
    assert layout.value_map[key_other] == fx.expected_other_text
    for v in layout.value_map.values():
        assert not isinstance(v, dict)
```

> **Plan note for the implementer:** the exact `seeded_export_fixture` helper + `resolve_layout` keyword names must be read from `test_extraction_manual_only_flow.py` and the live `resolve_layout` signature before writing — reuse that file's run/instance/proposal/published-state setup verbatim and scope by `project_id`. If `resolve_layout`'s real signature differs, adapt the call; the assertion (scalars not dicts) is the load-bearing part.

- [ ] **Step 3: Run the test, expect FAIL (value is a dict / mismatched scalar).**
  Command (from `backend/`): `uv run pytest tests/integration/test_extraction_export_value_resolution.py -q`
  Expected: assertion failure — `value_map[key_unit]` is the dict `{'value': {'value': 5, 'unit': 'mg'}}` (or `{'value': 5, 'unit': 'mg'}`) rather than `"5 mg"` (because `_unwrap_value` only unwraps single-key `{value}`).

- [ ] **Step 4: Thread `fields_by_id` into `_build_consensus_value_map` and swap to `resolve_value`.** In `extraction_export_service.py`, add the import atomically and change the builder. Edit `_build_consensus_value_map` signature + body (@642-668):

```python
    async def _build_consensus_value_map(
        self,
        *,
        run_ids: list[UUID],
        fields_by_id: dict[UUID, FieldDescriptor],
    ) -> dict[tuple[Any, ...], Any]:
        """Bulk-fetch all published values for the given runs (FR-013).

        Single query: ``SELECT … FROM extraction_published_states WHERE
        run_id IN :run_ids``. Result keyed by
        ``(run_id, instance_id, field_id) -> resolved scalar``.
        """
        if not run_ids:
            return {}
        rows = (
            await self.db.execute(
                select(
                    ExtractionPublishedState.run_id,
                    ExtractionPublishedState.instance_id,
                    ExtractionPublishedState.field_id,
                    ExtractionPublishedState.value,
                ).where(ExtractionPublishedState.run_id.in_(run_ids))
            )
        ).all()
        return {
            (run_id, instance_id, field_id): resolve_value(
                value, field=fields_by_id.get(field_id)
            )
            for run_id, instance_id, field_id, value in rows
        }
```

Add the import near the top of the file (with the other `app.services` imports), landed atomically with this edit:

```python
from app.services.exports.value_envelope import resolve_value
```

- [ ] **Step 5: Swap single-user + all-users builders.** Add `fields_by_id` to `_build_single_user_value_map` (@783) and `_build_all_users_value_map` (@1062), then replace each `_unwrap_value(...)`:

In `_build_single_user_value_map` (signature gains `fields_by_id: dict[UUID, FieldDescriptor]`), change the loop body (@830-837) to:

```python
        out: dict[tuple[Any, ...], Any] = {}
        for rid, iid, fid, decision, value, proposed_value in rows:
            field = fields_by_id.get(fid)
            if decision == "accept_proposal":
                out[(rid, iid, fid)] = resolve_value(proposed_value, field=field)
            elif decision == "edit":
                out[(rid, iid, fid)] = resolve_value(value, field=field)
            # reject → key absent (renders blank)
        return out
```

In `_build_all_users_value_map` (signature gains `fields_by_id: dict[UUID, FieldDescriptor]`), change the consensus loop (@1097-1098):

```python
        for rid, iid, fid, value in consensus_rows:
            out[(rid, iid, fid, None)] = resolve_value(value, field=fields_by_id.get(fid))
```

and the per-reviewer loop (@1129-1133):

```python
        for rid, iid, fid, reviewer_id, decision, value, proposed in rev_rows:
            field = fields_by_id.get(fid)
            if decision == "accept_proposal":
                out[(rid, iid, fid, reviewer_id)] = resolve_value(proposed, field=field)
            elif decision == "edit":
                out[(rid, iid, fid, reviewer_id)] = resolve_value(value, field=field)
        return out
```

- [ ] **Step 6: Build `fields_by_id` at the call sites and pass it.** At each place `resolve_layout` calls these three builders (found in Step 1), construct `fields_by_id = {f.field_id: f for s in sections for f in s.fields}` once from the already-resolved `sections` tuple and pass it as the new keyword argument. Use the real variable name for the resolved sections at that call site.

- [ ] **Step 7: Run the new integration test, expect PASS.**
  Command (from `backend/`): `uv run pytest tests/integration/test_extraction_export_value_resolution.py -q`
  Expected: pass — `value_map[key_unit] == "5 mg"`, no dict values.

- [ ] **Step 8: Run the full export service unit + integration suite to catch caller breakage.**
  Command (from `backend/`): `uv run pytest tests/unit/test_extraction_xlsx_builder.py tests/unit/test_extraction_export_determinism.py tests/integration/test_extraction_export_ai_outcome_ordering.py -q`
  Expected: green (the call sites are updated; no `_unwrap_value` regressions). If any test constructs `FieldDescriptor` positionally and breaks on the new `unit` default, it won't (default is last + optional).

- [ ] **Step 9: Lint + format.**
  Command (from `backend/`): `uv run ruff check app/services/extraction_export_service.py tests/integration/test_extraction_export_value_resolution.py && uv run ruff format app/services/extraction_export_service.py tests/integration/test_extraction_export_value_resolution.py`
  Expected: `All checks passed!`.

- [ ] **Step 10: Commit.**
  `git add backend/app/services/extraction_export_service.py backend/tests/integration/test_extraction_export_value_resolution.py && git commit -m "fix(export): resolve value-map envelopes via resolve_value

Replaces the too-narrow _unwrap_value in the consensus, single-user and
all-users value maps with the envelope-aware resolve_value, threading
the FieldDescriptor so number+unit surfaces (e.g. '5 mg') and single/
multi 'other' + double-wrapped shapes no longer leak as dict strings.
Fixes the per-reviewer/matrix value corruption.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"`

---

### Task 4: Route both AI value columns through `resolve_value` (A1)

Replace `_unwrap_value(proposed_value)` at @1334 for `ai_proposed_value`, and resolve `final_value_used` consistently. The `final_value_used` already comes from `value_map` (now resolved scalars from the prior task), so it needs no re-resolution — but `ai_proposed_value` is read raw from `ExtractionProposalRecord.proposed_value` and must go through `resolve_value` with the field's descriptor.

**Files:**
- Modify: `backend/app/services/extraction_export_service.py` (`_load_ai_proposal_rows` @1140-1345, building `field_descriptor_by_id`)
- Test: `backend/tests/integration/test_extraction_export_ai_outcome_ordering.py` (extend) OR new focused test `test_extraction_export_ai_value_resolution.py`

- [ ] **Step 1: Write a failing test for the AI `ai_proposed_value` column.** Create `backend/tests/integration/test_extraction_export_ai_value_resolution.py`. Seed an AI proposal whose `proposed_value` is `{"value": {"value": 5, "unit": "mg"}}` (the real double-wrapped write-path shape), call `_load_ai_proposal_rows` (or `resolve_layout` with `include_ai_metadata=True`), and assert the produced `AIProposalRow.ai_proposed_value == "5 mg"` and is not a dict. Mirror the proposal-record setup pattern from `test_extraction_export_ai_outcome_ordering.py` and scope by `project_id`.

```python
"""Integration: AI-metadata value columns resolve envelopes (A1).

The 'AI proposed value' column must surface number+unit/other scalars,
never a Python-repr dict (the reported AI-metadata bug)."""

from __future__ import annotations

import pytest

from app.services.extraction_export_service import ExportMode, ExtractionExportService

pytestmark = pytest.mark.asyncio


async def test_ai_proposed_value_resolves_number_unit(
    db_session,
    seeded_ai_export_fixture,  # finalized run + one AI proposal_record; reuse A6 helper
):
    fx = seeded_ai_export_fixture
    service = ExtractionExportService(db_session, storage=fx.storage)

    layout = await service.resolve_layout(
        project_id=fx.project_id,
        template_id=fx.template_id,
        mode=ExportMode.CONSENSUS,
        article_ids=[fx.article_id],
        include_ai_metadata=True,
        requesting_user_id=fx.manager_id,
    )

    rows = layout.ai_proposal_rows
    assert rows, "expected at least one AI proposal row"
    target = next(r for r in rows if r.field_label == fx.number_field_label)
    assert target.ai_proposed_value == "5 mg"
    for r in rows:
        assert not isinstance(r.ai_proposed_value, dict)
        assert not isinstance(r.final_value_used, dict)
```

> **Plan note:** reuse the exact proposal-record + evidence seeding helper already present in `test_extraction_export_ai_outcome_ordering.py`; only the `proposed_value` payload and field-type (NUMBER + unit "mg") differ. Read that file before writing to copy its fixture names.

- [ ] **Step 2: Run, expect FAIL.**
  Command (from `backend/`): `uv run pytest tests/integration/test_extraction_export_ai_value_resolution.py -q`
  Expected: `ai_proposed_value` is `{'value': {'value': 5, 'unit': 'mg'}}` (a dict), not `"5 mg"`.

- [ ] **Step 3: Build a `field_descriptor_by_id` map in `_load_ai_proposal_rows` and resolve the AI value.** Inside `_load_ai_proposal_rows`, after `field_label_by_id` is built (@1172-1174), add a descriptor lookup, then swap the `ai_proposed_value` line (@1334). Add near @1172:

```python
        field_desc_by_id: dict[UUID, FieldDescriptor] = {
            f.field_id: f for s in sections for f in s.fields
        }
```

Change the `AIProposalRow(...)` construction (@1329-1342) line for `ai_proposed_value`:

```python
                ai_proposed_value=resolve_value(
                    proposed_value, field=field_desc_by_id.get(fid)
                ),
```

`final_value_used=final_value` stays unchanged: `final_value` is read from `value_map`, which the previous task already populated with resolved scalars.

- [ ] **Step 4: Run the AI value test, expect PASS.**
  Command (from `backend/`): `uv run pytest tests/integration/test_extraction_export_ai_value_resolution.py -q`
  Expected: pass — `ai_proposed_value == "5 mg"`, no dict in either value column.

- [ ] **Step 5: Lint + format.**
  Command (from `backend/`): `uv run ruff check app/services/extraction_export_service.py tests/integration/test_extraction_export_ai_value_resolution.py && uv run ruff format app/services/extraction_export_service.py tests/integration/test_extraction_export_ai_value_resolution.py`
  Expected: `All checks passed!`.

- [ ] **Step 6: Commit.**
  `git add backend/app/services/extraction_export_service.py backend/tests/integration/test_extraction_export_ai_value_resolution.py && git commit -m "fix(export): resolve AI-metadata value columns via resolve_value (A1)

The 'AI proposed value' column read proposed_value raw and leaked
number+unit/other/double-wrapped envelopes as dict strings. Route it
through resolve_value with the field descriptor; 'Final value used'
already comes resolved from value_map.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"`

---

### Task 5: Add a shared format helper so AI value columns and matrix cells render identically

Currently the matrix routes cells through `_format_cell(value, field)` (builder) while the AI sheet writes `astuple(row)` straight to `_xlsx_safe`, bypassing field-type context — the structural reason A1 is "more exposed." Introduce one shared `format_export_scalar` in `value_envelope.py` that normalizes a resolved scalar for a worksheet cell (boolean→Yes/No when field present, datetime tz-strip, list-join safety) and route both `_format_cell` and the AI value columns through it. Because values arrive already resolved, this helper handles only the residual cell-shaping; it must NEVER receive a dict.

**Files:**
- Modify: `backend/app/services/exports/value_envelope.py` (add `format_export_scalar`)
- Modify: `backend/app/services/exports/extraction_xlsx_builder.py` (`_format_cell` @275, AI sheet writer @309-343)
- Test: `backend/tests/unit/test_value_envelope.py` (extend) + `backend/tests/unit/test_extraction_xlsx_builder.py` (AI-sheet cell assertion)

- [ ] **Step 1: Add a failing unit test for `format_export_scalar`.** Append to `backend/tests/unit/test_value_envelope.py`:

```python
def test_format_export_scalar_boolean_with_field() -> None:
    from app.services.exports.value_envelope import format_export_scalar

    field = _Field(type=ExtractionFieldType.BOOLEAN)
    assert format_export_scalar(True, field=field) == "Yes"
    assert format_export_scalar(False, field=field) == "No"


def test_format_export_scalar_strips_tzinfo() -> None:
    from datetime import UTC, datetime

    from app.services.exports.value_envelope import format_export_scalar

    aware = datetime(2026, 6, 14, 12, 0, tzinfo=UTC)
    out = format_export_scalar(aware)
    assert out.tzinfo is None


def test_format_export_scalar_passthrough_scalar() -> None:
    from app.services.exports.value_envelope import format_export_scalar

    assert format_export_scalar("5 mg") == "5 mg"
    assert format_export_scalar(7) == 7
    assert format_export_scalar(None) is None
```

- [ ] **Step 2: Run, expect FAIL (ImportError).**
  Command (from `backend/`): `uv run pytest tests/unit/test_value_envelope.py -k format_export_scalar -q`
  Expected: `ImportError: cannot import name 'format_export_scalar'`.

- [ ] **Step 3: Implement `format_export_scalar` in `value_envelope.py`.** Append:

```python
def format_export_scalar(value: ResolvedScalar, *, field: _FieldLike | None = None) -> Any:
    """Shape an ALREADY-RESOLVED scalar for an openpyxl cell.

    Shared by the matrix cells and the AI-metadata value columns so
    number+unit / select / multiselect / boolean render consistently.
    Must NEVER receive a dict — ``resolve_value`` is the only unwrapper
    and is always applied first; a dict here is a programming error and
    is allowed to raise downstream rather than be silently stringified.

    * ``bool`` + BOOLEAN field -> ``"Yes"``/``"No"`` (idempotent: a
      pre-resolved ``"Yes"`` passes through).
    * tz-aware ``datetime`` -> naive (openpyxl rejects tz-aware).
    * everything else -> returned unchanged (scalars are already final).
    """
    from datetime import datetime as _dt

    if value is None:
        return None
    if (
        isinstance(value, bool)
        and field is not None
        and getattr(field, "type", None) is ExtractionFieldType.BOOLEAN
    ):
        return "Yes" if value else "No"
    if isinstance(value, _dt) and value.tzinfo is not None:
        return value.replace(tzinfo=None)
    return value
```

Add `format_export_scalar` to `__all__` if the module declares one (add the export line atomically with the function).

- [ ] **Step 4: Run the helper tests, expect PASS.**
  Command (from `backend/`): `uv run pytest tests/unit/test_value_envelope.py -k format_export_scalar -q`
  Expected: 3 passed.

- [ ] **Step 5: Route the matrix `_format_cell` and the AI value columns through it.** In `extraction_xlsx_builder.py`, import the helper atomically and rewrite `_format_cell` (@275-301) to delegate the residual shaping, then change the AI sheet writer (@337-343) to resolve+format the two value columns rather than blindly `_xlsx_safe(astuple)`.

Replace `_format_cell` body (@275-301):

```python
def _format_cell(value: Any, field: FieldDescriptor) -> Any:
    """Type-aware cell formatting for an ALREADY-RESOLVED matrix value.

    Values arrive pre-resolved from ``resolve_value`` (no dicts). This
    only applies the residual openpyxl-cell shaping shared with the AI
    sheet via ``format_export_scalar``; multiselect lists (if any survive
    as lists) are joined here.
    """
    if value is None:
        return None
    if isinstance(value, list):
        return "; ".join(str(item) for item in value if item is not None)
    return format_export_scalar(value, field=field)
```

Add the import atomically (top of builder, with the other `app.services.exports` imports):

```python
from app.services.exports.value_envelope import format_export_scalar
```

In `_write_ai_metadata_sheet`, the value columns "AI proposed value" (index 5) and "Final value used" (index 12) must be shaped through `format_export_scalar` instead of the generic `_xlsx_safe`. Replace the body loop (@337-343):

```python
    rows: tuple[AIProposalRow, ...] = getattr(layout, "ai_proposal_rows", ()) or ()
    body_row = 2
    # Column indices that carry resolved extraction values (1-based to
    # match the header row); both must render like matrix cells.
    value_col_indices = {5, 12}  # "AI proposed value", "Final value used"
    for row in rows:
        for col_idx, val in enumerate(astuple(row), start=1):
            cell_val = (
                format_export_scalar(val) if col_idx in value_col_indices else _xlsx_safe(val)
            )
            ws.cell(row=body_row, column=col_idx, value=cell_val)
        body_row += 1
```

- [ ] **Step 6: Add an AI-sheet cell-rendering assertion to the builder unit test.** Append a test to `backend/tests/unit/test_extraction_xlsx_builder.py` that builds a workbook with one `AIProposalRow(ai_proposed_value="5 mg", final_value_used="Yes", ...)` and asserts the loaded `AI metadata` sheet cells E2 == "5 mg" and L2 == "Yes" (proving the value columns pass through the shared helper, not a dict-stringify path). Use the existing `_field`/`_section`/layout helpers in that file; construct a minimal `ExportLayout(..., include_ai_metadata=True, ai_proposal_rows=(row,))`.

- [ ] **Step 7: Run the builder unit suite, expect PASS.**
  Command (from `backend/`): `uv run pytest tests/unit/test_extraction_xlsx_builder.py tests/unit/test_value_envelope.py -q`
  Expected: green.

- [ ] **Step 8: Lint + format.**
  Command (from `backend/`): `uv run ruff check app/services/exports/value_envelope.py app/services/exports/extraction_xlsx_builder.py tests/unit/test_value_envelope.py tests/unit/test_extraction_xlsx_builder.py && uv run ruff format app/services/exports/value_envelope.py app/services/exports/extraction_xlsx_builder.py tests/unit/test_value_envelope.py tests/unit/test_extraction_xlsx_builder.py`
  Expected: `All checks passed!`.

- [ ] **Step 9: Commit.**
  `git add backend/app/services/exports/value_envelope.py backend/app/services/exports/extraction_xlsx_builder.py backend/tests/unit/test_value_envelope.py backend/tests/unit/test_extraction_xlsx_builder.py && git commit -m "refactor(export): share format helper across matrix + AI value cells

Adds format_export_scalar (boolean->Yes/No with field, tz-strip, list
join) consumed by both the matrix _format_cell and the AI-metadata
value columns, so number+unit/select/multiselect/boolean render
identically. AI value columns now shape via the shared helper instead
of the generic _xlsx_safe path.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"`

---

### Task 6: Remove the silent `str(dict)` fallback in `_xlsx_safe` so a missed shape fails loud

With every value now flowing through `resolve_value`, a dict reaching `_xlsx_safe` is a programming error — it must raise in tests, not be silently stringified into the workbook.

**Files:**
- Modify: `backend/app/services/exports/extraction_xlsx_builder.py` (`_xlsx_safe` @354-373)
- Test: `backend/tests/unit/test_extraction_xlsx_builder.py` (new dict-raises assertion)

- [ ] **Step 1: Write a failing test asserting `_xlsx_safe` raises on a dict.** Append to `backend/tests/unit/test_extraction_xlsx_builder.py`:

```python
def test_xlsx_safe_raises_on_dict() -> None:
    """A dict reaching _xlsx_safe means resolve_value was bypassed — it
    must fail loud, not silently str() into the sheet."""
    from app.services.exports.extraction_xlsx_builder import _xlsx_safe

    with pytest.raises(TypeError):
        _xlsx_safe({"value": 5, "unit": "mg"})
```

- [ ] **Step 2: Run, expect FAIL (no exception raised — current code returns `str(value)`).**
  Command (from `backend/`): `uv run pytest tests/unit/test_extraction_xlsx_builder.py::test_xlsx_safe_raises_on_dict -q`
  Expected: `DID NOT RAISE TypeError` (current code stringifies).

- [ ] **Step 3: Remove the silent fallback.** Edit `_xlsx_safe` (@354-373) — replace the dict branch with a raise and tighten the docstring:

```python
def _xlsx_safe(value: Any) -> Any:
    """Convert values openpyxl cannot serialise natively.

    Lists → joined string; timezone-aware datetimes → naive UTC. A
    ``dict`` here is a bug: ``resolve_value`` is the single unwrapper and
    must have collapsed every envelope upstream. We raise rather than
    silently ``str()`` a Python-repr dict into the workbook (that masked
    the §6 dict-leak in tests).
    """
    if value is None:
        return None
    if isinstance(value, list):
        return "; ".join(str(item) for item in value if item is not None)
    if isinstance(value, dict):
        raise TypeError(
            "_xlsx_safe received a dict; resolve_value must run upstream "
            f"to collapse the envelope (got {value!r})."
        )
    # Datetime handling — openpyxl raises on tz-aware datetimes.
    from datetime import datetime as _dt

    if isinstance(value, _dt) and value.tzinfo is not None:
        return value.replace(tzinfo=None)
    return value
```

- [ ] **Step 4: Run the dict-raises test, expect PASS.**
  Command (from `backend/`): `uv run pytest tests/unit/test_extraction_xlsx_builder.py::test_xlsx_safe_raises_on_dict -q`
  Expected: 1 passed.

- [ ] **Step 5: Run the full builder + resolver + export integration suite to confirm no dict survives end-to-end.**
  Command (from `backend/`): `uv run pytest tests/unit/test_extraction_xlsx_builder.py tests/unit/test_value_envelope.py tests/unit/test_extraction_export_determinism.py tests/integration/test_extraction_export_value_resolution.py tests/integration/test_extraction_export_ai_value_resolution.py tests/integration/test_extraction_export_ai_outcome_ordering.py -q`
  Expected: green — proving no real value shape now reaches `_xlsx_safe` as a dict (if one did, the build would raise and fail a test, which is the intended fail-loud behaviour).

- [ ] **Step 6: Lint + format.**
  Command (from `backend/`): `uv run ruff check app/services/exports/extraction_xlsx_builder.py tests/unit/test_extraction_xlsx_builder.py && uv run ruff format app/services/exports/extraction_xlsx_builder.py tests/unit/test_extraction_xlsx_builder.py`
  Expected: `All checks passed!`.

- [ ] **Step 7: Commit.**
  `git add backend/app/services/exports/extraction_xlsx_builder.py backend/tests/unit/test_extraction_xlsx_builder.py && git commit -m "fix(export): make _xlsx_safe raise on dict instead of str() fallback

resolve_value is now the single envelope unwrapper, so any dict reaching
_xlsx_safe is a bypass bug. Raising surfaces a missed shape in tests
rather than leaking a Python-repr dict string into the workbook.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"`

---

### Task 7: Delete `_unwrap_value` and prove no remaining references

`_unwrap_value` is now fully replaced. Delete it (per the no-legacy rule) and assert nothing references it.

**Files:**
- Modify: `backend/app/services/extraction_export_service.py` (`_unwrap_value` @1459-1468)

- [ ] **Step 1: Prove the only references left are the definition itself.**
  Command (from repo root): `grep -rn "_unwrap_value" backend/`
  Expected after the prior tasks: only the function definition at `extraction_export_service.py:1459` remains (zero call sites). If any call site survives, fix it before deleting.

- [ ] **Step 2: Delete the function.** Remove the `_unwrap_value` definition (the whole block @1459-1468, from `def _unwrap_value(raw: Any) -> Any:` through its `return raw`).

- [ ] **Step 3: Assert zero references remain.**
  Command (from repo root): `grep -rn "_unwrap_value" backend/ ; echo "exit=$?"`
  Expected: no matches (`grep` exit 1 → `exit=1`).

- [ ] **Step 4: Run the export suite to confirm nothing broke.**
  Command (from `backend/`): `uv run pytest tests/unit/test_extraction_xlsx_builder.py tests/unit/test_value_envelope.py tests/unit/test_extraction_export_determinism.py tests/integration/test_extraction_export_value_resolution.py tests/integration/test_extraction_export_ai_value_resolution.py tests/integration/test_extraction_export_ai_outcome_ordering.py -q`
  Expected: green.

- [ ] **Step 5: Confirm layered-architecture fitness still passes (resolver is in `services`, no IO).**
  Command (from repo root): `uv run python scripts/fitness/check_layered_arch.py`
  Expected: pass (the resolver imports only `app.models.extraction`; no api/repository/IO imports).

- [ ] **Step 6: Lint + format.**
  Command (from `backend/`): `uv run ruff check app/services/extraction_export_service.py && uv run ruff format app/services/extraction_export_service.py`
  Expected: `All checks passed!`.

- [ ] **Step 7: Commit.**
  `git add backend/app/services/extraction_export_service.py && git commit -m "refactor(export): delete _unwrap_value (fully replaced by resolve_value)

No call sites remain; resolve_value is the single envelope unwrapper.
Removes the legacy single-key {value} unwrapper per the no-legacy rule.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"`

---

Slice complete. Key authoritative paths produced/modified by this slice (all absolute):
- `backend/app/services/exports/value_envelope.py` (new: `resolve_value`, `format_export_scalar`, `_FieldLike` Protocol, `ResolvedScalar`)
- `backend/app/services/extraction_export_service.py` (`FieldDescriptor.unit` added; `_build_consensus_value_map`/`_build_single_user_value_map`/`_build_all_users_value_map`/`_load_ai_proposal_rows` rewired to `resolve_value`; `_unwrap_value` deleted)
- `backend/app/services/exports/extraction_xlsx_builder.py` (`_format_cell` + AI value columns route through `format_export_scalar`; `_xlsx_safe` dict-fallback removed → raises)
- Tests: `backend/tests/unit/test_value_envelope.py` (new), `backend/tests/integration/test_extraction_export_value_resolution.py` (new), `backend/tests/integration/test_extraction_export_ai_value_resolution.py` (new), `backend/tests/unit/test_extraction_xlsx_builder.py` (extended)

Load-bearing facts confirmed against real code: the double-wrap is `proposed_value = {"value": inner_value}` at `section_extraction_service.py:1259` where `inner_value` can be `{"value": n, "unit": u}`; current `_unwrap_value` (@1459) only unwraps single-key `{value}`; all four leak sites are @666, @833-835, @1098/1131-1133, @1334; the AI sheet bypasses field context via `astuple→_xlsx_safe` (@341-342); the silent fallback is `_xlsx_safe` @364-367.

One cross-slice coordination note for the synthesizer: the integration tests above assume a `seeded_export_fixture`/`seeded_ai_export_fixture` helper modeled on `test_extraction_manual_only_flow.py` + `test_extraction_export_ai_outcome_ordering.py`; the exact `resolve_layout` keyword signature must be read from the live service at implementation time (its current arguments were not fully captured here). The resolver/format/`_xlsx_safe` unit tasks are fully self-contained and do not depend on that.


---

## Phase S2 — AI-metadata outcome inference correctness

### Task 8: A2/A3 plan-time decision — confirm reviewer scoping of the decision query and the new outcome precedence

**Files:**
- Read: `backend/app/services/extraction_export_service.py` (`_load_ai_proposal_rows` @1140–1345, `_infer_reviewer_outcome` @1353–1380, `resolve_layout` @255–332)
- Read: `backend/app/models/extraction_workflow.py` (`ExtractionReviewerState` @192, `ExtractionReviewerDecision` @121, `ExtractionReviewerDecisionType` @55)
- Read: `backend/app/repositories/extraction_proposal_repository.py` (`get_latest_for_coord` ordering)

- [ ] **Step 1: Confirm the reviewer-scoping column and decision string values.** Verify from the model file that `ExtractionReviewerState.reviewer_id` (UUID, NOT NULL, @202) is the per-reviewer scoping column for the decision query, and that `ExtractionReviewerDecisionType` values are exactly `accept_proposal` / `reject` / `edit` (@58–60). Record the decision precedence the rewrite must implement (highest → lowest):
  1. `accepted` — an `accept_proposal` decision whose `proposal_record_id == proposal_id`.
  2. `superseded` — `proposal_id != latest_id` (a newer AI proposal exists for the key). **Checked before any blanket reject** (A2 reorder).
  3. `not selected` — `proposal_id == latest_id` AND there is an `accept_proposal` decision on the key pointing at a *different* proposal_id (this latest proposal was reviewed but a different one was selected) (A4).
  4. `rejected` — a `reject` decision exists on the key AND **no** `accept_proposal` of a *different* proposal (A2 gate: a reject must not mask a real accept-of-other).
  5. `edited (best-effort)` — an `edit` decision exists on the key.
  6. `pending` — a terminal decision exists on the key but none of the above applied → label `not selected` (A4: never `pending` when the key has *any* terminal decision); otherwise (no decisions at all) → `pending`.
  Record the A3 decision: `_load_ai_proposal_rows` gains `mode: ExportMode` (already present) **plus** a new `target_reviewer_id: UUID | None` param; in `SINGLE_USER` mode the decision query @1245 is filtered by `ExtractionReviewerState.reviewer_id == target_reviewer_id` so the `Reviewer outcome` column reflects the same reviewer whose values populate `Final value used`. In `CONSENSUS`/`ALL_USERS` the decision query is **not** reviewer-filtered (all reviewers' decisions remain in scope; consensus has no single target reviewer). This is a read-only change; **no Alembic migration** (confirm: no model/column added). This step produces a written decision only — no code.

---

### Task 9: A2 — reorder outcome precedence (superseded before blanket reject; gate reject on no accept-of-other)

**Files:**
- Modify: `backend/app/services/extraction_export_service.py` (`_infer_reviewer_outcome` @1353–1380)
- Test: `backend/tests/unit/test_extraction_export_service.py` (`TestInferReviewerOutcome` @510)

- [ ] **Step 1: Write failing tests for the A2 reorder.** Add to `TestInferReviewerOutcome`. These prove `superseded` wins over a blanket `reject`, and that a `reject` co-existing with an `accept_proposal` of a *different* proposal does NOT report `rejected`:

```python
    def test_superseded_wins_over_reject(self):
        """A2: a non-latest proposal with a reject on the key → 'superseded', not 'rejected'.

        The old precedence returned 'rejected' for ANY reject on the key, masking
        the fact that this proposal was superseded by a newer AI proposal.
        """
        pid = uuid4()
        latest_id = uuid4()  # a newer proposal supersedes pid
        decisions = [("reject", None)]
        result = _infer_reviewer_outcome(
            proposal_id=pid,
            key=(uuid4(), uuid4(), uuid4()),
            latest_id=latest_id,
            decisions=decisions,
        )
        assert result == "superseded"

    def test_reject_gated_on_no_accept_of_other(self):
        """A2: a reject co-existing with accept_proposal of a DIFFERENT proposal
        on the same key is 'not selected', never 'rejected' (the accept-of-other
        is the real outcome; the reject must not mask it)."""
        pid = uuid4()
        other_pid = uuid4()
        decisions = [("reject", None), ("accept_proposal", other_pid)]
        result = _infer_reviewer_outcome(
            proposal_id=pid,
            key=(uuid4(), uuid4(), uuid4()),
            latest_id=pid,  # pid is the latest, so not superseded
            decisions=decisions,
        )
        assert result == "not selected"

    def test_reject_only_still_rejected(self):
        """A2 regression: a plain reject (no accept-of-other, pid is latest) is
        still 'rejected'."""
        pid = uuid4()
        decisions = [("reject", None)]
        result = _infer_reviewer_outcome(
            proposal_id=pid,
            key=(uuid4(), uuid4(), uuid4()),
            latest_id=pid,
            decisions=decisions,
        )
        assert result == "rejected"
```

- [ ] **Step 2: Run the new tests, expect FAIL.** From `backend/`:
  `uv run pytest tests/unit/test_extraction_export_service.py::TestInferReviewerOutcome::test_superseded_wins_over_reject tests/unit/test_extraction_export_service.py::TestInferReviewerOutcome::test_reject_gated_on_no_accept_of_other -q`
  Expect FAIL: `test_superseded_wins_over_reject` asserts `superseded` but current code returns `rejected` (reject check @1372 runs before the `proposal_id != latest_id` check @1378); `test_reject_gated_on_no_accept_of_other` asserts `not selected` but current code returns `rejected`.

- [ ] **Step 3: Rewrite `_infer_reviewer_outcome` for the A2/A4 precedence.** Replace the body (@1353–1380) with the reordered logic. (Signature gains `target_reviewer_id` in the A3 task; here keep the current signature.) New implementation:

```python
def _infer_reviewer_outcome(
    *,
    proposal_id: UUID,
    key: tuple[UUID, UUID, UUID],  # noqa: ARG001 — kept for symmetry/debugging
    latest_id: UUID,
    decisions: list[tuple[str, UUID | None]],
) -> str:
    """Compute the FR-037 ``Reviewer outcome`` value for a proposal.

    Precedence (highest → lowest, A2/A4 corrected):
        1. accepted     — an accept_proposal decision targets THIS proposal_id.
        2. superseded   — a newer AI proposal exists for this key
                          (proposal_id != latest_id), checked BEFORE any blanket
                          reject so a superseded proposal is not mislabelled
                          'rejected'.
        3. not selected — this is the latest proposal but an accept_proposal on the
                          key targets a DIFFERENT proposal (reviewed, not chosen).
        4. rejected     — a reject decision exists AND no accept of a different
                          proposal masks it.
        5. edited       — an edit decision exists (best-effort; edit carries no FK
                          back to the AI proposal).
        6. not selected — a terminal decision exists on the key but none of the
                          above applied (A4: never 'pending' once the key is
                          touched).
        7. pending      — no reviewer decision on this key at all.
    """
    accepts_other = any(
        d == "accept_proposal" and pid is not None and pid != proposal_id
        for d, pid in decisions
    )

    # 1. accepted — exact match on this proposal.
    for decision, pid in decisions:
        if decision == "accept_proposal" and pid == proposal_id:
            return "accepted"

    # 2. superseded — a newer AI proposal exists for this key (before any reject).
    if proposal_id != latest_id:
        return "superseded"

    # 3. not selected — latest, but a different proposal was accepted on the key.
    if accepts_other:
        return "not selected"

    # 4. rejected — a reject exists and no accept-of-other masks it.
    for decision, _ in decisions:
        if decision == "reject":
            return "rejected"

    # 5. edited — best-effort.
    for decision, _ in decisions:
        if decision == "edit":
            return "edited (best-effort)"

    # 6/7. a terminal decision touched the key → 'not selected'; else 'pending'.
    return "not selected" if decisions else "pending"
```

- [ ] **Step 4: Run the full `TestInferReviewerOutcome` class, expect PASS.** From `backend/`:
  `uv run pytest tests/unit/test_extraction_export_service.py::TestInferReviewerOutcome -q`
  Expect PASS for all (the new A2 tests plus the pre-existing `test_reject_decision_returns_rejected`, `test_edit_decision_returns_edited`, `test_newer_proposal_exists_returns_superseded`, `test_no_decisions_returns_pending`, `test_accept_proposal_wrong_pid_falls_through_to_pending`, and `test_decision_precedence` — all keep `latest_id=pid` so superseded does not fire and the reorder is backward-compatible for them). Note: `test_accept_proposal_wrong_pid_falls_through_to_pending` (@575) now exercises the A4 path — `accept_proposal` with `other_pid` and `pid==latest` → `accepts_other` is True → `not selected`. **Update that test's assertion from `"pending"` to `"not selected"` and its docstring** as part of this step (it is the A4 behaviour change, intentional):

```python
        # accept_proposal targets a different proposal; pid is latest → A4 'not selected'
        assert result == "not selected"
```

- [ ] **Step 5: Lint and commit.** From `backend/`:
  `uv run ruff check app/services/extraction_export_service.py tests/unit/test_extraction_export_service.py && uv run ruff format app/services/extraction_export_service.py tests/unit/test_extraction_export_service.py`
  Commit:
  ```
  fix(extraction-export): reorder AI outcome precedence — superseded before reject (A2)

  _infer_reviewer_outcome checked any reject on the key before the
  superseded (proposal_id != latest_id) test, so a superseded proposal that
  also carried a reject was mislabelled 'rejected', and a reject co-existing
  with an accept of a different proposal masked the real accept-of-other.
  Check superseded first; gate reject on no accept-of-other; surface
  'not selected' for the accept-of-other case.

  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
  ```

---

### Task 10: A4 — label 'not selected'/'superseded' (never 'pending') when a terminal decision exists on the key

**Files:**
- Modify: `backend/app/services/extraction_export_service.py` (`_infer_reviewer_outcome` final return, just edited in the A2 task)
- Test: `backend/tests/unit/test_extraction_export_service.py` (`TestInferReviewerOutcome`)

- [ ] **Step 1: Write failing tests for the A4 distinction.** A4's core requirement (`not selected` when a terminal decision exists, `pending` only when truly untouched) is implemented by the final return of the A2 rewrite; add explicit tests that pin it so a future edit can't regress it:

```python
    def test_terminal_decision_other_field_not_pending(self):
        """A4: the latest proposal with a terminal decision on the key (an
        unrelated accept that matches neither this nor flags accept-of-other,
        e.g. an accept with a null proposal_id) is 'not selected', never 'pending'."""
        pid = uuid4()
        decisions = [("accept_proposal", None)]  # touched, but no usable target
        result = _infer_reviewer_outcome(
            proposal_id=pid,
            key=(uuid4(), uuid4(), uuid4()),
            latest_id=pid,
            decisions=decisions,
        )
        assert result == "not selected"

    def test_never_reviewed_is_pending(self):
        """A4: only a key with NO decisions at all is 'pending'."""
        pid = uuid4()
        result = _infer_reviewer_outcome(
            proposal_id=pid,
            key=(uuid4(), uuid4(), uuid4()),
            latest_id=pid,
            decisions=[],
        )
        assert result == "pending"
```

- [ ] **Step 2: Run the new tests.** From `backend/`:
  `uv run pytest tests/unit/test_extraction_export_service.py::TestInferReviewerOutcome::test_terminal_decision_other_field_not_pending tests/unit/test_extraction_export_service.py::TestInferReviewerOutcome::test_never_reviewed_is_pending -q`
  Expect PASS already (the A2 rewrite's `return "not selected" if decisions else "pending"` final line satisfies both). **Pin-test caveat (TDD discipline):** to prove the assertion is load-bearing and not vacuous, first momentarily change the final return to `return "pending"`, run the two tests, confirm `test_terminal_decision_other_field_not_pending` FAILs (`not selected != pending`), then restore `return "not selected" if decisions else "pending"` and confirm both PASS. This is the red→green proof for A4.

- [ ] **Step 3: Update the legacy precedence note in the unit-test parametrize.** The `test_decision_precedence` docstring (@598) still reads `accept_proposal (exact) > reject > edit > superseded > pending`. Replace it with the corrected order so the test file documents the new contract:

```python
        """Precedence: accepted > superseded > not-selected > rejected > edited > pending."""
```
  Re-run `uv run pytest tests/unit/test_extraction_export_service.py::TestInferReviewerOutcome::test_decision_precedence -q` — expect PASS (the parametrize cases all use `latest_id=pid` with no accept-of-other, so `reject` still wins over `edit` exactly as asserted).

- [ ] **Step 4: Lint and commit.** From `backend/`:
  `uv run ruff check app/services/extraction_export_service.py tests/unit/test_extraction_export_service.py && uv run ruff format app/services/extraction_export_service.py tests/unit/test_extraction_export_service.py`
  Commit:
  ```
  fix(extraction-export): never report 'pending' once a key has a terminal decision (A4)

  A reviewed-but-not-selected latest AI proposal reported 'pending',
  indistinguishable from a never-reviewed proposal. Label 'not selected'
  whenever any terminal decision exists on the (run, instance, field) key;
  'pending' is reserved for keys with no reviewer decision at all.

  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
  ```

---

### Task 11: A2 query scoping — index decisions by (run, instance, field) AND reviewer in the loader

**Files:**
- Modify: `backend/app/services/extraction_export_service.py` (decision query @1245–1260; `decisions_by_key` index @1262–1264)
- Test: `backend/tests/unit/test_extraction_export_service.py` (`TestLoadAiProposalRows` @614)

- [ ] **Step 1: Write a failing unit test proving multi-reviewer conflation is no longer a blanket reject.** Add to `TestLoadAiProposalRows`. Two reviewers decide on one `(run, instance, field)`: reviewer A `accept_proposal` (this proposal), reviewer B `reject`. The latest proposal must surface `accepted`, not `rejected` — the old query @1245 returns BOTH rows for the key (no reviewer column selected) and any reject masked the accept:

```python
    @pytest.mark.asyncio
    async def test_multi_reviewer_accept_and_reject_not_masked(self):
        """A2: two reviewers disagree on one key (A accepts THIS proposal, B
        rejects). Outcome must be 'accepted' — the reject must not mask it.

        The decision query now selects reviewer_id; we assert the loader still
        consumes ALL reviewers' decisions for consensus mode and resolves
        precedence per A2 (accept wins)."""
        svc = _make_service()
        run_id = uuid4()
        article_id = uuid4()
        instance_id = uuid4()
        entity_type_id = uuid4()
        field_id = uuid4()
        proposal_id = uuid4()
        reviewer_a = uuid4()
        reviewer_b = uuid4()
        ts = datetime(2024, 3, 1, tzinfo=UTC)

        article = self._make_article(
            run_id=run_id,
            article_id=article_id,
            study_instances={entity_type_id: instance_id},
        )
        proposal_row = (
            proposal_id, run_id, instance_id, field_id,
            {"value": "v"}, 0.9, None, ts,
        )
        # decision rows now carry reviewer_id:
        # (run_id, instance_id, field_id, reviewer_id, decision, proposal_record_id)
        decision_a = (run_id, instance_id, field_id, reviewer_a, "accept_proposal", proposal_id)
        decision_b = (run_id, instance_id, field_id, reviewer_b, "reject", None)

        svc.db.execute = AsyncMock(
            side_effect=[
                _rows_result([(instance_id, entity_type_id, article_id)]),
                _rows_result([proposal_row]),
                _rows_result([]),  # evidence
                _rows_result([decision_a, decision_b]),  # decisions (reviewer-tagged)
                _rows_result([(entity_type_id, "Sec")]),
                _rows_result([(field_id, "Fld")]),
            ]
        )

        result = await svc._load_ai_proposal_rows(
            articles=(article,),
            sections=(),
            value_map={(run_id, instance_id, field_id): "v"},
            mode=ExportMode.CONSENSUS,
            target_reviewer_id=None,
        )
        assert len(result) == 1
        assert result[0].reviewer_outcome == "accepted"
```

- [ ] **Step 2: Run the new test, expect FAIL.** From `backend/`:
  `uv run pytest tests/unit/test_extraction_export_service.py::TestLoadAiProposalRows::test_multi_reviewer_accept_and_reject_not_masked -q`
  Expect FAIL with `TypeError: _load_ai_proposal_rows() got an unexpected keyword argument 'target_reviewer_id'` (param added in this step's impl) — and, once the param exists, the decision-row unpacking will still be the 5-tuple `(rid, iid, fid, decision, prop_id)` @1263, so the 6-tuple `decision_a` fixture will raise `ValueError: too many values to unpack`. Both prove the query must select `reviewer_id`.

- [ ] **Step 3: Add `reviewer_id` to the decision query and the index; add the `target_reviewer_id` param + A3 reviewer filter.** Change the loader signature (@1140) to add `target_reviewer_id: UUID | None`, then rewrite the decision query (@1245–1264) to select `ExtractionReviewerState.reviewer_id`, apply the single-user filter, and index by key while preserving every decision tuple. Replace the block:

```python
        # 3. Reviewer decisions for the same (run, instance, field) — the
        # outcome inference is best-effort because the `edit` decision
        # carries no FK back to the AI proposal (FR-040 caveat). In
        # SINGLE_USER mode the query is scoped to the target reviewer so the
        # "Reviewer outcome" column reflects the same reviewer whose values
        # populate "Final value used" (A3); consensus/all-users keep all
        # reviewers' decisions in scope.
        decision_stmt = (
            select(
                ExtractionReviewerState.run_id,
                ExtractionReviewerState.instance_id,
                ExtractionReviewerState.field_id,
                ExtractionReviewerState.reviewer_id,
                ExtractionReviewerDecision.decision,
                ExtractionReviewerDecision.proposal_record_id,
            )
            .join(
                ExtractionReviewerDecision,
                ExtractionReviewerState.current_decision_id == ExtractionReviewerDecision.id,
            )
            .where(ExtractionReviewerState.run_id.in_(run_ids))
        )
        if mode is ExportMode.SINGLE_USER and target_reviewer_id is not None:
            decision_stmt = decision_stmt.where(
                ExtractionReviewerState.reviewer_id == target_reviewer_id
            )
        decision_rows = (await self.db.execute(decision_stmt)).all()
        # Index decisions by (run, instance, field) → list of (decision, prop_id).
        # reviewer_id is selected for scoping/diagnostics but the per-key
        # precedence in _infer_reviewer_outcome consumes the decision+prop_id pair.
        decisions_by_key: dict[tuple[UUID, UUID, UUID], list[tuple[str, UUID | None]]] = {}
        for rid, iid, fid, _reviewer_id, decision, prop_id in decision_rows:
            decisions_by_key.setdefault((rid, iid, fid), []).append((decision, prop_id))
```

  This keeps `_infer_reviewer_outcome`'s `decisions: list[tuple[str, UUID | None]]` shape unchanged (the A2/A4 rewrite already consumes it), so no further outcome-helper change is needed here.

- [ ] **Step 4: Run the new test, expect PASS.** From `backend/`:
  `uv run pytest tests/unit/test_extraction_export_service.py::TestLoadAiProposalRows::test_multi_reviewer_accept_and_reject_not_masked -q`
  Expect PASS (accept-of-this wins per A2; reject from reviewer B does not mask it).

- [ ] **Step 5: Fix the existing `TestLoadAiProposalRows` fixtures broken by the new decision-row arity.** Every existing test that feeds `decision_row = (run_id, instance_id, field_id, "decision", prop_id)` (5-tuple, e.g. @813) must become the 6-tuple `(run_id, instance_id, field_id, reviewer_id, "decision", prop_id)`, and every `_load_ai_proposal_rows(...)` call must pass `target_reviewer_id=None`. Grep them: `uv run pytest tests/unit/test_extraction_export_service.py::TestLoadAiProposalRows -q` will currently FAIL on the unpack/kwarg for the unmodified ones. Update each decision-row fixture to insert a fresh `reviewer_id = uuid4()` before the decision string, and add `target_reviewer_id=None` to each call. Re-run `uv run pytest tests/unit/test_extraction_export_service.py::TestLoadAiProposalRows -q` — expect PASS for the whole class.

- [ ] **Step 6: Lint and commit.** From `backend/`:
  `uv run ruff check app/services/extraction_export_service.py tests/unit/test_extraction_export_service.py && uv run ruff format app/services/extraction_export_service.py tests/unit/test_extraction_export_service.py`
  Commit:
  ```
  fix(extraction-export): scope AI decision query by reviewer-aware key (A2/A3)

  The decision query @1245 selected no reviewer_id, so all reviewers' decisions
  for one (run, instance, field) were conflated and any reject masked a real
  accept/superseded. Select reviewer_id, add a target_reviewer_id param, and in
  single_user mode filter decisions to the target reviewer so 'Reviewer outcome'
  matches 'Final value used'. Consensus/all-users keep all decisions in scope.

  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
  ```

---

### Task 12: A3 — thread mode + target reviewer_id from resolve_layout into _load_ai_proposal_rows

**Files:**
- Modify: `backend/app/services/extraction_export_service.py` (`resolve_layout` @325–332; `_load_ai_proposal_rows` final-value keying @1323–1328)
- Test: `backend/tests/unit/test_extraction_export_service.py` (`TestLoadAiProposalRows`)

- [ ] **Step 1: Write a failing unit test that single-user scoping makes Reviewer outcome agree with Final value used.** Two reviewers decided on one key: the **target** reviewer rejected this proposal; another reviewer accepted it. In `SINGLE_USER` mode for the target reviewer, the outcome must be `rejected` (the target's own decision) AND `final_value_used` must be the single-user value-map value (3-tuple key) — proving both columns reflect the same reviewer:

```python
    @pytest.mark.asyncio
    async def test_single_user_outcome_scoped_to_target_reviewer(self):
        """A3: in SINGLE_USER mode the outcome reflects ONLY the target reviewer's
        decision, matching the single-user 'Final value used' (3-tuple key).

        Target reviewer rejected; another reviewer accepted the same proposal.
        The row must read 'rejected' (target's view), not 'accepted'."""
        svc = _make_service()
        run_id = uuid4()
        article_id = uuid4()
        instance_id = uuid4()
        entity_type_id = uuid4()
        field_id = uuid4()
        proposal_id = uuid4()
        target_reviewer = uuid4()
        other_reviewer = uuid4()
        ts = datetime(2024, 4, 1, tzinfo=UTC)

        article = self._make_article(
            run_id=run_id,
            article_id=article_id,
            study_instances={entity_type_id: instance_id},
        )
        proposal_row = (
            proposal_id, run_id, instance_id, field_id,
            {"value": "v"}, 0.9, None, ts,
        )
        # ONLY the target reviewer's decision is returned, because the loader's
        # decision query is now filtered by target_reviewer_id in SINGLE_USER mode.
        target_reject = (run_id, instance_id, field_id, target_reviewer, "reject", None)

        svc.db.execute = AsyncMock(
            side_effect=[
                _rows_result([(instance_id, entity_type_id, article_id)]),
                _rows_result([proposal_row]),
                _rows_result([]),
                _rows_result([target_reject]),  # query filtered to target reviewer
                _rows_result([(entity_type_id, "Sec")]),
                _rows_result([(field_id, "Fld")]),
            ]
        )

        result = await svc._load_ai_proposal_rows(
            articles=(article,),
            sections=(),
            value_map={(run_id, instance_id, field_id): None},  # single-user reject → blank
            mode=ExportMode.SINGLE_USER,
            target_reviewer_id=target_reviewer,
        )
        assert len(result) == 1
        assert result[0].reviewer_outcome == "rejected"
        assert result[0].final_value_used is None
```

  (The query-filter behaviour itself was implemented in the previous task; this test pins the contract that the filtered result yields a target-scoped outcome, and locks the 3-tuple final-value keying for SINGLE_USER.)

- [ ] **Step 2: Run the test.** From `backend/`:
  `uv run pytest tests/unit/test_extraction_export_service.py::TestLoadAiProposalRows::test_single_user_outcome_scoped_to_target_reviewer -q`
  Expect PASS (the loader already accepts `target_reviewer_id` and filters in single-user mode from the prior task; the final-value 3-tuple lookup @1327–1328 already handles non-ALL_USERS modes). If it FAILs, the failure localizes the remaining wiring gap — fix minimally.

- [ ] **Step 3: Wire `mode` + `target_reviewer_id` through `resolve_layout`.** At the `_load_ai_proposal_rows` call site (@327–332), pass the reviewer that drives the active mode. The single-user branch already binds `reviewer_id` (@293–297); thread it as the AI target so the AI sheet's decisions scope to the same reviewer:

```python
        ai_rows: tuple[AIProposalRow, ...] = ()
        if include_ai_metadata:
            ai_rows = await self._load_ai_proposal_rows(
                articles=tuple(articles),
                sections=sections,
                value_map=value_map,
                mode=mode,
                # A3: only single-user mode has one target reviewer; consensus and
                # all-users keep every reviewer's decisions in scope.
                target_reviewer_id=reviewer_id if mode is ExportMode.SINGLE_USER else None,
            )
```

- [ ] **Step 4: Write a failing unit test on `resolve_layout` that the AI loader receives the target reviewer.** Add to the existing `resolve_layout` test class (the one that already mocks the consensus/single-user branches). Patch `_load_ai_proposal_rows` to capture kwargs; drive `mode=SINGLE_USER, reviewer_id=R, include_ai_metadata=True` and assert it was called with `target_reviewer_id == R`; then `mode=CONSENSUS` and assert `target_reviewer_id is None`. Use the existing mocking conventions in the file (mock `_load_active_template_version`, `_resolve_project_name`, `_load_sections`, the article/value-map builders, `_load_ai_proposal_rows`). Mirror the setup of the nearest existing `resolve_layout` test. Run it:
  `uv run pytest tests/unit/test_extraction_export_service.py -k "resolve_layout and ai_target" -q`
  Expect FAIL first if the wiring in Step 3 is incomplete (e.g. if `target_reviewer_id` is omitted), then PASS after Step 3.

- [ ] **Step 5: Lint and commit.** From `backend/`:
  `uv run ruff check app/services/extraction_export_service.py tests/unit/test_extraction_export_service.py && uv run ruff format app/services/extraction_export_service.py tests/unit/test_extraction_export_service.py`
  Commit:
  ```
  fix(extraction-export): thread single-user target reviewer into AI sheet (A3)

  resolve_layout now passes target_reviewer_id into _load_ai_proposal_rows so
  the AI-metadata 'Reviewer outcome' scopes to the same reviewer whose values
  populate 'Final value used'; consensus/all-users pass None (all reviewers).

  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
  ```

---

### Task 13: A5 — one ordered (text, page) evidence list per proposal (ORDER BY, dedupe, numeric-sort pages)

**Files:**
- Modify: `backend/app/services/extraction_export_service.py` (evidence query @1225–1240; row assembly `evidence_text`/`evidence_pages` @1337–1338)
- Test: `backend/tests/unit/test_extraction_export_service.py` (`TestLoadAiProposalRows`)

- [ ] **Step 1: Write a failing unit test for ordered, deduped, numeric-sorted evidence.** Feed evidence rows for one proposal that are out of page order, contain a duplicate `(text, page)`, and have multi-digit pages so lexicographic vs numeric sort differ (`"2"` vs `"10"`). Assert `evidence_pages` is `"2, 9, 10"` (numeric sort, deduped) and `evidence_text` keeps one entry per distinct `(text, page)` in page order:

```python
    @pytest.mark.asyncio
    async def test_evidence_ordered_deduped_numeric_pages(self):
        """A5: evidence is built as one ordered (text, page) list per proposal —
        deduped, pages numerically sorted ('2' < '10'), not lexicographic."""
        svc = _make_service()
        run_id = uuid4()
        article_id = uuid4()
        instance_id = uuid4()
        entity_type_id = uuid4()
        field_id = uuid4()
        proposal_id = uuid4()
        ts = datetime(2024, 5, 1, tzinfo=UTC)

        article = self._make_article(
            run_id=run_id, article_id=article_id,
            study_instances={entity_type_id: instance_id},
        )
        proposal_row = (
            proposal_id, run_id, instance_id, field_id,
            {"value": "v"}, 0.9, None, ts,
        )
        # evidence rows: (proposal_record_id, text_content, page_number) — out of
        # order, with a duplicate (same text+page) and multi-digit pages.
        evidence_rows = [
            (proposal_id, "second finding", 10),
            (proposal_id, "first finding", 2),
            (proposal_id, "first finding", 2),   # exact duplicate
            (proposal_id, "middle finding", 9),
        ]

        svc.db.execute = AsyncMock(
            side_effect=[
                _rows_result([(instance_id, entity_type_id, article_id)]),
                _rows_result([proposal_row]),
                _rows_result(evidence_rows),
                _rows_result([]),  # decisions
                _rows_result([(entity_type_id, "Sec")]),
                _rows_result([(field_id, "Fld")]),
            ]
        )

        result = await svc._load_ai_proposal_rows(
            articles=(article,),
            sections=(),
            value_map={(run_id, instance_id, field_id): "v"},
            mode=ExportMode.CONSENSUS,
            target_reviewer_id=None,
        )
        assert len(result) == 1
        row = result[0]
        # numeric page sort, deduped:
        assert row.evidence_pages == "2, 9, 10"
        # text follows the same (text, page) order, deduped:
        assert row.evidence_text == "first finding | middle finding | second finding"
```

- [ ] **Step 2: Run the test, expect FAIL.** From `backend/`:
  `uv run pytest tests/unit/test_extraction_export_service.py::TestLoadAiProposalRows::test_evidence_ordered_deduped_numeric_pages -q`
  Expect FAIL: current code (@1234–1240) collects `ev_text_by_pid` and `ev_pages_by_pid` in **separate** dicts with no shared ordering, no dedupe, and joins pages as `str(page)` in arrival order — so `evidence_pages` would be `"10, 2, 9"` and `evidence_text` would keep the duplicate.

- [ ] **Step 3: Build one ordered, deduped (text, page) list per proposal.** Add `ExtractionEvidence.page_number` and a stable secondary key to the evidence query's `ORDER BY`, then collapse text+pages from a single per-proposal list. Replace the evidence query (@1225–1233) and the grouping (@1234–1240):

```python
        evidence_rows = (
            await self.db.execute(
                select(
                    ExtractionEvidence.proposal_record_id,
                    ExtractionEvidence.text_content,
                    ExtractionEvidence.page_number,
                )
                .where(ExtractionEvidence.proposal_record_id.in_(proposal_ids))
                .order_by(
                    ExtractionEvidence.proposal_record_id,
                    ExtractionEvidence.page_number.asc().nulls_last(),
                    ExtractionEvidence.id.asc(),
                )
            )
        ).all()
        # One ordered, deduped (text, page) list per proposal. Dedupe on the
        # (text, page) pair; numeric page sort (DB ORDER BY handles ints; we keep
        # a Python tiebreak guard for None pages). Pages are rendered numerically
        # sorted and deduped independently so "2" sorts before "10".
        ev_pairs_by_pid: dict[UUID, list[tuple[str | None, int | None]]] = {}
        seen_pairs: dict[UUID, set[tuple[str | None, int | None]]] = {}
        for pid, text, page in evidence_rows:
            pair = (text, page)
            seen = seen_pairs.setdefault(pid, set())
            if pair in seen:
                continue
            seen.add(pair)
            ev_pairs_by_pid.setdefault(pid, []).append(pair)
```

- [ ] **Step 4: Render `evidence_text`/`evidence_pages` from the ordered pair list.** Replace the row-assembly fields (@1337–1338) with helpers that read the single ordered list and numeric-sort the distinct pages:

```python
                evidence_text=" | ".join(
                    t for t, _p in ev_pairs_by_pid.get(pid, []) if t
                ),
                evidence_pages=", ".join(
                    str(p)
                    for p in sorted(
                        {pg for _t, pg in ev_pairs_by_pid.get(pid, []) if pg is not None}
                    )
                ),
```

  `sorted({...})` over the integer page numbers gives the numeric order (`2 < 9 < 10`); the set dedupes pages that recur across different text snippets. The `pair`-level dedupe in Step 3 removes exact `(text, page)` duplicates while preserving distinct texts that share a page.

- [ ] **Step 5: Run the test + the full loader class, expect PASS.** From `backend/`:
  `uv run pytest tests/unit/test_extraction_export_service.py::TestLoadAiProposalRows -q`
  Expect PASS, including the pre-existing `test_single_proposal_no_decisions_pending` which asserts `evidence_pages == "42"` and `evidence_text == "Evidence text"` (single-row case is unchanged by the ordering/dedupe).

- [ ] **Step 6: Lint and commit.** From `backend/`:
  `uv run ruff check app/services/extraction_export_service.py tests/unit/test_extraction_export_service.py && uv run ruff format app/services/extraction_export_service.py tests/unit/test_extraction_export_service.py`
  Commit:
  ```
  fix(extraction-export): order, dedupe, numeric-sort AI evidence (A5)

  Evidence text and pages were collected in separate guards with no ORDER BY,
  causing desync, duplicate snippets, and lexicographic page order ('10' before
  '2'). Build one ordered (text, page) list per proposal with an ORDER BY,
  dedupe on the pair, and numeric-sort the distinct pages.

  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
  ```

---

### Task 14: Integration coverage — A2/A3/A4/A5 against real Supabase (extend the existing A6 test)

**Files:**
- Modify: `backend/tests/integration/test_extraction_export_ai_outcome_ordering.py` (the existing A6 file — confirm its on-disk path with `git ls-files`; if it is untracked, recreate from the `.pyc` sibling and the `test_extraction_manual_only_flow.py` setup pattern)
- Read for setup pattern: `backend/tests/integration/test_extraction_manual_only_flow.py` (run/instance/proposal/decision insertion + project scoping)
- Read for fixtures: `backend/tests/integration/conftest.py` (`db_session`, autouse `SEED`)

- [ ] **Step 1: Locate the existing A6 integration test and its insertion helpers.** From `backend/`:
  `git ls-files tests/integration | grep ai_outcome` — if it returns the `.py`, read it. If only the `.pyc` exists, run `git log --all --oneline -- tests/integration/test_extraction_export_ai_outcome_ordering.py` and `git show <sha>:backend/tests/integration/test_extraction_export_ai_outcome_ordering.py` (from the `4e536fe` PR-291 commit, which added it) to recover the source, and confirm whether it is staged/committed in this branch. Reuse its proposal/decision/instance insertion helpers and its `project_id` scoping verbatim — do **not** re-derive the seed graph. This is a read+confirm step.

- [ ] **Step 2: Write a failing A2 integration test (multi-reviewer disagreement, real DB).** Add `test_ai_outcome_accept_not_masked_by_other_reviewer_reject`. Using the existing helpers, seed one run + one instance + one field; insert one `source='ai'` proposal; insert two `ExtractionReviewerState` rows (two distinct `reviewer_id`s) each with a `current_decision_id` → one `accept_proposal` (this proposal), one `reject`. Build the layout with `mode=CONSENSUS, include_ai_metadata=True`; assert the single `AIProposalRow.reviewer_outcome == "accepted"`. Scope all setup queries by `project_id` per the integration rule. Run:
  `uv run pytest tests/integration/test_extraction_export_ai_outcome_ordering.py::test_ai_outcome_accept_not_masked_by_other_reviewer_reject -q`
  Expect this to PASS against the already-fixed code (the A2 query+precedence fixes landed in earlier tasks) — to prove it is a genuine regression guard, temporarily `git stash` is not viable mid-plan, so instead assert red→green by checking out the pre-A2 `_infer_reviewer_outcome` precedence locally (revert the helper to the old `reject`-before-`superseded`/no-reviewer-filter form), confirm FAIL, then restore and confirm PASS. Document the red proof in the commit body.

- [ ] **Step 3: Write a failing A3 integration test (single-user reviewer scoping).** Add `test_ai_outcome_single_user_scoped_to_target`. Seed one AI proposal; insert two reviewers' decisions on the key — target reviewer `reject`, other reviewer `accept_proposal`. Build the layout with `mode=SINGLE_USER, reviewer_id=<target>, include_ai_metadata=True`. Assert the row's `reviewer_outcome == "rejected"` AND `final_value_used` equals the single-user value (blank/None for a reject), proving both columns reflect the target reviewer. Run:
  `uv run pytest tests/integration/test_extraction_export_ai_outcome_ordering.py::test_ai_outcome_single_user_scoped_to_target -q` — expect PASS (red-proof via the same temporary-revert method as Step 2 if needed).

- [ ] **Step 4: Write an A5 integration test (evidence ordering through the real evidence table).** Add `test_ai_evidence_ordered_and_deduped`. Insert ≥3 `ExtractionEvidence` rows for one AI proposal with out-of-order multi-digit `page_number`s and one exact `(text, page)` duplicate. Build the layout; assert `evidence_pages` is numeric-sorted/deduped (e.g. `"2, 9, 10"`) and `evidence_text` has no duplicate snippet, in page order. Run:
  `uv run pytest tests/integration/test_extraction_export_ai_outcome_ordering.py::test_ai_evidence_ordered_and_deduped -q` — expect PASS.

- [ ] **Step 5: Write an A4 integration test (terminal-decision ⇒ not 'pending').** Add `test_ai_outcome_not_selected_when_terminal_decision_exists`. Seed a latest AI proposal that is reviewed (an `accept_proposal` targeting a *different* proposal on the same key, or a reject of a sibling) so the latest is touched-but-not-selected. Assert `reviewer_outcome == "not selected"` (never `"pending"`). Run:
  `uv run pytest tests/integration/test_extraction_export_ai_outcome_ordering.py::test_ai_outcome_not_selected_when_terminal_decision_exists -q` — expect PASS.

- [ ] **Step 6: Run the whole A6 integration file (regression for the pre-existing tiebreak + empty-instance_meta guard).** From `backend/` (needs local Supabase on :54322):
  `uv run pytest tests/integration/test_extraction_export_ai_outcome_ordering.py -q`
  Expect all PASS — the new A2/A3/A4/A5 cases plus the existing A6 `id`-tiebreak and empty-`instance_meta` no-crash tests (prerequisites from PR #291, unchanged).

- [ ] **Step 7: Lint and commit.** From `backend/`:
  `uv run ruff check tests/integration/test_extraction_export_ai_outcome_ordering.py && uv run ruff format tests/integration/test_extraction_export_ai_outcome_ordering.py`
  Commit:
  ```
  test(extraction-export): integration coverage for AI outcome A2/A3/A4/A5

  Real-Supabase tests for multi-reviewer accept-not-masked-by-reject (A2),
  single-user reviewer scoping of Reviewer outcome vs Final value used (A3),
  not-selected vs pending on a terminal decision (A4), and ordered/deduped/
  numeric-sorted evidence (A5). Extends the existing A6 tiebreak file; setup
  scopes by project_id. Red->green proven by reverting the pre-fix helper.

  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
  ```

---

### Task 15: Slice gate — full export-service test run + layered-architecture fitness

**Files:**
- No source change; verification only.
- Touches: `backend/app/services/extraction_export_service.py`, `backend/tests/unit/test_extraction_export_service.py`, `backend/tests/integration/test_extraction_export_ai_outcome_ordering.py`

- [ ] **Step 1: Run the full unit suite for the export service.** From `backend/`:
  `uv run pytest tests/unit/test_extraction_export_service.py -q`
  Expect all PASS (TestInferReviewerOutcome + TestLoadAiProposalRows + resolve_layout + value-map classes). This confirms the A2 reorder did not regress the value-map / consensus tests that share the module.

- [ ] **Step 2: Run the determinism unit test.** From `backend/`:
  `uv run pytest tests/unit/test_extraction_export_determinism.py -q`
  Expect PASS — the outcome-precedence and evidence-ordering changes must keep export builds byte-stable (the `id`-tiebreak from PR #291 plus the new ORDER BY make evidence deterministic).

- [ ] **Step 3: Run the AI-outcome integration file.** From `backend/` (local Supabase up):
  `uv run pytest tests/integration/test_extraction_export_ai_outcome_ordering.py -q`
  Expect all PASS.

- [ ] **Step 4: Run the layered-architecture fitness check.** From repo root:
  `uv run --project backend python scripts/fitness/check_layered_arch.py` (or the make target if defined: `make quality-scan` is heavier — prefer the single fitness script). Expect PASS: this slice added no DB/HTTP imports to a layer-illegal place; `_load_ai_proposal_rows` and `_infer_reviewer_outcome` stay in `services`, and the changes are read-only SQLAlchemy selects (no repository/api boundary crossed).

- [ ] **Step 5: Confirm no model change ⇒ no migration needed.** From `backend/`:
  `git diff --name-only` over the slice must show **no** change under `app/models/` and `alembic/versions/`. The decision query selecting `ExtractionReviewerState.reviewer_id` reads an existing column (@202); no schema DDL. If `git status` shows an unexpected model/migration file, stop and reconcile — this slice must remain a read-only consumer. No commit (verification gate).

---

**Slice notes for the synthesizer:**

- **Prerequisites (already shipped in PR #291, commit `4e536fe`, do NOT redo):** the `id.desc()` tiebreak on the proposal query @1209 (A6) and the empty-`instance_meta` crash guard (A6's `sqlalchemy.false()`/skip for the `(False,)` short-circuit @1283). This slice's integration file (`test_extraction_export_ai_outcome_ordering.py`) is the **existing A6 file** — extend it, do not recreate.
- **Signature changes introduced by this slice (other slices must honor):** `_load_ai_proposal_rows(..., target_reviewer_id: UUID | None)` — new required kwarg; the decision query now selects `reviewer_id` (6-tuple decision rows). `_infer_reviewer_outcome` keeps its current keyword signature; only its precedence body changes. New outcome label string `"not selected"` joins the existing `accepted`/`rejected`/`edited (best-effort)`/`superseded`/`pending` set — any builder/copy that enumerates outcome labels (e.g. the AI-metadata sub-builder in the builder-split slice) must include `"not selected"`.
- **Path caveat:** the integration test referenced as `tests/integration/test_extraction_export_ai_outcome_ordering.py` currently exists on disk as a compiled `.pyc` only in this worktree (`git ls-files` did not list the `.py`); Step 1 of the integration task confirms/recovers the source from the `4e536fe` PR-291 commit before extending it.
- **A2/A4 contract precedence (final):** `accepted` > `superseded` > `not selected` (accept-of-other) > `rejected` (gated on no accept-of-other) > `edited (best-effort)` > `not selected` (any other terminal decision) > `pending` (no decisions). This supersedes the obsolete docstring `accepted > rejected > edited > superseded > pending` at the old @1362–1367.


---

## Phase S3 — Snapshot-driven layout + obsolete-field Notes

### Task 16: Decide anchor-vs-Run snapshot diff semantics + obsolete-field definition

**Files:**
- Read: `backend/app/services/extraction_run_read_service.py` (lines 131–174, snapshot read + narrow fallback)
- Read: `backend/app/schemas/extraction_run.py` (lines 145–186, `RunViewField`/`RunViewEntityType`)
- Read: `backend/app/services/extraction_snapshot.py` (snapshot key set)
- Read: `backend/app/repositories/extraction_template_version_repository.py` (`get_active` @24, `get_by_id` @48)
- No code changes in this task.

- [ ] **Step 1: Confirm the three read sources and fix their roles in writing (decision record only — no file output).** Resolve these before writing code, by re-reading the anchors above:
  - **Anchor (column layout):** the *active version* snapshot. `_load_active_template_version(template_id)` already returns the active `ExtractionTemplateVersion` row; it carries both `.id` and `.schema_`. The new `load_export_sections(db, *, version_id=...)` reads `db.get(ExtractionTemplateVersion, version_id).schema_["entity_types"]`, validates each via `RunViewEntityType`/`RunViewField`, and falls back to the live tables only when `_snapshot_is_narrow(...)` (mirror `extraction_run_read_service._entity_types_for_run`, lines 140–174). The anchor `version_id` passed in is the **active version's `.id`**.
  - **Per-Run diff source:** each `ArticleDescriptor.version_id` (the Run's own `version_id`, copied off `ExtractionRun.version_id` @608). Read its snapshot the same way and collect its field_id set.
  - **Obsolete-field definition (LOCKED for this slice):** a field is "obsolete for this article" iff its `field_id` is present in the *Run's* snapshot but **absent from the anchor** snapshot's field_id set. Label rendered = the Run-snapshot field's `label` (the anchor no longer has it). Surviving fields (in both) are filled normally; anchor-only fields (added after the Run finalized) simply have no value for that article. This matches spec §5.1: "fields that existed on an older Run but were removed from the anchor are recorded."
  - **Appraisal identification is OUT OF SCOPE for this slice** (owned by the Appraisal slice / spec §7 open decision). This slice only threads `cardinality`, `role`, `parent_entity_type_id`, and field metadata through the snapshot — it does not classify appraisal sections.
  - Confirm: `resolve_value` and the grown dataclasses (`FieldDescriptor` +4 fields, `SectionDescriptor` +cardinality/+sort_order, `ArticleDescriptor` `version_id` + `section_instances`) are **defined in the locked shared contract** — this slice implements them; it does not redefine them. The `value_envelope.resolve_value` resolver itself is owned by a sibling slice; this slice **consumes** it and only adds the obsolete-field + snapshot-reader behaviour. If `value_envelope.py` does not yet exist at integration time, the snapshot reader has no dependency on it (the reader is value-agnostic), so this slice can land independently.

  Output of this step is the written decision above carried into the code tasks; commit nothing.

---

### Task 17: SnapshotField/AllowedValue/SnapshotSection dataclasses + empty-version reader

**Files:**
- Create: `backend/app/services/exports/extraction_snapshot_reader.py`
- Test: `backend/tests/unit/test_extraction_export_snapshot_sections.py`

- [ ] **Step 1: Write the failing dataclass-shape test.** Create the test file asserting the contract dataclasses exist with the exact fields and that `load_export_sections` is importable:

```python
"""Unit tests for the snapshot section reader (spec §5.1)."""

from __future__ import annotations

import dataclasses
from uuid import uuid4

from app.models.extraction import (
    ExtractionCardinality,
    ExtractionEntityRole,
    ExtractionFieldType,
)
from app.services.exports.extraction_snapshot_reader import (
    AllowedValue,
    SnapshotField,
    SnapshotSection,
    load_export_sections,
)


def test_snapshot_field_carries_full_metadata() -> None:
    f = SnapshotField(
        field_id=uuid4(),
        name="age",
        label="Age",
        type=ExtractionFieldType.NUMBER,
        description="Patient age",
        llm_description="Extract the age",
        unit="years",
        allowed_values=(AllowedValue(value="x", label="x"),),
        is_required=True,
        allow_other=False,
        sort_order=0,
    )
    assert f.unit == "years"
    assert f.allowed_values[0].label == "x"
    assert dataclasses.is_dataclass(f)


def test_snapshot_section_carries_role_and_cardinality() -> None:
    s = SnapshotSection(
        entity_type_id=uuid4(),
        name="study",
        label="Study",
        role=ExtractionEntityRole.STUDY_SECTION,
        cardinality=ExtractionCardinality.ONE,
        parent_entity_type_id=None,
        sort_order=0,
        fields=(),
    )
    assert s.role is ExtractionEntityRole.STUDY_SECTION
    assert s.cardinality is ExtractionCardinality.ONE


def test_load_export_sections_is_async_callable() -> None:
    import inspect

    assert inspect.iscoroutinefunction(load_export_sections)
```

- [ ] **Step 2: Run it — expect FAIL (ModuleNotFoundError: extraction_snapshot_reader).** From `backend/`:
  `uv run pytest tests/unit/test_extraction_export_snapshot_sections.py -q`
  Expected: collection error / `ModuleNotFoundError`.

- [ ] **Step 3: Create the reader module with dataclasses + an empty-version path only.** Write the complete file; `load_export_sections` returns `()` when the version row or its `entity_types` are missing (the parse loop is added in the next step). Land imports atomically with usages:

```python
"""Snapshot section reader for the publication-ready xlsx export (spec §5.1).

Reads the frozen per-Run / per-version template snapshot
(``extraction_template_versions.schema_["entity_types"]``) and returns
ordered ``SnapshotSection`` descriptors carrying role + cardinality +
parent + full field metadata. This is the column-layout *anchor* and the
per-Run obsolete-field diff source. It mirrors
``extraction_run_read_service._entity_types_for_run``: validate the frozen
snapshot via ``RunViewEntityType``/``RunViewField``; fall back to the live
tables only for a pre-0026 *narrow* snapshot.

Layer-legal: ``services`` reading via the injected ``AsyncSession``; no
HTTP/storage/network types cross the boundary.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.extraction import (
    ExtractionCardinality,
    ExtractionEntityType,
    ExtractionFieldType,
)
from app.models.extraction_versioning import ExtractionTemplateVersion
from app.schemas.extraction_run import RunViewEntityType, RunViewField


@dataclass(frozen=True)
class AllowedValue:
    value: str
    label: str


@dataclass(frozen=True)
class SnapshotField:
    field_id: UUID
    name: str
    label: str
    type: ExtractionFieldType
    description: str | None
    llm_description: str | None
    unit: str | None
    allowed_values: tuple[AllowedValue, ...]
    is_required: bool
    allow_other: bool
    sort_order: int


@dataclass(frozen=True)
class SnapshotSection:
    entity_type_id: UUID
    name: str
    label: str
    role: Any  # ExtractionEntityRole — typed loosely to avoid an import cycle on load
    cardinality: ExtractionCardinality
    parent_entity_type_id: UUID | None
    sort_order: int
    fields: tuple[SnapshotField, ...]


def _snapshot_is_narrow(entity_types: list[dict[str, Any]]) -> bool:
    """A pre-0026 snapshot lacks 'role' on its first entity_type (mirrors the
    run-read service). Empty trees are treated as narrow so the live fallback
    repopulates them."""
    return not entity_types or "role" not in entity_types[0]


async def load_export_sections(
    db: AsyncSession,
    *,
    version_id: UUID,
) -> tuple[SnapshotSection, ...]:
    """Read the frozen entity_types tree for a version snapshot, ordered by
    ``sort_order``. Returns ``()`` when the version row or its tree is missing."""
    version = await db.get(ExtractionTemplateVersion, version_id)
    snapshot_types: list[dict[str, Any]] = (
        (version.schema_ or {}).get("entity_types", []) if version else []
    )
    if not snapshot_types:
        return ()
    if _snapshot_is_narrow(snapshot_types):
        return await _load_live_sections(db, version.project_template_id)
    return tuple(
        _section_from_view(RunViewEntityType.model_validate(et)) for et in snapshot_types
    )


def _section_from_view(view: RunViewEntityType) -> SnapshotSection:
    from app.models.extraction import ExtractionEntityRole

    return SnapshotSection(
        entity_type_id=view.id,
        name=view.name,
        label=view.label,
        role=ExtractionEntityRole(view.role),
        cardinality=ExtractionCardinality(view.cardinality),
        parent_entity_type_id=view.parent_entity_type_id,
        sort_order=view.sort_order,
        fields=tuple(_field_from_view(f) for f in sorted(view.fields, key=lambda x: x.sort_order)),
    )


def _field_from_view(view: RunViewField) -> SnapshotField:
    return SnapshotField(
        field_id=view.id,
        name=view.name,
        label=view.label,
        type=ExtractionFieldType(view.field_type),
        description=view.description,
        llm_description=view.llm_description,
        unit=view.unit,
        allowed_values=_normalize_allowed_values(view.allowed_values),
        is_required=view.is_required,
        allow_other=view.allow_other,
        sort_order=view.sort_order,
    )


def _normalize_allowed_values(raw: Any) -> tuple[AllowedValue, ...]:
    """Normalise the ``allowed_values`` jsonb into ordered value+label pairs.

    Stored either as ``[{"value": ..., "label": ...}, ...]`` or ``["x", ...]``;
    value == label in prumo (spec §11), but both are preserved when present.
    """
    if not isinstance(raw, list):
        return ()
    out: list[AllowedValue] = []
    for item in raw:
        if isinstance(item, dict):
            value = item.get("value")
            label = item.get("label") or value
            if isinstance(value, str):
                out.append(AllowedValue(value=value, label=str(label)))
        elif isinstance(item, str):
            out.append(AllowedValue(value=item, label=item))
    return tuple(out)


async def _load_live_sections(
    db: AsyncSession,
    project_template_id: UUID,
) -> tuple[SnapshotSection, ...]:
    """Live-table fallback for pre-0026 narrow snapshots (belt-and-suspenders).

    One statement, fields eager-loaded; validated through the same
    ``RunViewEntityType`` path so both branches produce the same shape.
    """
    et_rows = (
        (
            await db.execute(
                select(ExtractionEntityType)
                .where(ExtractionEntityType.project_template_id == project_template_id)
                .options(selectinload(ExtractionEntityType.fields))
                .order_by(ExtractionEntityType.sort_order)
            )
        )
        .scalars()
        .all()
    )
    return tuple(_section_from_view(RunViewEntityType.model_validate(et)) for et in et_rows)
```

- [ ] **Step 4: Run the unit test — expect PASS.** From `backend/`:
  `uv run pytest tests/unit/test_extraction_export_snapshot_sections.py -q`
  Expected: 3 passed.

- [ ] **Step 5: Lint + format the new file.** From `backend/`:
  `uv run ruff check app/services/exports/extraction_snapshot_reader.py tests/unit/test_extraction_export_snapshot_sections.py && uv run ruff format app/services/exports/extraction_snapshot_reader.py tests/unit/test_extraction_export_snapshot_sections.py`
  Expected: no errors.

- [ ] **Step 6: Commit.**
  `git add backend/app/services/exports/extraction_snapshot_reader.py backend/tests/unit/test_extraction_export_snapshot_sections.py && git commit -m "$(printf 'feat(export): add snapshot section reader dataclasses\n\nReads the frozen per-version entity_types tree via RunViewEntityType/\nRunViewField, mirroring extraction_run_read_service. Anchor for the\nsnapshot-driven xlsx layout (spec §5.1).\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"`

---

### Task 18: Integration test — load_export_sections reads a real version snapshot

**Files:**
- Modify: `backend/app/services/exports/extraction_snapshot_reader.py` (no change expected — this proves the parse loop against real jsonb; if a key mismatch surfaces, fix here)
- Test: `backend/tests/integration/test_extraction_export_snapshot_diff.py`

- [ ] **Step 1: Write the failing integration test that reads the seeded active version.** Mirror the manual-only-flow fixture resolution (scope every query by `project_id`). It resolves the seeded extraction template, takes its active version, and asserts the reader returns ordered sections with role/cardinality populated:

```python
"""Integration: snapshot section reader against real local Supabase (spec §5.1)."""

from __future__ import annotations

from uuid import UUID

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.extraction import ExtractionEntityRole
from app.repositories.extraction_template_version_repository import (
    ExtractionTemplateVersionRepository,
)
from app.services.exports.extraction_snapshot_reader import load_export_sections


async def _seeded_template_id(db: AsyncSession) -> UUID:
    project_id = (
        await db.execute(text("SELECT id FROM public.projects LIMIT 1"))
    ).scalar()
    template_id = (
        await db.execute(
            text(
                "SELECT id FROM public.project_extraction_templates "
                "WHERE kind = 'extraction' AND project_id = :pid LIMIT 1"
            ),
            {"pid": project_id},
        )
    ).scalar()
    if template_id is None:
        pytest.skip("No seeded extraction template")
    return UUID(str(template_id))


@pytest.mark.asyncio
async def test_load_export_sections_reads_active_version_snapshot(
    db_session: AsyncSession,
) -> None:
    template_id = await _seeded_template_id(db_session)
    version = await ExtractionTemplateVersionRepository(db_session).get_active(template_id)
    assert version is not None, "seeded template must have an active version"

    sections = await load_export_sections(db_session, version_id=version.id)

    assert sections, "active version snapshot must yield sections"
    # Ordered by sort_order, ascending.
    orders = [s.sort_order for s in sections]
    assert orders == sorted(orders)
    # Every section carries a real role + cardinality from the snapshot.
    for s in sections:
        assert isinstance(s.role, ExtractionEntityRole)
        assert s.cardinality is not None
    # At least one study section exists in the seeded CHARMS template.
    assert any(s.role is ExtractionEntityRole.STUDY_SECTION for s in sections)
    # Field metadata threads through (label + field_id present on every field).
    a_field = next((f for s in sections for f in s.fields), None)
    assert a_field is not None
    assert a_field.label
```

- [ ] **Step 2: Run it — expect PASS (reader already implemented; this proves the real jsonb parses).** From `backend/`:
  `uv run pytest tests/integration/test_extraction_export_snapshot_diff.py -q`
  Expected: 1 passed. If a `pydantic` validation error or key mismatch surfaces against the real snapshot, that is the signal to fix `extraction_snapshot_reader.py` (do NOT loosen the test). Re-run until green.

- [ ] **Step 3: Lint + format.** From `backend/`:
  `uv run ruff check tests/integration/test_extraction_export_snapshot_diff.py && uv run ruff format tests/integration/test_extraction_export_snapshot_diff.py`

- [ ] **Step 4: Commit.**
  `git add backend/tests/integration/test_extraction_export_snapshot_diff.py && git commit -m "$(printf 'test(export): prove snapshot reader parses a real version snapshot\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"`

---

### Task 19: Grow FieldDescriptor + SectionDescriptor with snapshot metadata

**Files:**
- Modify: `backend/app/services/extraction_export_service.py` (`FieldDescriptor` @72, `SectionDescriptor` @83)
- Test: `backend/tests/unit/test_extraction_export_descriptors.py`

- [ ] **Step 1: Write the failing descriptor-field test.** New file asserting the four new `FieldDescriptor` fields and the new `SectionDescriptor.cardinality`/`sort_order`/`description` default to back-compat values:

```python
"""Unit tests for the grown export descriptor dataclasses (spec §5.1)."""

from __future__ import annotations

from uuid import uuid4

from app.models.extraction import (
    ExtractionCardinality,
    ExtractionEntityRole,
    ExtractionFieldType,
)
from app.services.extraction_export_service import FieldDescriptor, SectionDescriptor


def test_field_descriptor_carries_snapshot_metadata() -> None:
    f = FieldDescriptor(
        field_id=uuid4(),
        label="Dose",
        type=ExtractionFieldType.NUMBER,
        allowed_values=(),
        parent_section_id=uuid4(),
        description="Administered dose",
        unit="mg",
        is_required=True,
        allow_other=True,
    )
    assert f.description == "Administered dose"
    assert f.unit == "mg"
    assert f.is_required is True
    assert f.allow_other is True


def test_field_descriptor_metadata_defaults_are_back_compat() -> None:
    f = FieldDescriptor(
        field_id=uuid4(),
        label="Name",
        type=ExtractionFieldType.TEXT,
        allowed_values=(),
        parent_section_id=uuid4(),
    )
    assert f.description is None
    assert f.unit is None
    assert f.is_required is False
    assert f.allow_other is False


def test_section_descriptor_carries_cardinality_and_sort_order() -> None:
    s = SectionDescriptor(
        entity_type_id=uuid4(),
        label="Outcomes",
        role=ExtractionEntityRole.STUDY_SECTION,
        parent_entity_type_id=None,
        fields=(),
        cardinality=ExtractionCardinality.MANY,
        sort_order=3,
        description="Per-outcome rows",
    )
    assert s.cardinality is ExtractionCardinality.MANY
    assert s.sort_order == 3
    assert s.description == "Per-outcome rows"


def test_section_descriptor_defaults_are_back_compat() -> None:
    s = SectionDescriptor(
        entity_type_id=uuid4(),
        label="Study",
        role=ExtractionEntityRole.STUDY_SECTION,
        parent_entity_type_id=None,
        fields=(),
    )
    assert s.cardinality is ExtractionCardinality.ONE
    assert s.sort_order == 0
    assert s.description is None
```

- [ ] **Step 2: Run — expect FAIL (TypeError: unexpected keyword argument 'description').** From `backend/`:
  `uv run pytest tests/unit/test_extraction_export_descriptors.py -q`
  Expected: errors on the new kwargs.

- [ ] **Step 3: Grow `FieldDescriptor`.** Replace the dataclass body (anchor @72–80):

```python
@dataclass(frozen=True)
class FieldDescriptor:
    """One field within an entity_type (= one row on the matrix sheet).

    Metadata fields (``description``/``unit``/``is_required``/``allow_other``)
    are carried from the per-Run version snapshot (spec §5.1) and consumed by
    the data-dictionary + value resolver. Defaulted for back-compat with
    existing ``()``-arg call sites.
    """

    field_id: UUID
    label: str
    type: ExtractionFieldType
    allowed_values: tuple[str, ...]
    parent_section_id: UUID
    description: str | None = None
    unit: str | None = None
    is_required: bool = False
    allow_other: bool = False
```

- [ ] **Step 4: Grow `SectionDescriptor`.** Replace the dataclass body (anchor @83–96), adding the import of `ExtractionCardinality` — it is already imported at the top of the module (line 38), so no new import is needed:

```python
@dataclass(frozen=True)
class SectionDescriptor:
    """One section (entity_type) — drives section header + field rows.

    ``cardinality`` is the fan-out key (spec §5.2): ``MANY`` fans out one
    record per instance for ANY role; ``ONE`` is one record per article.
    Sections are emitted in ``sort_order``.
    """

    entity_type_id: UUID
    label: str
    role: ExtractionEntityRole
    parent_entity_type_id: UUID | None
    fields: tuple[FieldDescriptor, ...]
    cardinality: ExtractionCardinality = ExtractionCardinality.ONE
    sort_order: int = 0
    description: str | None = None
```

- [ ] **Step 5: Run — expect PASS.** From `backend/`:
  `uv run pytest tests/unit/test_extraction_export_descriptors.py -q`
  Expected: 4 passed.

- [ ] **Step 6: Run the existing builder + determinism + export-service unit tests to prove no regression from the defaulted fields.** From `backend/`:
  `uv run pytest tests/unit/test_extraction_xlsx_builder.py tests/unit/test_extraction_export_determinism.py tests/unit/test_extraction_export_service.py -q`
  Expected: all pass (the new fields default, so existing `FieldDescriptor(...)`/`SectionDescriptor(...)` constructions are unaffected).

- [ ] **Step 7: Lint + format.** From `backend/`:
  `uv run ruff check app/services/extraction_export_service.py tests/unit/test_extraction_export_descriptors.py && uv run ruff format app/services/extraction_export_service.py tests/unit/test_extraction_export_descriptors.py`

- [ ] **Step 8: Commit.**
  `git add backend/app/services/extraction_export_service.py backend/tests/unit/test_extraction_export_descriptors.py && git commit -m "$(printf 'feat(export): carry snapshot field metadata onto descriptors\n\nFieldDescriptor gains description/unit/is_required/allow_other;\nSectionDescriptor gains cardinality/sort_order/description. All\nback-compat-defaulted (spec §5.1/§5.2).\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"`

---

### Task 20: Grow ArticleDescriptor — version_id + ordered section_instances

**Files:**
- Modify: `backend/app/services/extraction_export_service.py` (`ArticleDescriptor` @99–112; the three `study_instances.setdefault(...)` build sites @533/542, @764/770, @983/989; `instance_index_by_id` build @1268–1273)
- Test: `backend/tests/unit/test_extraction_export_article_descriptor.py`

> This task renames `study_instances: dict[UUID, UUID]` → `section_instances: dict[UUID, tuple[UUID, ...]]` and adds `version_id`. The builder still references `study_instances` — the builder rename is a sibling slice (matrix/tidy). To keep this slice green, this task also adds a **read-compat alias property** `study_instances` that projects the first id per section, so the unchanged builder + the existing `test_extraction_xlsx_builder.py` keep passing until the builder slice lands.

- [ ] **Step 1: Write the failing test for the new shape + the compat alias.**

```python
"""Unit tests for the grown ArticleDescriptor (spec §5.1/§6 medium bug)."""

from __future__ import annotations

from uuid import uuid4

from app.services.extraction_export_service import ArticleDescriptor


def test_article_descriptor_carries_version_id_and_ordered_instances() -> None:
    section_a = uuid4()
    i1, i2, i3 = uuid4(), uuid4(), uuid4()
    a = ArticleDescriptor(
        article_id=uuid4(),
        header_label="Gaca, 2011",
        run_id=uuid4(),
        run_stage=None,
        version_id=uuid4(),
        model_instances=(),
        section_instances={section_a: (i1, i2, i3)},
    )
    assert a.section_instances[section_a] == (i1, i2, i3)
    assert a.version_id is not None


def test_study_instances_alias_projects_first_instance_per_section() -> None:
    """Back-compat read alias for the not-yet-migrated builder: one id per
    section (the first), preserving the legacy dict[UUID, UUID] contract."""
    section_a, section_b = uuid4(), uuid4()
    i1, i2 = uuid4(), uuid4()
    a = ArticleDescriptor(
        article_id=uuid4(),
        header_label="X",
        run_id=uuid4(),
        run_stage=None,
        version_id=None,
        model_instances=(),
        section_instances={section_a: (i1, i2), section_b: ()},
    )
    # First instance projected; empty tuples are dropped (no value to show).
    assert a.study_instances == {section_a: i1}
```

- [ ] **Step 2: Run — expect FAIL (unexpected keyword 'version_id'/'section_instances').** From `backend/`:
  `uv run pytest tests/unit/test_extraction_export_article_descriptor.py -q`
  Expected: TypeError.

- [ ] **Step 3: Rewrite `ArticleDescriptor`** (anchor @99–112) with `version_id`, `section_instances`, and the read-compat alias. `frozen=True` forbids instance methods that mutate, but a read-only `@property` is allowed:

```python
@dataclass(frozen=True)
class ArticleDescriptor:
    """One article column (or N adjacent columns when multi-instance).

    ``section_instances`` carries an ORDERED instance-id tuple per
    study/section entity_type — fixing the §6 medium bug where
    ``setdefault`` kept only the first instance and silently lost the rest.
    Single-cardinality sections carry a 1-tuple. ``version_id`` is the Run's
    own snapshot version, used for the per-Run obsolete-field diff (§5.1).
    """

    article_id: UUID
    header_label: str
    run_id: UUID | None
    run_stage: ExtractionRunStage | None
    version_id: UUID | None
    # Ordered model_section instance ids; empty when the template has no
    # model_container OR when the article has zero model instances.
    model_instances: tuple[UUID, ...]
    # entity_type_id (study/section) → ORDERED instance ids for the run.
    section_instances: dict[UUID, tuple[UUID, ...]]

    @property
    def study_instances(self) -> dict[UUID, UUID]:
        """Read-compat alias: first instance per section (legacy dict shape).

        Consumed by the not-yet-migrated matrix builder + AI loader until the
        builder slice fans out over ``section_instances``. Sections with no
        instance are dropped (nothing to render).
        """
        return {sid: ids[0] for sid, ids in self.section_instances.items() if ids}
```

- [ ] **Step 4: Update the three consensus/single/all-users build sites** to collect ordered tuples and pass `version_id` + `section_instances`. In `_resolve_articles_for_consensus` (@529–555), replace the per-article instance loop + the `ArticleDescriptor(...)` construction with:

```python
        for aid in kept_articles:
            run = runs_by_article[aid]
            insts = instances_by_run.get(run.id, [])
            model_instances: list[UUID] = []
            section_instances: dict[UUID, list[UUID]] = {}
            for inst in insts:
                role = entity_by_id.get(inst.entity_type_id)
                if role is ExtractionEntityRole.MODEL_SECTION:
                    model_instances.append(inst.id)
                elif role is ExtractionEntityRole.STUDY_SECTION:
                    # Ordered list per entity_type — many-cardinality study
                    # sections keep ALL instances (spec §5.2 fan-out source).
                    section_instances.setdefault(inst.entity_type_id, []).append(inst.id)
                # model_container instances carry no values themselves.

            descriptors.append(
                ArticleDescriptor(
                    article_id=aid,
                    header_label=headers.get(aid) or _short_id(aid),
                    run_id=run.id,
                    run_stage=ExtractionRunStage(run.stage),
                    version_id=run.version_id,
                    model_instances=tuple(model_instances),
                    section_instances={k: tuple(v) for k, v in section_instances.items()},
                )
            )
```

  Apply the **identical** transformation to `_resolve_articles_for_single_user` (@760–780) and `_resolve_articles_for_all_users` (@979–999) — same loop, same `ArticleDescriptor(...)` kwargs (each already has `run` in scope with `.version_id`).

- [ ] **Step 5: Fix the AI loader's instance-index map** (@1268–1273) — it reads `article.study_instances.values()`, which now returns at most one id per section. Replace it to iterate the full ordered `section_instances` so each instance gets a 1-based index per section:

```python
        instance_index_by_id: dict[UUID, int] = {}
        for article in articles:
            for idx, iid in enumerate(article.model_instances, start=1):
                instance_index_by_id[iid] = idx
            for ids in article.section_instances.values():
                for idx, iid in enumerate(ids, start=1):
                    instance_index_by_id[iid] = idx
```

- [ ] **Step 6: Run the new descriptor test — expect PASS.** From `backend/`:
  `uv run pytest tests/unit/test_extraction_export_article_descriptor.py -q`
  Expected: 2 passed.

- [ ] **Step 7: Run the existing builder + export-service unit tests to prove the compat alias holds.** From `backend/`:
  `uv run pytest tests/unit/test_extraction_xlsx_builder.py tests/unit/test_extraction_export_service.py tests/unit/test_extraction_export_determinism.py -q`
  Expected: all pass (builder reads `study_instances` via the alias; the test factory `_article(... study_instances=...)` is a sibling-slice concern — if `test_extraction_xlsx_builder.py`'s `_article` factory still passes `study_instances=` as a constructor kwarg it will now fail, because it is a property. If so, this task ALSO updates that factory: change `_article` to accept `section_instances` and build `section_instances={sid: (iid,) for sid, iid in study_instances.items()}` from its existing `study_instances=` argument so the call sites stay unchanged). Re-run until green.

- [ ] **Step 8: Lint + format.** From `backend/`:
  `uv run ruff check app/services/extraction_export_service.py tests/unit/test_extraction_export_article_descriptor.py tests/unit/test_extraction_xlsx_builder.py && uv run ruff format app/services/extraction_export_service.py tests/unit/test_extraction_export_article_descriptor.py tests/unit/test_extraction_xlsx_builder.py`

- [ ] **Step 9: Commit.**
  `git add backend/app/services/extraction_export_service.py backend/tests/unit/test_extraction_export_article_descriptor.py backend/tests/unit/test_extraction_xlsx_builder.py && git commit -m "$(printf 'feat(export): ordered section_instances + version_id on ArticleDescriptor\n\nFix the §6 many-cardinality collapse (setdefault dropped N-1\ninstances) by carrying an ordered instance tuple per section, and add\nthe Run version_id for the per-Run obsolete-field diff. A read-compat\nstudy_instances alias keeps the un-migrated builder green.\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"`

---

### Task 21: Switch _load_sections to the snapshot reader (anchor-driven layout)

**Files:**
- Modify: `backend/app/services/extraction_export_service.py` (`_load_sections` @414–475; its call site in `resolve_layout` @273; imports @36–46)
- Test: `backend/tests/unit/test_extraction_export_load_sections.py`

- [ ] **Step 1: Write a failing test that `_load_sections` consumes a version_id and maps snapshot sections → SectionDescriptor with metadata.** Use a fake `db` whose `get(...)` returns a stub version carrying a hand-built `schema_["entity_types"]` (role + cardinality + a field with unit/description); assert the resulting `SectionDescriptor`/`FieldDescriptor` carry the metadata. The new private method signature is `_load_sections(self, version_id: UUID)`:

```python
"""Unit tests for snapshot-driven _load_sections (spec §5.1)."""

from __future__ import annotations

from uuid import uuid4

import pytest

from app.models.extraction import ExtractionCardinality, ExtractionEntityRole
from app.services.extraction_export_service import ExtractionExportService


class _StubVersion:
    def __init__(self, schema: dict) -> None:
        self.schema_ = schema
        self.project_template_id = uuid4()


class _StubDB:
    def __init__(self, version: _StubVersion) -> None:
        self._version = version

    async def get(self, _model, _pk):  # noqa: ANN001 — mimics AsyncSession.get
        return self._version


@pytest.mark.asyncio
async def test_load_sections_maps_snapshot_metadata() -> None:
    eid = str(uuid4())
    fid = str(uuid4())
    schema = {
        "entity_types": [
            {
                "id": eid,
                "name": "outcomes",
                "label": "Outcomes",
                "description": "per outcome",
                "parent_entity_type_id": None,
                "cardinality": "many",
                "role": "study_section",
                "sort_order": 2,
                "is_required": True,
                "fields": [
                    {
                        "id": fid,
                        "name": "dose",
                        "label": "Dose",
                        "description": "Dose given",
                        "field_type": "number",
                        "is_required": True,
                        "allowed_values": None,
                        "unit": "mg",
                        "sort_order": 0,
                        "llm_description": "extract dose",
                        "allow_other": True,
                    }
                ],
            }
        ]
    }
    svc = ExtractionExportService(
        db=_StubDB(_StubVersion(schema)),  # type: ignore[arg-type]
        user_id=str(uuid4()),
        storage=None,  # type: ignore[arg-type]
    )
    sections = await svc._load_sections(uuid4())

    assert len(sections) == 1
    s = sections[0]
    assert s.role is ExtractionEntityRole.STUDY_SECTION
    assert s.cardinality is ExtractionCardinality.MANY
    assert s.sort_order == 2
    f = s.fields[0]
    assert f.unit == "mg"
    assert f.description == "Dose given"
    assert f.is_required is True
    assert f.allow_other is True
```

- [ ] **Step 2: Run — expect FAIL (`_load_sections` currently takes `template_id` and queries live tables; the stub db has no `execute`).** From `backend/`:
  `uv run pytest tests/unit/test_extraction_export_load_sections.py -q`
  Expected: TypeError / AttributeError on the live query path.

- [ ] **Step 3: Rewrite `_load_sections`** (anchor @414–475) to delegate to the snapshot reader and map `SnapshotSection`/`SnapshotField` → `SectionDescriptor`/`FieldDescriptor`. Add the import atomically with the usage. Replace the whole method body:

```python
    async def _load_sections(
        self,
        version_id: UUID,
    ) -> tuple[SectionDescriptor, ...]:
        """Load the column-layout sections from the ACTIVE version snapshot.

        Snapshot-driven (spec §5.1): reads the frozen entity_types tree via
        ``load_export_sections`` (mirrors the run-read path), not the live
        ``extraction_entity_types`` / ``extraction_fields`` tables. Carries
        role + cardinality + full field metadata onto the descriptors.
        """
        snapshot_sections = await load_export_sections(self.db, version_id=version_id)
        return tuple(
            SectionDescriptor(
                entity_type_id=s.entity_type_id,
                label=s.label,
                role=s.role,
                parent_entity_type_id=s.parent_entity_type_id,
                fields=tuple(
                    FieldDescriptor(
                        field_id=f.field_id,
                        label=f.label,
                        type=f.type,
                        allowed_values=tuple(av.label for av in f.allowed_values),
                        parent_section_id=s.entity_type_id,
                        description=f.description or f.llm_description,
                        unit=f.unit,
                        is_required=f.is_required,
                        allow_other=f.allow_other,
                    )
                    for f in s.fields
                ),
                cardinality=s.cardinality,
                sort_order=s.sort_order,
                description=s.description,
            )
            for s in snapshot_sections
        )
```

  Add the import next to the existing repository imports (around line 52):

```python
from app.services.exports.extraction_snapshot_reader import load_export_sections
```

- [ ] **Step 4: Update the `resolve_layout` call site** (@273). The active `version` row is already loaded at @271; pass its `.id` as the anchor version_id:

```python
        template, version = await self._load_active_template_version(template_id)
        project_name = await self._resolve_project_name(project_id)
        sections = await self._load_sections(version.id)
```

- [ ] **Step 5: Run the new test — expect PASS.** From `backend/`:
  `uv run pytest tests/unit/test_extraction_export_load_sections.py -q`
  Expected: 1 passed.

- [ ] **Step 6: Run the integration export-service + export-endpoint tests** to confirm the real seeded snapshot still produces the same sections through `resolve_layout`. From `backend/`:
  `uv run pytest tests/integration/test_extraction_export_snapshot_diff.py tests/integration/test_extraction_export_endpoint.py -q`
  Expected: pass. The reader's narrow-snapshot live fallback covers any pre-0026 seeded version.

- [ ] **Step 7: Lint + format.** From `backend/`:
  `uv run ruff check app/services/extraction_export_service.py tests/unit/test_extraction_export_load_sections.py && uv run ruff format app/services/extraction_export_service.py tests/unit/test_extraction_export_load_sections.py`

- [ ] **Step 8: Commit.**
  `git add backend/app/services/extraction_export_service.py backend/tests/unit/test_extraction_export_load_sections.py && git commit -m "$(printf 'feat(export): drive section layout from the version snapshot\n\n_load_sections now reads the active-version snapshot via\nload_export_sections instead of the live entity_types/fields tables,\ncarrying role/cardinality/field-metadata onto the descriptors (spec\n§5.1). Anchors columns on the frozen template version.\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"`

---

### Task 22: Populate ExportNotes.obsolete_fields_per_article via per-Run snapshot diff

**Files:**
- Modify: `backend/app/services/extraction_export_service.py` (`resolve_layout` notes assembly @316–323; add a private `_compute_obsolete_fields_per_article` helper)
- Test: `backend/tests/unit/test_extraction_export_obsolete_fields.py`

- [ ] **Step 1: Write a failing unit test for the diff helper.** It exercises the pure diff against an anchor field-id set + per-Run snapshots, keyed by article_id. The helper takes the anchor field_ids and a per-article mapping of `version_id` → already-loaded `SnapshotSection`s (so the test stays DB-free; the real `resolve_layout` loads them via the reader). Signature:
  `async def _compute_obsolete_fields_per_article(self, *, articles, anchor_field_ids) -> dict[UUID, list[str]]` — it reads each distinct `article.version_id` snapshot through `load_export_sections`. For the unit test we patch the reader via a stub db `get`:

```python
"""Unit tests for obsolete-field diff against the anchor snapshot (spec §5.1)."""

from __future__ import annotations

from uuid import uuid4

import pytest

from app.services.extraction_export_service import ArticleDescriptor, ExtractionExportService


def _et(eid: str, fields: list[dict]) -> dict:
    return {
        "id": eid,
        "name": "s",
        "label": "S",
        "description": None,
        "parent_entity_type_id": None,
        "cardinality": "one",
        "role": "study_section",
        "sort_order": 0,
        "is_required": False,
        "fields": fields,
    }


def _f(fid: str, label: str) -> dict:
    return {
        "id": fid,
        "name": label.lower(),
        "label": label,
        "description": None,
        "field_type": "text",
        "is_required": False,
        "allowed_values": None,
        "unit": None,
        "sort_order": 0,
        "llm_description": None,
        "allow_other": False,
    }


class _StubVersion:
    def __init__(self, schema: dict) -> None:
        self.schema_ = schema
        self.project_template_id = uuid4()


class _StubDB:
    """Returns a different snapshot per version_id (keyed)."""

    def __init__(self, by_version: dict) -> None:
        self._by_version = by_version

    async def get(self, _model, pk):  # noqa: ANN001
        return self._by_version.get(pk)


@pytest.mark.asyncio
async def test_obsolete_fields_are_run_only_fields_absent_from_anchor() -> None:
    surviving_fid = str(uuid4())
    removed_fid = str(uuid4())
    run_version = uuid4()

    # Anchor knows only the surviving field.
    anchor_field_ids = {surviving_fid}

    # The Run's own snapshot still has BOTH fields → removed_fid is obsolete.
    run_schema = {"entity_types": [_et(str(uuid4()), [_f(surviving_fid, "Kept"), _f(removed_fid, "Dropped")])]}
    db = _StubDB({run_version: _StubVersion(run_schema)})

    svc = ExtractionExportService(db=db, user_id=str(uuid4()), storage=None)  # type: ignore[arg-type]

    article = ArticleDescriptor(
        article_id=uuid4(),
        header_label="Gaca, 2011",
        run_id=uuid4(),
        run_stage=None,
        version_id=run_version,
        model_instances=(),
        section_instances={},
    )
    out = await svc._compute_obsolete_fields_per_article(
        articles=(article,),
        anchor_field_ids={__import__("uuid").UUID(surviving_fid)},
    )
    assert out == {article.article_id: ["Dropped"]}


@pytest.mark.asyncio
async def test_no_obsolete_fields_when_run_matches_anchor() -> None:
    fid = str(uuid4())
    run_version = uuid4()
    run_schema = {"entity_types": [_et(str(uuid4()), [_f(fid, "Kept")])]}
    db = _StubDB({run_version: _StubVersion(run_schema)})
    svc = ExtractionExportService(db=db, user_id=str(uuid4()), storage=None)  # type: ignore[arg-type]
    article = ArticleDescriptor(
        article_id=uuid4(),
        header_label="X",
        run_id=uuid4(),
        run_stage=None,
        version_id=run_version,
        model_instances=(),
        section_instances={},
    )
    out = await svc._compute_obsolete_fields_per_article(
        articles=(article,),
        anchor_field_ids={__import__("uuid").UUID(fid)},
    )
    assert out == {}
```

- [ ] **Step 2: Run — expect FAIL (`_compute_obsolete_fields_per_article` does not exist).** From `backend/`:
  `uv run pytest tests/unit/test_extraction_export_obsolete_fields.py -q`
  Expected: AttributeError.

- [ ] **Step 3: Add the helper** to the service (place it after `_load_sections`). It memoises per-`version_id` snapshot reads (multiple articles can share a version), then diffs each Run's field set against the anchor:

```python
    async def _compute_obsolete_fields_per_article(
        self,
        *,
        articles: tuple[ArticleDescriptor, ...],
        anchor_field_ids: set[UUID],
    ) -> dict[UUID, list[str]]:
        """Fields present on a Run's frozen snapshot but removed from the anchor.

        Spec §5.1: each Run's own version snapshot is diffed by ``field_id``
        against the active-version anchor. Surviving fields are filled
        elsewhere; Run-only fields (removed from the anchor after the Run
        finalized) are recorded here, labelled from the Run snapshot (the
        anchor no longer carries the label). Empty when nothing was removed.
        """
        snapshot_fields_cache: dict[UUID, tuple[tuple[UUID, str], ...]] = {}
        out: dict[UUID, list[str]] = {}
        for article in articles:
            version_id = article.version_id
            if version_id is None:
                continue
            if version_id not in snapshot_fields_cache:
                run_sections = await load_export_sections(self.db, version_id=version_id)
                snapshot_fields_cache[version_id] = tuple(
                    (f.field_id, f.label) for s in run_sections for f in s.fields
                )
            obsolete = [
                label
                for fid, label in snapshot_fields_cache[version_id]
                if fid not in anchor_field_ids
            ]
            if obsolete:
                out[article.article_id] = obsolete
        return out
```

- [ ] **Step 4: Wire it into `resolve_layout`.** After `sections` is built (@273) and after articles are resolved per mode (the `articles` list exists in every branch before the `notes = ExportNotes(...)` at @316), compute the anchor field-id set from `sections` and call the helper. Insert immediately before the `notes = ExportNotes(...)` construction:

```python
        anchor_field_ids = {f.field_id for s in sections for f in s.fields}
        obsolete_fields = await self._compute_obsolete_fields_per_article(
            articles=tuple(articles),
            anchor_field_ids=anchor_field_ids,
        )

        notes = ExportNotes(
            omitted_articles_by_stage=omitted,
            obsolete_fields_per_article=obsolete_fields,
            template_version_label=f"{template.name} v{version.version}",
            export_mode_label=mode.value,
            anonymize_reviewer_names=anonymize_reviewer_names,
            include_ai_metadata=include_ai_metadata,
            generated_at=datetime.now(UTC),
        )
```

- [ ] **Step 5: Run the new unit test — expect PASS.** From `backend/`:
  `uv run pytest tests/unit/test_extraction_export_obsolete_fields.py -q`
  Expected: 2 passed.

- [ ] **Step 6: Run the builder Notes-rendering test path to confirm the now-populated dict renders.** The builder's `_write_notes_sheet` already renders `notes.obsolete_fields_per_article` (anchor @404–408). From `backend/`:
  `uv run pytest tests/unit/test_extraction_xlsx_builder.py tests/unit/test_extraction_export_determinism.py -q`
  Expected: pass (an empty dict in those fixtures still renders nothing; no regression).

- [ ] **Step 7: Lint + format.** From `backend/`:
  `uv run ruff check app/services/extraction_export_service.py tests/unit/test_extraction_export_obsolete_fields.py && uv run ruff format app/services/extraction_export_service.py tests/unit/test_extraction_export_obsolete_fields.py`

- [ ] **Step 8: Commit.**
  `git add backend/app/services/extraction_export_service.py backend/tests/unit/test_extraction_export_obsolete_fields.py && git commit -m "$(printf 'feat(export): populate obsolete_fields_per_article via snapshot diff\n\nresolve_layout now diffs each Run version snapshot by field_id against\nthe active-version anchor and records Run-only (removed) fields in\nExportNotes, activating the previously-declared-but-never-populated\nfield (spec §5.1). Rendered by the existing Notes sheet.\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"`

---

### Task 23: Integration test — obsolete-field path with a real removed field

**Files:**
- Modify: `backend/tests/integration/test_extraction_export_snapshot_diff.py` (add a second test)
- No production code change expected (proves the wired path end-to-end against real Supabase).

- [ ] **Step 1: Write the failing/proving integration test.** Construct two version rows for the seeded template: an **anchor** version (active, schema with field A only) and an **older** version (schema with fields A + B). Create a Run pinned to the older version, finalize-or-not is irrelevant to the diff (the diff is layout-only), and assert `_compute_obsolete_fields_per_article` reports field B's label for that article. Scope every helper query by `project_id`; insert version rows + run via the session (use `db_session`, transaction-rolled-back). Use `ExtractionTemplateVersion` and `ArticleDescriptor` directly:

```python
@pytest.mark.asyncio
async def test_obsolete_field_reported_when_run_pinned_to_older_version(
    db_session: AsyncSession,
) -> None:
    from uuid import uuid4

    from app.models.extraction_versioning import ExtractionTemplateVersion
    from app.services.extraction_export_service import (
        ArticleDescriptor,
        ExtractionExportService,
    )

    template_id = await _seeded_template_id(db_session)
    project_id = (
        await db_session.execute(
            text(
                "SELECT project_id FROM public.project_extraction_templates "
                "WHERE id = :tid"
            ),
            {"tid": str(template_id)},
        )
    ).scalar()
    article_id = (
        await db_session.execute(
            text("SELECT id FROM public.articles WHERE project_id = :pid LIMIT 1"),
            {"pid": project_id},
        )
    ).scalar()
    if article_id is None:
        pytest.skip("No seeded article in project")

    kept_fid = str(uuid4())
    removed_fid = str(uuid4())
    et_id = str(uuid4())

    def _et(fields: list[dict]) -> dict:
        return {
            "id": et_id,
            "name": "s",
            "label": "S",
            "description": None,
            "parent_entity_type_id": None,
            "cardinality": "one",
            "role": "study_section",
            "sort_order": 0,
            "is_required": False,
            "fields": fields,
        }

    def _f(fid: str, label: str) -> dict:
        return {
            "id": fid,
            "name": label.lower(),
            "label": label,
            "description": None,
            "field_type": "text",
            "is_required": False,
            "allowed_values": None,
            "unit": None,
            "sort_order": 0,
            "llm_description": None,
            "allow_other": False,
        }

    older = ExtractionTemplateVersion(
        project_template_id=UUID(str(template_id)),
        version=9001,
        schema_={"entity_types": [_et([_f(kept_fid, "Kept"), _f(removed_fid, "Dropped")])]},
        is_active=False,
    )
    db_session.add(older)
    await db_session.flush()

    article = ArticleDescriptor(
        article_id=UUID(str(article_id)),
        header_label="Gaca, 2011",
        run_id=uuid4(),
        run_stage=None,
        version_id=older.id,
        model_instances=(),
        section_instances={},
    )
    svc = ExtractionExportService(
        db=db_session, user_id=str(uuid4()), storage=None  # type: ignore[arg-type]
    )
    out = await svc._compute_obsolete_fields_per_article(
        articles=(article,),
        anchor_field_ids={UUID(kept_fid)},  # anchor has only the kept field
    )
    assert out == {UUID(str(article_id)): ["Dropped"]}
```

- [ ] **Step 2: Run — expect PASS.** From `backend/`:
  `uv run pytest tests/integration/test_extraction_export_snapshot_diff.py -q`
  Expected: both tests pass. If `ExtractionTemplateVersion` requires extra non-null columns at insert (e.g. a `created_by`), the flush will error loudly — add the minimal required columns to the constructor (read the model at `backend/app/models/extraction_versioning.py` @43–70) rather than weakening the assertion.

- [ ] **Step 3: Lint + format.** From `backend/`:
  `uv run ruff check tests/integration/test_extraction_export_snapshot_diff.py && uv run ruff format tests/integration/test_extraction_export_snapshot_diff.py`

- [ ] **Step 4: Commit.**
  `git add backend/tests/integration/test_extraction_export_snapshot_diff.py && git commit -m "$(printf 'test(export): prove obsolete-field diff against a real older snapshot\n\nA Run pinned to an older version surfaces its removed field in\nobsolete_fields_per_article (spec §5.1), verified against local\nSupabase.\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"`

---

### Task 24: Remove stale US2/US3 docstrings + dead else branch (no-legacy cleanup)

**Files:**
- Modify: `backend/app/services/extraction_export_service.py` (module docstring @8–18, `resolve_layout` docstring @266–270, the dead `else: raise NotImplementedError` @313–314, the `# noqa: ARG002 — used in US2` @264)
- Test: existing `tests/unit/test_extraction_export_service.py` + the new unit tests (regression only — no new test; this is a comment/dead-branch removal proven by the suite staying green).

> Spec §10.5 mandates stripping the stale `NotImplementedError until US2/US3` docstrings + the dead `else` branch — all three modes are fully implemented.

- [ ] **Step 1: Confirm the `else` branch is unreachable.** `mode` is an `ExportMode` (StrEnum) and the `if/elif` chain covers `CONSENSUS`/`SINGLE_USER`/`ALL_USERS` — every member. Removing the `else: raise NotImplementedError(...)` (@313–314) drops dead code (mypy/ruff treat the exhaustive enum chain as complete). The `reviewer_id` parameter IS used (passed into single-user resolution @293), so its `# noqa: ARG002 — used in US2` is stale and removed.

- [ ] **Step 2: Edit the module docstring** (@8–18) — remove the "Single-user and All-users branches are not in V1 / raises NotImplementedError until US2/US3 ship" bullet, since all three ship. Replace the third bullet with:

```python
* All three value-source modes (Consensus / Single-user / All-users)
  are implemented; ``resolve_layout`` dispatches on ``mode``.
```

- [ ] **Step 3: Edit the `resolve_layout` docstring** (@266–270) — replace the "US1 covers the Consensus branch. The Single-user and All-users branches raise NotImplementedError until US2/US3 implement them." text with:

```python
        """Build the in-memory layout for an export request.

        Dispatches on ``mode``; every mode is implemented. Columns are
        anchored on the active-version snapshot (spec §5.1).
        """
```

- [ ] **Step 4: Remove the dead `else` branch** (@313–314): delete the two lines

```python
        else:
            raise NotImplementedError(f"resolve_layout: unknown mode={mode.value}.")
```

- [ ] **Step 5: Remove the stale noqa** on the `reviewer_id` param (@264): change `reviewer_id: UUID | None = None,  # noqa: ARG002 — used in US2` to `reviewer_id: UUID | None = None,`.

- [ ] **Step 6: Run the full export unit + integration suite to prove no behavioural change.** From `backend/`:
  `uv run pytest tests/unit/test_extraction_export_service.py tests/unit/test_extraction_export_load_sections.py tests/unit/test_extraction_export_obsolete_fields.py tests/integration/test_extraction_export_snapshot_diff.py -q`
  Expected: all pass.

- [ ] **Step 7: Lint + format** (ruff will flag if the removed `else` left an unreachable/format issue). From `backend/`:
  `uv run ruff check app/services/extraction_export_service.py && uv run ruff format app/services/extraction_export_service.py`
  Expected: no errors.

- [ ] **Step 8: Commit.**
  `git add backend/app/services/extraction_export_service.py && git commit -m "$(printf 'refactor(export): drop stale US2/US3 docstrings + dead else branch\n\nAll three export modes ship; remove the NotImplementedError-until-US2/\nUS3 prose, the unreachable else, and the stale reviewer_id noqa\n(spec §10.5, no-legacy).\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"`

---

### Task 25: Slice gate — full export suite + layered-architecture fitness

**Files:**
- No new code; runs the deterministic gates over everything this slice touched.

- [ ] **Step 1: Run every export-related backend test (unit + integration) green together.** From `backend/`:
  `uv run pytest tests/unit/test_extraction_export_snapshot_sections.py tests/unit/test_extraction_export_descriptors.py tests/unit/test_extraction_export_article_descriptor.py tests/unit/test_extraction_export_load_sections.py tests/unit/test_extraction_export_obsolete_fields.py tests/unit/test_extraction_xlsx_builder.py tests/unit/test_extraction_export_determinism.py tests/unit/test_extraction_export_service.py tests/integration/test_extraction_export_snapshot_diff.py tests/integration/test_extraction_export_endpoint.py -q`
  Expected: all pass.

- [ ] **Step 2: Run the layered-architecture fitness check** to confirm `extraction_snapshot_reader.py` (a `services` module) only imports `models`/`schemas`/`sqlalchemy` and crosses no `api`/storage/network boundary. From repo root:
  `python backend/scripts/fitness/check_layered_arch.py` (or `cd backend && uv run python scripts/fitness/check_layered_arch.py` if it expects the backend cwd — confirm the invocation against `scripts/verify_all.sh`).
  Expected: no violations.

- [ ] **Step 3: Final ruff gate over all touched files.** From `backend/`:
  `uv run ruff check app/services/extraction_export_service.py app/services/exports/extraction_snapshot_reader.py tests/unit/test_extraction_export_*.py tests/integration/test_extraction_export_snapshot_diff.py`
  Expected: no errors.

- [ ] **Step 4: If all three gates are green, the slice is shippable.** No commit (gate-only). Note for the synthesizer: this slice intentionally does **not** delete `_unwrap_value` or remove the `_xlsx_safe` `str(dict)` fallback (owned by the value-envelope/builder sibling slices) and does **not** migrate the builder off the `study_instances` alias (owned by the matrix/tidy slice). The `ArticleDescriptor.study_instances` read-compat property is the seam those slices remove.

---

**Slice summary for the synthesizer.** This slice delivers spec §5.1: a snapshot section reader (`backend/app/services/exports/extraction_snapshot_reader.py`) that anchors export columns on the active-version snapshot via `RunViewEntityType`/`RunViewField` (mirroring `extraction_run_read_service._entity_types_for_run`, including the pre-0026 narrow-snapshot live fallback); grown `FieldDescriptor` (+`description`/`unit`/`is_required`/`allow_other`), `SectionDescriptor` (+`cardinality`/`sort_order`/`description`), and `ArticleDescriptor` (+`version_id`, `section_instances` ordered tuples with a `study_instances` read-compat alias that also fixes the §6 many-cardinality `setdefault` collapse); `_load_sections(version_id)` rewired to the snapshot; and `ExportNotes.obsolete_fields_per_article` populated by a per-Run snapshot diff (`_compute_obsolete_fields_per_article`) rendered by the existing Notes sheet. Stale US2/US3 docstrings + the dead `else` branch are removed. Out of scope (sibling slices, referenced by locked contract name): `resolve_value`/`value_envelope.py`, deleting `_unwrap_value`, removing `_xlsx_safe`'s `str(dict)` fallback, the builder split, and migrating the matrix off `study_instances`.


---

## Phase S4 — Many-cardinality fan-out (any role) + header surname fix

### Task 26: Decide the fan-out grain contract (cardinality, not role) and the `section_instances` shape

**Files:**
- Read: `backend/app/services/exports/extraction_xlsx_builder.py` (`_write_main_sheet` @90, `_resolve_instance_id` @228, `_FIRST_DATA_COL` @59)
- Read: `backend/app/services/extraction_export_service.py` (`SectionDescriptor` @83, `ArticleDescriptor` @99, `_resolve_articles_for_consensus` @477 incl. the `study_instances.setdefault` @542, `_build_*_value_map` 4-tuple keys, AI `instance_index_by_id` @1268)
- Read: `backend/app/models/extraction.py` (`ExtractionCardinality` @57, `ExtractionEntityRole` @64, `ExtractionInstance.sort_order` @444)

This is a **read + decision task only — no code, no commit.** Record the answers inline in the plan PR description; later code tasks depend on them.

- [ ] **Step 1: Confirm the current fan-out axis is per-`model_instances` only.** In `_write_main_sheet` (@124–140 and @189–217) the per-article column span is `max(1, len(article.model_instances)) * len(reviewer_axis)`; `_resolve_instance_id` (@242–250) only fans `MODEL_SECTION` via `model_index`, and `STUDY_SECTION` always returns the *single* `study_instances.get(...)`. Record: **the matrix has exactly one fan-out axis (model instances) and one collapsed study-instance slot.** This slice adds a second, generalized axis.

- [ ] **Step 2: Lock the new shape decisions** (these are the contract the code tasks implement, matching the locked preamble):
  - `ArticleDescriptor.study_instances: dict[UUID, UUID]` → **renamed** `section_instances: dict[UUID, tuple[UUID, ...]]` (ordered instance ids per entity_type; `cardinality='one'` carries a 1-tuple). The collapse at `:542/:770/:989` (`setdefault`) is replaced by an **append into the per-entity_type list** (instances already arrive ordered by `(entity_type_id, sort_order)` from `_load_instances_for_runs` @588).
  - `SectionDescriptor` gains `cardinality: ExtractionCardinality = ExtractionCardinality.ONE`. **The fan-out key is `section.cardinality is ExtractionCardinality.MANY` for ANY role** — the `role==MODEL_SECTION` allow-list in `_resolve_instance_id` is deleted.
  - Per-article column span becomes the **product of every cardinality-many section's instance count** is *out of scope* — confirm the simpler decision: the matrix keeps **one fan-out axis per article = the max instance count across the article's many-cardinality sections** (model_instances is just one such section). Record explicitly: *we do NOT take a cartesian product of independent many-sections in the matrix; each many-section fans to its own instance list indexed by the shared column slot, repeating its last value when its own list is shorter (degenerate templates only).* This keeps §5.4 "merged record header spans an article's instance sub-columns" intact.
  - `MODEL_CONTAINER` rows (no own fields) are still skipped (@169).

- [ ] **Step 3: Confirm no DB/model/migration change is needed.** `ExtractionEntityType.cardinality` already exists (`extraction.py` @270); `_load_entity_type_role_map` (@606) returns only `role`. Decision: add a sibling `_load_entity_type_cardinality_map` (read-only `select(id, cardinality)`) — **no Alembic migration** (export is a read-only consumer). Record this so no code task reaches for `alembic revision`.

---

### Task 27: Add `cardinality` to `SectionDescriptor` (failing test first)

**Files:**
- Modify: `backend/app/services/extraction_export_service.py` (`SectionDescriptor` @83-96)
- Test: `backend/tests/unit/test_extraction_export_descriptors.py` (new)

- [ ] **Step 1: Write the failing test.** Create the new file with:
```python
"""Unit tests for ExportLayout descriptor shape changes (cardinality fan-out)."""

from __future__ import annotations

from uuid import uuid4

from app.models.extraction import ExtractionCardinality, ExtractionEntityRole
from app.services.extraction_export_service import SectionDescriptor


def test_section_descriptor_defaults_to_cardinality_one():
    section = SectionDescriptor(
        entity_type_id=uuid4(),
        label="1. Source",
        role=ExtractionEntityRole.STUDY_SECTION,
        parent_entity_type_id=None,
        fields=(),
    )
    assert section.cardinality is ExtractionCardinality.ONE


def test_section_descriptor_accepts_cardinality_many():
    section = SectionDescriptor(
        entity_type_id=uuid4(),
        label="Index tests",
        role=ExtractionEntityRole.STUDY_SECTION,
        parent_entity_type_id=None,
        fields=(),
        cardinality=ExtractionCardinality.MANY,
    )
    assert section.cardinality is ExtractionCardinality.MANY
```

- [ ] **Step 2: Run it and confirm FAIL.** From `backend/`:
```
uv run pytest tests/unit/test_extraction_export_descriptors.py -q
```
Expected FAIL: `TypeError: SectionDescriptor.__init__() got an unexpected keyword argument 'cardinality'`.

- [ ] **Step 3: Add the field.** In `extraction_export_service.py`, ensure `ExtractionCardinality` is imported (it already is, @38) and add to `SectionDescriptor` (after the `fields` line @96):
```python
    fields: tuple[FieldDescriptor, ...]
    # cardinality from the entity_type — drives the matrix/tidy fan-out
    # grain. ``many`` fans one sub-column block per instance for ANY role
    # (not a role==MODEL_SECTION allow-list). See export design §5.2.
    cardinality: ExtractionCardinality = ExtractionCardinality.ONE
```

- [ ] **Step 4: Run it and confirm PASS.** From `backend/`:
```
uv run pytest tests/unit/test_extraction_export_descriptors.py -q
```
Expected PASS (2 passed).

- [ ] **Step 5: Lint + commit.** From `backend/`:
```
uv run ruff check app/services/extraction_export_service.py tests/unit/test_extraction_export_descriptors.py
uv run ruff format app/services/extraction_export_service.py tests/unit/test_extraction_export_descriptors.py
```
Commit:
```
feat(export): add cardinality to SectionDescriptor for generalized fan-out

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
```

---

### Task 28: Rename `study_instances` → ordered `section_instances` on `ArticleDescriptor` (failing test first)

**Files:**
- Modify: `backend/app/services/extraction_export_service.py` (`ArticleDescriptor` @99-112)
- Test: `backend/tests/unit/test_extraction_export_descriptors.py` (extend)

- [ ] **Step 1: Write the failing test.** Append to `test_extraction_export_descriptors.py`:
```python
def test_article_descriptor_carries_ordered_section_instances():
    from app.services.extraction_export_service import ArticleDescriptor

    et_id = uuid4()
    inst_a, inst_b = uuid4(), uuid4()
    article = ArticleDescriptor(
        article_id=uuid4(),
        header_label="Gaca, 2011",
        run_id=uuid4(),
        run_stage=None,
        model_instances=(),
        section_instances={et_id: (inst_a, inst_b)},
    )
    # Ordered tuple, NOT a single collapsed id.
    assert article.section_instances[et_id] == (inst_a, inst_b)
```

- [ ] **Step 2: Run it and confirm FAIL.** From `backend/`:
```
uv run pytest tests/unit/test_extraction_export_descriptors.py::test_article_descriptor_carries_ordered_section_instances -q
```
Expected FAIL: `TypeError: ArticleDescriptor.__init__() got an unexpected keyword argument 'section_instances'`.

- [ ] **Step 3: Rename the field.** In `ArticleDescriptor` replace the `study_instances` line (@110-112):
```python
    # Ordered model_section instance ids; empty when the template has no
    # model_container OR when the article has zero model instances.
    model_instances: tuple[UUID, ...]
    # entity_type_id (study/section) → ORDERED instance ids for that
    # entity_type. Single-cardinality sections carry a 1-tuple;
    # cardinality='many' sections carry one id per instance (no collapse).
    section_instances: dict[UUID, tuple[UUID, ...]]
```

- [ ] **Step 4: Run it and confirm FAIL elsewhere (proves the rename has callers).** From `backend/`:
```
uv run pytest tests/unit/test_extraction_export_descriptors.py -q
```
The new test PASSES, but do NOT commit yet — the three producers (`:542/:770/:989`), `_resolve_instance_id`, and the AI `instance_index_by_id` (@1272) still reference the old name and will be fixed in the next tasks. Confirm the import-time collapse is intentional by grepping:
```
grep -rn "study_instances" app tests
```
Expected: the three service producers + AI block + the legacy builder/tests still match — these are fixed in the following tasks (do not let this task green the whole suite).

> **No commit in this task** — it is the type rename whose call sites are repaired atomically in the next two service tasks (avoids a red intermediate commit).

---

### Task 29: Build ordered `section_instances` in all three article resolvers (failing test first)

**Files:**
- Modify: `backend/app/services/extraction_export_service.py` (`_resolve_articles_for_consensus` @528-555, `_resolve_articles_for_single_user` @759-781, `_resolve_articles_for_all_users` @978-1000, AI `instance_index_by_id` @1268-1273)
- Test: `backend/tests/integration/test_extraction_export_many_cardinality_fanout.py` (new)

- [ ] **Step 1: Write the failing integration test.** Mirror the run/instance/proposal setup pattern from `tests/integration/test_extraction_manual_only_flow.py`; scope every query by `project_id` (autouse `SEED` fixture, `db_session` transaction-rollback fixture). Create a study-role entity_type with `cardinality='many'`, materialize **two** instances for one finalized article, then assert the descriptor keeps both:
```python
"""Integration: many-cardinality sections fan out (no instance collapse)."""

from __future__ import annotations

import pytest

from app.models.extraction import ExtractionCardinality, ExtractionEntityRole

pytestmark = pytest.mark.asyncio


async def test_many_cardinality_section_keeps_all_instances(
    db_session,
    seeded_export_fixture,  # helper that builds project+template+finalized run; see Step 1a
):
    """A cardinality='many' study-role section must surface ALL its
    instances in ArticleDescriptor.section_instances (was collapsed to 1)."""
    ctx = await seeded_export_fixture(
        db_session,
        section_role=ExtractionEntityRole.STUDY_SECTION,
        section_cardinality=ExtractionCardinality.MANY,
        instance_count=3,
    )
    service = ctx.service
    descriptors, _omitted = await service._resolve_articles_for_consensus(
        template_id=ctx.template_id,
        project_id=ctx.project_id,
        candidate_ids=[ctx.article_id],
    )
    assert len(descriptors) == 1
    section_instances = descriptors[0].section_instances[ctx.many_entity_type_id]
    # All 3 instances preserved, in sort_order — NOT collapsed to 1.
    assert section_instances == ctx.ordered_instance_ids
    assert len(section_instances) == 3
```

- [ ] **Step 1a: Add the `seeded_export_fixture` helper.** In the same test file, write a small async factory that (a) creates a `ProjectExtractionTemplate` under the seeded project, (b) an `ExtractionEntityType` with the given role+cardinality, (c) `instance_count` `ExtractionInstance` rows with ascending `sort_order` for one article, (d) a FINALIZED `ExtractionRun`, and returns a context object exposing `service` (an `ExtractionExportService` built with `db_session`, the test user id, and a stub `StorageAdapter`), `template_id`, `project_id`, `article_id`, `many_entity_type_id`, and `ordered_instance_ids` (the instance ids in `sort_order`). Scope every helper query by `project_id`. Use the existing seed graph's project/user from the autouse `SEED` fixture.

- [ ] **Step 2: Run it and confirm FAIL.** From `backend/` (needs local Supabase on :54322):
```
uv run pytest tests/integration/test_extraction_export_many_cardinality_fanout.py -q
```
Expected FAIL: `AttributeError: 'ArticleDescriptor' object has no attribute 'section_instances'` is already resolved by the prior task, so this fails on the **assertion** — `section_instances` is still built as a `dict[UUID, UUID]` via the un-updated producers (the descriptor construction at `:553` references `study_instances=` which no longer exists → `TypeError` at the first resolver call). Either way, RED.

- [ ] **Step 3: Update the consensus resolver.** Replace the collapse loop (@533-554) in `_resolve_articles_for_consensus`:
```python
        descriptors: list[ArticleDescriptor] = []
        for aid in kept_articles:
            run = runs_by_article[aid]
            insts = instances_by_run.get(run.id, [])
            model_instances: list[UUID] = []
            section_instances: dict[UUID, list[UUID]] = {}
            for inst in insts:
                role = entity_by_id.get(inst.entity_type_id)
                if role is ExtractionEntityRole.MODEL_SECTION:
                    model_instances.append(inst.id)
                elif role is ExtractionEntityRole.STUDY_SECTION:
                    # Keep EVERY instance, in load order (sort_order). The
                    # old setdefault collapsed cardinality='many' sections
                    # to a single instance, silently dropping N-1.
                    section_instances.setdefault(inst.entity_type_id, []).append(inst.id)
                # model_container instances carry no values themselves.

            descriptors.append(
                ArticleDescriptor(
                    article_id=aid,
                    header_label=headers.get(aid) or _short_id(aid),
                    run_id=run.id,
                    run_stage=ExtractionRunStage(run.stage),
                    model_instances=tuple(model_instances),
                    section_instances={
                        etid: tuple(ids) for etid, ids in section_instances.items()
                    },
                )
            )

        return descriptors, omitted
```

- [ ] **Step 4: Update the single-user resolver.** Apply the identical transformation to the loop at @760-781 (replace `study_instances: dict[UUID, UUID] = {}` + `setdefault(inst.entity_type_id, inst.id)` + `study_instances=study_instances` with the ordered-list build and `section_instances=` exactly as in Step 3).

- [ ] **Step 5: Update the all-users resolver.** Apply the identical transformation to the loop at @979-1000.

- [ ] **Step 6: Update the AI `instance_index_by_id` block.** At @1268-1273, the study-instance branch must index every instance in the list (not assume one). Replace:
```python
        instance_index_by_id: dict[UUID, int] = {}
        for article in articles:
            for idx, iid in enumerate(article.model_instances, start=1):
                instance_index_by_id[iid] = idx
            for instance_ids in article.section_instances.values():
                for idx, iid in enumerate(instance_ids, start=1):
                    instance_index_by_id[iid] = idx
```

- [ ] **Step 7: Run it and confirm PASS.** From `backend/`:
```
uv run pytest tests/integration/test_extraction_export_many_cardinality_fanout.py -q
```
Expected PASS (1 passed).

- [ ] **Step 8: Lint + commit (atomic with the rename).** From `backend/`:
```
uv run ruff check app/services/extraction_export_service.py tests/integration/test_extraction_export_many_cardinality_fanout.py tests/unit/test_extraction_export_descriptors.py
uv run ruff format app/services/extraction_export_service.py tests/integration/test_extraction_export_many_cardinality_fanout.py tests/unit/test_extraction_export_descriptors.py
```
Commit:
```
fix(export): keep all instances of many-cardinality sections

Replace the lossy study_instances.setdefault collapse with a per-
entity_type ordered instance list (section_instances). Fixes silent
loss of N-1 instances for cardinality='many' study sections.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
```

---

### Task 30: Load the entity_type → cardinality map and populate `SectionDescriptor.cardinality` (failing test first)

**Files:**
- Modify: `backend/app/services/extraction_export_service.py` (`_load_sections` @414-475; new `_load_entity_type_cardinality_map` beside `_load_entity_type_role_map` @606)
- Test: `backend/tests/integration/test_extraction_export_many_cardinality_fanout.py` (extend)

> **Note:** the sibling phase-1 slice swaps `_load_sections` to the snapshot reader (`load_export_sections`, which carries `cardinality` natively). This task wires cardinality through the **current live-table** `_load_sections` so this slice is independently green; when the snapshot reader lands, its `SnapshotSection.cardinality` feeds the same `SectionDescriptor.cardinality` field with no further change here.

- [ ] **Step 1: Write the failing test.** Append to `test_extraction_export_many_cardinality_fanout.py`:
```python
async def test_load_sections_surfaces_entity_cardinality(
    db_session,
    seeded_export_fixture,
):
    ctx = await seeded_export_fixture(
        db_session,
        section_role=ExtractionEntityRole.STUDY_SECTION,
        section_cardinality=ExtractionCardinality.MANY,
        instance_count=2,
    )
    sections = await ctx.service._load_sections(ctx.template_id)
    many = next(s for s in sections if s.entity_type_id == ctx.many_entity_type_id)
    assert many.cardinality is ExtractionCardinality.MANY
```

- [ ] **Step 2: Run it and confirm FAIL.** From `backend/`:
```
uv run pytest tests/integration/test_extraction_export_many_cardinality_fanout.py::test_load_sections_surfaces_entity_cardinality -q
```
Expected FAIL: `assert <ExtractionCardinality.ONE: 'one'> is <ExtractionCardinality.MANY: 'many'>` (the default leaks through because `_load_sections` never reads `cardinality`).

- [ ] **Step 3: Read cardinality in `_load_sections`.** In the entity-types query (@426-436), the ORM rows already carry `cardinality`. Add it to the `SectionDescriptor` construction (@466-474):
```python
        return tuple(
            SectionDescriptor(
                entity_type_id=e.id,
                label=e.label,
                role=ExtractionEntityRole(e.role),
                parent_entity_type_id=e.parent_entity_type_id,
                fields=tuple(fields_by_section.get(e.id, ())),
                cardinality=ExtractionCardinality(e.cardinality),
            )
            for e in entity_rows
        )
```

- [ ] **Step 4: Run it and confirm PASS.** From `backend/`:
```
uv run pytest tests/integration/test_extraction_export_many_cardinality_fanout.py -q
```
Expected PASS (3 passed — the two prior + this one).

- [ ] **Step 5: Lint + commit.** From `backend/`:
```
uv run ruff check app/services/extraction_export_service.py
uv run ruff format app/services/extraction_export_service.py
```
Commit:
```
feat(export): surface entity cardinality on SectionDescriptor

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
```

---

### Task 31: Generalize the builder's `_resolve_instance_id` to fan out on cardinality (any role) (failing test first)

**Files:**
- Modify: `backend/app/services/exports/extraction_xlsx_builder.py` (`_resolve_instance_id` @228-250; `_write_main_sheet` span computation @126 + slot loop @189-217; update imports @36-44; column guard)
- Test: `backend/tests/unit/test_extraction_matrix_builder.py` (new; per the locked file structure this is the split target — keep `test_extraction_xlsx_builder.py` building too)

> The builder reads `ArticleDescriptor.section_instances` (renamed) and `SectionDescriptor.cardinality` (new). The existing `test_extraction_xlsx_builder.py` helpers still pass `study_instances=` — they are migrated in the next task. This task drives the new behaviour from a fresh test module so the change is TDD-first.

- [ ] **Step 1: Write the failing matrix-builder test.** Create the new file with local helpers that use the **new** field names and a `cardinality='many'` STUDY_SECTION fanning to two instances:
```python
"""Unit tests for the extraction matrix builder fan-out (cardinality, any role)."""

from __future__ import annotations

import io
from datetime import UTC, datetime
from uuid import UUID, uuid4

from openpyxl import load_workbook

from app.models.extraction import (
    ExtractionCardinality,
    ExtractionEntityRole,
    ExtractionFieldType,
)
from app.services.exports.extraction_xlsx_builder import build_workbook
from app.services.extraction_export_service import (
    ArticleDescriptor,
    ExportLayout,
    ExportMode,
    ExportNotes,
    FieldDescriptor,
    SectionDescriptor,
)


def _layout(sections, articles, value_map):
    return ExportLayout(
        project_name="P",
        template_name="CHARMS",
        template_version=1,
        sections=sections,
        articles=articles,
        reviewers=(),
        mode=ExportMode.CONSENSUS,
        include_ai_metadata=False,
        anonymize_reviewer_names=False,
        notes=ExportNotes(generated_at=datetime(2026, 6, 14, tzinfo=UTC)),
        value_map=value_map,
    )


def test_many_cardinality_study_section_fans_out_one_subcolumn_per_instance():
    eid = uuid4()
    fid = uuid4()
    field = FieldDescriptor(
        field_id=fid,
        label="Index test name",
        type=ExtractionFieldType.TEXT,
        allowed_values=(),
        parent_section_id=eid,
    )
    section = SectionDescriptor(
        entity_type_id=eid,
        label="Index tests",
        role=ExtractionEntityRole.STUDY_SECTION,  # NOT a model section
        parent_entity_type_id=None,
        fields=(field,),
        cardinality=ExtractionCardinality.MANY,
    )
    inst_a, inst_b = uuid4(), uuid4()
    run_id = uuid4()
    article = ArticleDescriptor(
        article_id=uuid4(),
        header_label="Gaca, 2011",
        run_id=run_id,
        run_stage=None,
        model_instances=(),
        section_instances={eid: (inst_a, inst_b)},
    )
    data = build_workbook(
        _layout(
            (section,),
            (article,),
            {
                (run_id, inst_a, fid): "CT angiography",
                (run_id, inst_b, fid): "MRI",
            },
        )
    )
    ws = load_workbook(io.BytesIO(data))["CHARMS"]

    # Article header spans TWO instance sub-columns (merged C1:D1).
    assert ws.cell(row=1, column=3).value == "Gaca, 2011"
    assert ws.cell(row=1, column=4).value is None  # trailing merged cell

    field_row = None
    for r in range(2, ws.max_row + 1):
        if ws.cell(row=r, column=2).value == "Index test name":
            field_row = r
            break
    assert field_row is not None
    # One distinct value per instance — NO collapse.
    assert ws.cell(row=field_row, column=3).value == "CT angiography"
    assert ws.cell(row=field_row, column=4).value == "MRI"
```

- [ ] **Step 2: Run it and confirm FAIL.** From `backend/`:
```
uv run pytest tests/unit/test_extraction_matrix_builder.py -q
```
Expected FAIL: the article span is `max(1, len(article.model_instances))` = 1 (model_instances is empty), so only column C is emitted and D is blank → `assert ws.cell(row=field_row, column=4).value == "MRI"` fails (gets `None`); `_resolve_instance_id` also still calls `article.study_instances` → `AttributeError`. RED either way.

- [ ] **Step 3: Add a fan-out helper and generalize `_resolve_instance_id`.** Update imports in the builder (@36-44) to add `ExtractionCardinality`, then replace `_resolve_instance_id` (@228-250) with a cardinality-driven resolver plus a per-article instance-count helper:
```python
def _article_fanout_count(*, article: ArticleDescriptor, layout: ExportLayout) -> int:
    """Number of instance sub-columns for one article.

    The fan-out grain is the MAX instance count across the article's
    cardinality='many' sections (any role), with a floor of 1. Model
    sections are just one such many-section. We do NOT cartesian-product
    independent many-sections (design §5.4 — one instance axis per
    article); a section with fewer instances repeats its last value.
    """
    counts = [1]
    for section in layout.sections:
        if section.cardinality is not ExtractionCardinality.MANY:
            continue
        if section.role is ExtractionEntityRole.MODEL_SECTION:
            counts.append(max(1, len(article.model_instances)))
        else:
            counts.append(max(1, len(article.section_instances.get(section.entity_type_id, ()))))
    return max(counts)


def _resolve_instance_id(
    *,
    section: SectionDescriptor,
    article: ArticleDescriptor,
    model_index: int,
) -> UUID | None:
    """Return the instance_id whose values feed the given cell.

    Fan-out is keyed on cardinality, not role:
      * cardinality='one'  → the single instance for the section's
        entity_type, repeated across every sub-column (§5.4
        repeat-not-merge).
      * cardinality='many' MODEL_SECTION → the model_index-th model
        instance.
      * cardinality='many' (any other role) → the model_index-th instance
        of that entity_type, clamped to the last when its own list is
        shorter than the article's fan-out width.
    """
    if section.role is ExtractionEntityRole.MODEL_CONTAINER:
        return None  # no own fields — caller already skipped
    if section.cardinality is ExtractionCardinality.MANY:
        if section.role is ExtractionEntityRole.MODEL_SECTION:
            if not article.model_instances:
                return None
            idx = min(model_index, len(article.model_instances) - 1)
            return article.model_instances[idx]
        ids = article.section_instances.get(section.entity_type_id, ())
        if not ids:
            return None
        idx = min(model_index, len(ids) - 1)
        return ids[idx]
    # cardinality='one' — single instance, repeated across sub-columns.
    ids = article.section_instances.get(section.entity_type_id, ())
    return ids[0] if ids else None
```

- [ ] **Step 4: Use the helper for the per-article span in `_write_main_sheet`.** Replace the span computation (@125-126) inside the header loop:
```python
    for article in layout.articles:
        models_per_article = _article_fanout_count(article=article, layout=layout)
        span = models_per_article * len(reviewer_axis)
```
and in the row 2 reviewer-label loop (@148-149) and the field-row slot loop (@191-192) replace each `models_per_article = max(1, len(article.model_instances))` with:
```python
                models_per_article = _article_fanout_count(article=article, layout=layout)
```

- [ ] **Step 5: Run it and confirm PASS.** From `backend/`:
```
uv run pytest tests/unit/test_extraction_matrix_builder.py -q
```
Expected PASS (1 passed).

- [ ] **Step 6: Lint + commit.** From `backend/`:
```
uv run ruff check app/services/exports/extraction_xlsx_builder.py tests/unit/test_extraction_matrix_builder.py
uv run ruff format app/services/exports/extraction_xlsx_builder.py tests/unit/test_extraction_matrix_builder.py
```
Commit:
```
feat(export): fan out matrix sub-columns by cardinality for any role

_resolve_instance_id now keys on cardinality=='many' (not
role==MODEL_SECTION); per-article span is the max instance count across
the article's many-cardinality sections. QUADAS-2 / multi-cohort /
multi-outcome templates now emit one sub-column per instance.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
```

---

### Task 32: Migrate the legacy builder test module to the renamed/generalized contract (keep it green)

**Files:**
- Modify: `backend/tests/unit/test_extraction_xlsx_builder.py` (`_article` helper @69-83, all `study_instances=`/`study_instances={...}` call sites; the model-fan-out test @182-240 must keep passing because model sections are now driven by cardinality)
- Test: same file

> The matrix behaviour is unchanged for model sections **only if** their `SectionDescriptor.cardinality` is `MANY`. The existing `_section` helper (@42-66) builds sections with the default `cardinality=ONE`; a `MODEL_SECTION` with `cardinality=ONE` would now fail to fan out. This task makes the legacy module honest about cardinality and the rename.

- [ ] **Step 1: Run the legacy module to capture the breakage (prove-it-fails).** From `backend/`:
```
uv run pytest tests/unit/test_extraction_xlsx_builder.py -q
```
Expected FAIL: `_article(...)` passes `study_instances=` → `TypeError: ArticleDescriptor.__init__() got an unexpected keyword argument 'study_instances'`; and `test_multi_instance_article_repeats_study_section_values` would no longer fan out the model section (cardinality defaults to ONE). RED confirmed.

- [ ] **Step 2: Update the `_article` helper** (@69-83) to the renamed field with a 1-tuple wrapper so existing single-instance call sites keep working unchanged:
```python
def _article(
    header: str,
    *,
    study_instances: dict[UUID, UUID],
    model_instances: tuple[UUID, ...] = (),
    run_id: UUID | None = None,
) -> ArticleDescriptor:
    return ArticleDescriptor(
        article_id=uuid4(),
        header_label=header,
        run_id=run_id if run_id is not None else uuid4(),
        run_stage=None,  # not consulted by builder
        model_instances=model_instances,
        # Wrap each single study-instance id into the new ordered 1-tuple.
        section_instances={etid: (iid,) for etid, iid in study_instances.items()},
    )
```

- [ ] **Step 3: Mark model sections as cardinality='many' in the `_section` helper for MODEL_SECTION roles.** Update `_section` (@42-66) so a model section fans out as before:
```python
def _section(
    label: str,
    role: ExtractionEntityRole,
    fields: list[FieldDescriptor] | None = None,
    parent: UUID | None = None,
) -> SectionDescriptor:
    eid = uuid4()
    f = tuple(
        FieldDescriptor(
            field_id=f.field_id,
            label=f.label,
            type=f.type,
            allowed_values=f.allowed_values,
            parent_section_id=eid,
        )
        for f in (fields or [])
    )
    from app.models.extraction import ExtractionCardinality

    cardinality = (
        ExtractionCardinality.MANY
        if role is ExtractionEntityRole.MODEL_SECTION
        else ExtractionCardinality.ONE
    )
    return SectionDescriptor(
        entity_type_id=eid,
        label=label,
        role=role,
        parent_entity_type_id=parent,
        fields=f,
        cardinality=cardinality,
    )
```

- [ ] **Step 4: Run it and confirm PASS.** From `backend/`:
```
uv run pytest tests/unit/test_extraction_xlsx_builder.py -q
```
Expected PASS (all existing builder tests green, incl. `test_multi_instance_article_repeats_study_section_values` and `test_all_users_mode_fans_out_reviewer_subcolumns`).

- [ ] **Step 5: Run the full export unit + determinism suite (no regression).** From `backend/`:
```
uv run pytest tests/unit/test_extraction_xlsx_builder.py tests/unit/test_extraction_matrix_builder.py tests/unit/test_extraction_export_determinism.py -q
```
Expected PASS.

- [ ] **Step 6: Lint + commit.** From `backend/`:
```
uv run ruff check tests/unit/test_extraction_xlsx_builder.py
uv run ruff format tests/unit/test_extraction_xlsx_builder.py
```
Commit:
```
test(export): migrate builder tests to section_instances + cardinality

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
```

---

### Task 33: Add the column guard (16,384-column limit) to `build_workbook` (failing test first)

**Files:**
- Modify: `backend/app/services/exports/extraction_xlsx_builder.py` (`build_workbook` @62-82; new `_assert_column_budget` hook + `_FIRST_DATA_COL` neighbour)
- Test: `backend/tests/unit/test_extraction_matrix_builder.py` (extend)

> §5.5: a pre-build assertion must reject layouts exceeding Excel's hard 16,384-column limit (reachable in all-users mode × many articles × many instances × reviewers) with a clear error instead of an openpyxl mid-build crash. The fan-out generalization is exactly what makes this reachable, so the guard ships in this slice.

- [ ] **Step 1: Write the failing test.** Append to `test_extraction_matrix_builder.py`:
```python
import pytest

from app.core.error_handler import AppError


def test_column_guard_rejects_layouts_over_excel_limit():
    # One study-many section with an absurd instance count to blow the
    # 16,384-column budget deterministically (no real fan-out needed).
    eid = uuid4()
    fid = uuid4()
    field = FieldDescriptor(
        field_id=fid,
        label="F",
        type=ExtractionFieldType.TEXT,
        allowed_values=(),
        parent_section_id=eid,
    )
    section = SectionDescriptor(
        entity_type_id=eid,
        label="S",
        role=ExtractionEntityRole.STUDY_SECTION,
        parent_entity_type_id=None,
        fields=(field,),
        cardinality=ExtractionCardinality.MANY,
    )
    run_id = uuid4()
    instance_ids = tuple(uuid4() for _ in range(16_400))
    article = ArticleDescriptor(
        article_id=uuid4(),
        header_label="Big",
        run_id=run_id,
        run_stage=None,
        model_instances=(),
        section_instances={eid: instance_ids},
    )
    with pytest.raises(AppError) as exc:
        build_workbook(_layout((section,), (article,), {}))
    assert "16384" in str(exc.value) or "column" in str(exc.value).lower()
```

- [ ] **Step 2: Run it and confirm FAIL.** From `backend/`:
```
uv run pytest tests/unit/test_extraction_matrix_builder.py::test_column_guard_rejects_layouts_over_excel_limit -q
```
Expected FAIL: no guard exists → either an openpyxl error of a different type or a slow build, not `AppError`. RED.

- [ ] **Step 3: Implement the guard.** In the builder, import `AppError` (`from app.core.error_handler import AppError`) and add the hook, then call it at the top of `build_workbook` (after the docstring, before creating the `Workbook` @69):
```python
_EXCEL_MAX_COLUMNS = 16_384


def _assert_column_budget(layout: ExportLayout) -> None:
    """Reject layouts that would exceed Excel's hard 16,384-column cap.

    Fail loud and early with a clear message instead of letting openpyxl
    crash mid-build (design §5.5). Worst case is all-users mode with many
    articles × instances × reviewers.
    """
    reviewer_axis_width = (len(layout.reviewers) + 1) if layout.mode is ExportMode.ALL_USERS else 1
    total = _FIRST_DATA_COL - 1  # label columns A + B
    for article in layout.articles:
        total += _article_fanout_count(article=article, layout=layout) * reviewer_axis_width
        if total > _EXCEL_MAX_COLUMNS:
            raise AppError(
                "This export would produce "
                f"{total} columns, exceeding Excel's limit of "
                f"{_EXCEL_MAX_COLUMNS}. Narrow the export mode, reviewers, "
                "or article selection and try again."
            )
```
and in `build_workbook`:
```python
def build_workbook(layout: ExportLayout) -> bytes:
    """Build the export workbook bytes for the given layout."""
    _assert_column_budget(layout)
    wb = Workbook()
```

- [ ] **Step 4: Confirm `AppError`'s constructor signature.** Open `backend/app/core/error_handler.py`, verify `AppError(message: str, ...)` accepts a positional message (the codebase's `error.message` envelope contract). If it requires a code/status, pass the minimal required args; adjust the `raise` accordingly. Re-read before finalizing the `raise` so the message lands on `error.message`.

- [ ] **Step 5: Run it and confirm PASS.** From `backend/`:
```
uv run pytest tests/unit/test_extraction_matrix_builder.py -q
```
Expected PASS (both matrix tests).

- [ ] **Step 6: Lint + commit.** From `backend/`:
```
uv run ruff check app/services/exports/extraction_xlsx_builder.py tests/unit/test_extraction_matrix_builder.py
uv run ruff format app/services/exports/extraction_xlsx_builder.py tests/unit/test_extraction_matrix_builder.py
```
Commit:
```
feat(export): guard against Excel's 16,384-column limit pre-build

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
```

---

### Task 34: Particle-aware compound-surname header label (failing test first)

**Files:**
- Modify: `backend/app/services/extraction_export_service.py` (`_build_header_label` @1471-1489; new `_SURNAME_PARTICLES` const + `_extract_surname` helper)
- Test: `backend/tests/unit/test_extraction_export_header_label.py` (new)

- [ ] **Step 1: Write the failing test.** Create the new file:
```python
"""Unit tests for particle-aware compound-surname header labels."""

from __future__ import annotations

from uuid import uuid4

import pytest

from app.services.extraction_export_service import _build_header_label


@pytest.mark.parametrize(
    "authors, year, expected",
    [
        # Compound surname with a lowercase particle — must NOT drop "De".
        (["Carlo De Feo"], 2012, "De Feo, 2012"),
        (["van der Berg, Anna"], 2019, "van der Berg, 2019"),
        (["von Neumann"], 1945, "von Neumann, 1945"),
        (["da Silva, João"], 2021, "da Silva, 2021"),
        # Plain single surname unchanged.
        (["Gaca, Andrew"], 2011, "Gaca, 2011"),
        (["Andrew Gaca"], 2011, "Gaca, 2011"),
        # "Comma, given" form: surname is before the comma.
        (["Smith, John"], 2000, "Smith, 2000"),
        # No year — bare surname.
        (["De Feo, Carlo"], None, "De Feo"),
    ],
)
def test_compound_surname_preserves_particles(authors, year, expected):
    assert _build_header_label(None, authors, year, uuid4()) == expected


def test_no_authors_falls_back_to_title_then_id():
    aid = uuid4()
    assert _build_header_label("A Long Study Title", None, 2020, aid) == "A Long Study Title"
    assert _build_header_label(None, None, None, aid) == str(aid).split("-")[0]
```

- [ ] **Step 2: Run it and confirm FAIL.** From `backend/`:
```
uv run pytest tests/unit/test_extraction_export_header_label.py -q
```
Expected FAIL: current `_build_header_label` returns `"Feo, 2012"` for `"Carlo De Feo"` (`split(" ")[-1]`) and mishandles `"van der Berg"` → `"Berg"`. Multiple parametrize cases RED.

- [ ] **Step 3: Implement the particle-aware heuristic.** Replace `_build_header_label` (@1471-1489) and add the helper + particle set just above it:
```python
#: Lowercase surname particles (nobiliary / patronymic prefixes). When a
#: surname token sequence ends in "<particle...> <Capitalized>", the
#: particle(s) are part of the surname (e.g. "De Feo", "van der Berg").
_SURNAME_PARTICLES = frozenset(
    {
        "de",
        "del",
        "della",
        "der",
        "den",
        "da",
        "das",
        "dos",
        "di",
        "du",
        "van",
        "von",
        "la",
        "le",
        "lo",
        "ter",
        "ten",
        "af",
        "av",
        "bin",
        "ibn",
        "al",
    }
)


def _extract_surname(first_author: str) -> str:
    """Extract a publication-style surname, preserving compound particles.

    * ``"Smith, John"``      → ``"Smith"`` (text before the comma is the
      surname already).
    * ``"Carlo De Feo"``     → ``"De Feo"`` (trailing particle+name run).
    * ``"van der Berg"``     → ``"van der Berg"``.
    * ``"Gaca"`` / ``"Andrew Gaca"`` → ``"Gaca"``.
    """
    cleaned = first_author.strip()
    if not cleaned:
        return ""
    if "," in cleaned:
        # "Surname[, given]" — the surname is everything before the comma,
        # which already includes any particle (e.g. "van der Berg, Anna").
        return cleaned.split(",", 1)[0].strip()

    tokens = cleaned.split()
    if len(tokens) == 1:
        return tokens[0]

    # Walk back from the last token; absorb leading particle tokens.
    surname_tokens = [tokens[-1]]
    idx = len(tokens) - 2
    while idx >= 0 and tokens[idx].lower() in _SURNAME_PARTICLES:
        surname_tokens.insert(0, tokens[idx])
        idx -= 1
    return " ".join(surname_tokens)


def _build_header_label(
    title: str | None,
    authors: list[str] | None,
    year: int | None,
    article_id: UUID,
) -> str:
    """Compute the article column header per FR-012 fallback chain.

    Surname extraction is particle-aware so compound surnames survive
    (e.g. "Carlo De Feo" → "De Feo, 2012", not "Feo, 2012").
    """
    if authors:
        surname = _extract_surname(authors[0] or "")
        if surname and year is not None:
            return f"{surname}, {year}"
        if surname:
            return surname
    if title:
        return title[:60]
    return _short_id(article_id)
```

- [ ] **Step 4: Run it and confirm PASS.** From `backend/`:
```
uv run pytest tests/unit/test_extraction_export_header_label.py -q
```
Expected PASS (all parametrized cases + fallback).

- [ ] **Step 5: Lint + commit.** From `backend/`:
```
uv run ruff check app/services/extraction_export_service.py tests/unit/test_extraction_export_header_label.py
uv run ruff format app/services/extraction_export_service.py tests/unit/test_extraction_export_header_label.py
```
Commit:
```
fix(export): preserve compound surnames in column headers

Particle-aware surname extraction (van/de/der/von/da...) so "Carlo De
Feo" renders "De Feo, 2012" instead of "Feo, 2012".

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
```

---

### Task 35: Full-slice regression gate (export unit + integration + lint)

**Files:**
- Test only (no production changes): the full export test surface.

- [ ] **Step 1: Run the complete export test surface.** From `backend/` (needs local Supabase on :54322):
```
uv run pytest \
  tests/unit/test_extraction_export_descriptors.py \
  tests/unit/test_extraction_matrix_builder.py \
  tests/unit/test_extraction_xlsx_builder.py \
  tests/unit/test_extraction_export_header_label.py \
  tests/unit/test_extraction_export_determinism.py \
  tests/integration/test_extraction_export_many_cardinality_fanout.py \
  tests/integration/test_extraction_export_ai_outcome.py \
  -q
```
Expected PASS (all green). The AI-outcome integration test (A6) must still pass — it reads instance ids through the `instance_index_by_id` block, which consumes the additive `section_instances` tuple shape (or, for legacy single-instance callers, the `study_instances` read-compat alias property). If it RED-fails, fix the reference there and re-run.

- [ ] **Step 2: Grep for stray production readers of the legacy shape.** This slice is **additive**: it adds `section_instances` (ordered tuple per entity_type) as the new canonical shape while **intentionally retaining** `study_instances` as a documented read-compat alias *property* (`app/services/extraction_export_service.py`) for the not-yet-migrated AI loader and any legacy single-instance test callers. So a full `grep -rn "study_instances" app tests` is expected to keep ~30 matches — the alias def, the test-helper kwargs that build `section_instances` from alias-shaped input, and the alias-coverage test. The gate is instead: no production code under `app/` should still *read* the alias via attribute access. From `backend/`:
```
grep -rn "\.study_instances" app | grep -v __pycache__
```
Expected: **zero matches** — every production consumer (matrix builder, fan-out, AI loader) reads `article.section_instances` directly; the `study_instances` property survives only as the read-compat alias definition (which this grep does not match). If a production module still does `article.study_instances`, migrate it to `section_instances` and re-run Step 1. (The bare-name `study_instances` references in `tests/` and the alias `def`/docstring are expected and correct — do **not** remove them.)

- [ ] **Step 3: Lint the whole touched surface.** From `backend/`:
```
uv run ruff check app/services/extraction_export_service.py app/services/exports/extraction_xlsx_builder.py tests/unit/test_extraction_export_descriptors.py tests/unit/test_extraction_matrix_builder.py tests/unit/test_extraction_export_header_label.py tests/integration/test_extraction_export_many_cardinality_fanout.py
```
Expected: clean.

- [ ] **Step 4: Commit (only if Step 1 surfaced a fix; otherwise skip).** If the A6 integration reference needed repair:
```
fix(export): update AI outcome reader to section_instances

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
```

---

**Notes for the synthesizer / downstream slices:**
- This slice keeps `_load_sections` on the **live tables** (adding `cardinality`). The phase-1 snapshot slice swaps it for `load_export_sections`; that reader must populate `SectionDescriptor.cardinality` from `SnapshotSection.cardinality` (no further change to the fan-out code here).
- The locked preamble also adds `ArticleDescriptor.version_id` and the grown `FieldDescriptor`/`ExportLayout` fields — those are **owned by the phase-1 slice**, not here. This slice adds only `SectionDescriptor.cardinality` and the `study_instances → section_instances` rename, both with defaults that keep existing `()`-arg construction valid.
- The single fan-out axis decision (max instance count, no cartesian product of independent many-sections) is recorded in the first task and enforced by `_article_fanout_count`; if a later template requires independent many-sections side-by-side, that is a follow-up, not this slice.

Relevant absolute paths touched: `backend/app/services/extraction_export_service.py`, `backend/app/services/exports/extraction_xlsx_builder.py`, and the new/extended tests under `backend/tests/unit/` and `backend/tests/integration/`.


---

## Phase S5 — Split builder into pure sub-builders + structural styling

### Task 36: Establish the `extraction/` sub-builder package skeleton (re-export shim)

**Files:**
- Create `backend/app/services/exports/extraction/__init__.py`
- Create `backend/app/services/exports/extraction/workbook.py`
- Modify `backend/app/services/exports/extraction_xlsx_builder.py` (current PUBLIC `build_workbook` @62) — convert to a thin re-export shim
- Test: `backend/tests/unit/test_extraction_xlsx_builder.py` (existing, unchanged; it is the green-gate)

- [ ] **Step 1: Pin the green baseline.** Run the existing builder suite untouched to capture the current pass count as the regression gate this whole slice must keep green.
  Command (from `backend/`): `uv run pytest tests/unit/test_extraction_xlsx_builder.py tests/unit/test_extraction_export_determinism.py -q`
  Expected: **PASS** (record the count, e.g. `N passed`). This is the baseline; every later step re-runs it and must stay at exactly this count.

- [ ] **Step 2: Write a failing import test for the new package entry point.** The orchestrator does not exist yet, so importing it must fail.
  Create `backend/tests/unit/test_extraction_workbook_package.py`:
  ```python
  """Slice-3 package skeleton: the new orchestrator entry point exists and
  is the single public surface, while the legacy module re-exports it so
  endpoint/worker/tests stay untouched."""

  from __future__ import annotations


  def test_package_exposes_build_workbook() -> None:
      from app.services.exports.extraction import build_workbook as pkg_build

      assert callable(pkg_build)


  def test_workbook_module_exposes_build_workbook() -> None:
      from app.services.exports.extraction.workbook import build_workbook as mod_build

      assert callable(mod_build)


  def test_legacy_module_reexports_same_object() -> None:
      from app.services.exports.extraction.workbook import build_workbook as canonical
      from app.services.exports.extraction_xlsx_builder import build_workbook as legacy

      # The legacy import path must resolve to the exact same function object
      # so endpoint/worker imports keep working with zero behaviour drift.
      assert legacy is canonical
  ```
  Command (from `backend/`): `uv run pytest tests/unit/test_extraction_workbook_package.py -q`
  Expected: **FAIL** — `ModuleNotFoundError: No module named 'app.services.exports.extraction'`.

- [ ] **Step 3: Create the package `__init__.py`.** Re-export `build_workbook` from the orchestrator so `app.services.exports.extraction` is the package public surface.
  Create `backend/app/services/exports/extraction/__init__.py`:
  ```python
  """Pure XLSX sub-builder package for extraction exports.

  Every ``build_<sheet>(layout) -> SheetSpec`` is a pure, no-IO function
  (no DB session, no storage adapter, no network) so each sheet is
  unit-testable without an openpyxl ``Workbook``. ``workbook.py`` is the
  only orchestrator and owns the single public ``build_workbook(layout)``
  signature consumed by the endpoint and the Celery worker.
  """

  from __future__ import annotations

  from app.services.exports.extraction.workbook import build_workbook

  __all__ = ["build_workbook"]
  ```
  No test run yet — `workbook.py` is created next in the same atomic move.

- [ ] **Step 4: Create the orchestrator `workbook.py` delegating to the legacy module.** Keep the current behaviour bit-for-bit by re-using the verbatim writers still living in `extraction_xlsx_builder.py`. This is the safe lift-shell: it preserves the PUBLIC `build_workbook(layout) -> bytes` signature and produces identical bytes.
  Create `backend/app/services/exports/extraction/workbook.py`:
  ```python
  """Workbook orchestrator for extraction exports.

  Owns the PUBLIC ``build_workbook(layout) -> bytes`` signature consumed by
  the endpoint and the Celery worker. It assembles the workbook by calling
  each pure sub-builder in spec order (§4) and rendering the returned
  ``SheetSpec``s onto worksheets. During the slice-3 split it delegates the
  not-yet-migrated sheets back to the legacy writers so behaviour stays
  byte-identical at every step.
  """

  from __future__ import annotations

  import io

  from openpyxl import Workbook

  from app.services.extraction_export_service import ExportLayout


  def build_workbook(layout: ExportLayout) -> bytes:
      """Build the export workbook bytes for the given layout."""
      # Legacy writers are imported lazily to avoid an import cycle while the
      # split is in flight (the legacy module re-exports this function).
      from app.services.exports.extraction_xlsx_builder import (
          _write_ai_metadata_sheet,
          _write_main_sheet,
          _write_notes_sheet,
      )

      wb = Workbook()
      default = wb.active
      if default is not None:
          wb.remove(default)

      _write_main_sheet(wb, layout)
      if layout.include_ai_metadata:
          _write_ai_metadata_sheet(wb, layout)
      _write_notes_sheet(wb, layout)

      buf = io.BytesIO()
      wb.save(buf)
      return buf.getvalue()


  __all__ = ["build_workbook"]
  ```

- [ ] **Step 5: Turn the legacy module into a re-export shim for the public symbol.** Replace the legacy module's own `build_workbook` body (`extraction_xlsx_builder.py:62-82`) with a re-export of the orchestrator, keeping every `_write_*`/`_format_cell`/`_xlsx_safe`/`_safe_sheet_name` helper in place (the orchestrator still calls them). Edit the legacy `def build_workbook` block and `__all__`:
  Replace the function at `extraction_xlsx_builder.py:62-82`:
  ```python
  def build_workbook(layout: ExportLayout) -> bytes:
      """Build the export workbook bytes for the given layout.

      Re-exported from the orchestrator package
      ``app.services.exports.extraction.workbook`` so the historical import
      path ``app.services.exports.extraction_xlsx_builder.build_workbook``
      keeps resolving to the single canonical implementation. The sheet
      writers below remain here until each migrates to its own pure
      sub-builder later in the split.
      """
      from app.services.exports.extraction.workbook import (
          build_workbook as _orchestrate,
      )

      return _orchestrate(layout)
  ```
  Leave the `io`/`Workbook` imports in place (still used by `_write_*` helpers indirectly via openpyxl), and keep `__all__ = ["build_workbook"]` unchanged.

- [ ] **Step 6: Run the new package test — expect PASS.**
  Command (from `backend/`): `uv run pytest tests/unit/test_extraction_workbook_package.py -q`
  Expected: **PASS** (3 passed). `legacy is canonical` holds because both resolve to the orchestrator's `build_workbook`.

- [ ] **Step 7: Re-run the green-gate — behaviour unchanged.** The endpoint/worker/determinism tests must still pass at the baseline count from Step 1.
  Command (from `backend/`): `uv run pytest tests/unit/test_extraction_xlsx_builder.py tests/unit/test_extraction_export_determinism.py -q`
  Expected: **PASS** at the same count as Step 1.

- [ ] **Step 8: Lint + commit.**
  Commands (from `backend/`): `uv run ruff check app/services/exports/ tests/unit/test_extraction_workbook_package.py && uv run ruff format app/services/exports/ tests/unit/test_extraction_workbook_package.py`
  Commit:
  ```
  refactor(backend): introduce extraction export sub-builder package shell

  Add app/services/exports/extraction/ with a workbook.py orchestrator that
  owns the public build_workbook(layout)->bytes signature; the legacy
  extraction_xlsx_builder module now re-exports it so endpoint/worker/tests
  are untouched. Behaviour byte-identical (delegates to existing writers).

  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
  ```

---

### Task 37: Add the pure `SheetSpec` IR + openpyxl renderer

**Files:**
- Create `backend/app/services/exports/extraction/sheet_spec.py`
- Test: `backend/tests/unit/test_sheet_spec.py` (new)

- [ ] **Step 1: Write failing tests for the `SheetSpec` value objects and `_render_sheet_spec`.** Assert the pure dataclasses exist, are frozen, and that the renderer writes values, merges, freeze, tab colour, and widths onto a real worksheet.
  Create `backend/tests/unit/test_sheet_spec.py`:
  ```python
  """Pure IR (SheetSpec) + the single openpyxl renderer. The IR is
  openpyxl-free so every sub-builder is testable without a Workbook; the
  renderer is the only place openpyxl touches a worksheet."""

  from __future__ import annotations

  import dataclasses

  import pytest
  from openpyxl import Workbook

  from app.services.exports.extraction.sheet_spec import (
      Cell,
      CellStyle,
      MergeSpan,
      SheetSpec,
      _render_sheet_spec,
  )


  def test_value_objects_are_frozen() -> None:
      for cls in (Cell, CellStyle, MergeSpan, SheetSpec):
          assert dataclasses.is_dataclass(cls)
          assert cls.__dataclass_params__.frozen is True


  def test_cell_defaults_to_no_style() -> None:
      assert Cell(value="x").style is None


  def test_render_writes_values_and_merges_and_freeze_and_tab() -> None:
      spec = SheetSpec(
          title="Demo",
          rows=(
              (Cell("A1", CellStyle(bold=True, fill="EEEEEE")), Cell("B1")),
              (Cell(5), Cell(2.5)),
          ),
          merges=(MergeSpan(start_row=1, start_col=1, end_row=1, end_col=2),),
          column_widths=(16.0, None),
          freeze="B2",
          tab_color="FF0000",
      )
      wb = Workbook()
      wb.remove(wb.active)
      ws = wb.create_sheet(title="placeholder")

      _render_sheet_spec(ws, spec)

      assert ws.title == "Demo"
      assert ws["A1"].value == "A1"
      assert ws["A1"].font.bold is True
      assert ws["A2"].value == 5
      assert ws["B2"].value == 2.5
      assert "A1:B1" in {str(m) for m in ws.merged_cells.ranges}
      assert ws.freeze_panes == "B2"
      assert ws.sheet_properties.tabColor is not None
      assert ws.column_dimensions["A"].width == 16.0


  def test_render_skips_none_cells_and_ragged_rows() -> None:
      spec = SheetSpec(
          title="Ragged",
          rows=(
              (Cell(None), Cell("kept")),
              (Cell("only-one-col"),),
          ),
      )
      wb = Workbook()
      wb.remove(wb.active)
      ws = wb.create_sheet(title="x")
      _render_sheet_spec(ws, spec)
      assert ws["A1"].value is None
      assert ws["B1"].value == "kept"
      assert ws["A2"].value == "only-one-col"
  ```
  Command (from `backend/`): `uv run pytest tests/unit/test_sheet_spec.py -q`
  Expected: **FAIL** — `ModuleNotFoundError: No module named 'app.services.exports.extraction.sheet_spec'`.

- [ ] **Step 2: Implement `sheet_spec.py`.** Define the pure value objects exactly per the locked contract, plus the single openpyxl writer.
  Create `backend/app/services/exports/extraction/sheet_spec.py`:
  ```python
  """Pure intermediate representation for one worksheet + its renderer.

  ``SheetSpec`` and its value objects are openpyxl-free: every sub-builder
  returns a ``SheetSpec`` (or ``list[SheetSpec]`` / ``None``) built from
  plain Python, so sub-builder tests assert on rows/cells without a
  ``Workbook``. ``_render_sheet_spec`` is the ONLY place openpyxl writes to
  a worksheet — structural styling only (no conditional formatting, §9).
  """

  from __future__ import annotations

  from dataclasses import dataclass

  from openpyxl.styles import Alignment, Font, PatternFill
  from openpyxl.utils import get_column_letter
  from openpyxl.worksheet.worksheet import Worksheet

  CellValue = str | int | float | bool | None


  @dataclass(frozen=True)
  class CellStyle:
      """Structural-only styling (no conditional formatting — §9)."""

      bold: bool = False
      fill: str | None = None  # hex fill, e.g. "EEEEEE"; None = no fill
      align: str | None = None  # "left" | "center" | "right"
      wrap: bool = False


  @dataclass(frozen=True)
  class Cell:
      value: CellValue
      style: CellStyle | None = None


  @dataclass(frozen=True)
  class MergeSpan:
      """1-based inclusive merge range."""

      start_row: int
      start_col: int
      end_row: int
      end_col: int


  @dataclass(frozen=True)
  class SheetSpec:
      """Pure, openpyxl-free description of one worksheet."""

      title: str  # already sheet-name-safe (<=31, no forbidden chars)
      rows: tuple[tuple[Cell, ...], ...]  # row-major; ragged rows allowed
      merges: tuple[MergeSpan, ...] = ()
      column_widths: tuple[float | None, ...] = ()  # per-column; None = default
      freeze: str | None = None  # openpyxl freeze ref, e.g. "C3"; None = none
      tab_color: str | None = None  # hex tab colour or None


  def _style_to_kwargs(style: CellStyle) -> tuple[Font | None, Alignment | None, PatternFill | None]:
      font = Font(bold=True) if style.bold else None
      alignment = None
      if style.align is not None or style.wrap:
          alignment = Alignment(
              horizontal=style.align,
              vertical="center",
              wrap_text=style.wrap,
          )
      fill = PatternFill("solid", fgColor=style.fill) if style.fill else None
      return font, alignment, fill


  def _render_sheet_spec(ws: Worksheet, spec: SheetSpec) -> None:
      """Render a SheetSpec onto an existing (empty) worksheet."""
      ws.title = spec.title

      for r_idx, row in enumerate(spec.rows, start=1):
          for c_idx, cell in enumerate(row, start=1):
              target = ws.cell(row=r_idx, column=c_idx, value=cell.value)
              if cell.style is not None:
                  font, alignment, fill = _style_to_kwargs(cell.style)
                  if font is not None:
                      target.font = font
                  if alignment is not None:
                      target.alignment = alignment
                  if fill is not None:
                      target.fill = fill

      for span in spec.merges:
          ws.merge_cells(
              start_row=span.start_row,
              start_column=span.start_col,
              end_row=span.end_row,
              end_column=span.end_col,
          )

      for c_idx, width in enumerate(spec.column_widths, start=1):
          if width is not None:
              ws.column_dimensions[get_column_letter(c_idx)].width = width

      if spec.freeze is not None:
          ws.freeze_panes = spec.freeze

      if spec.tab_color is not None:
          ws.sheet_properties.tabColor = spec.tab_color


  __all__ = [
      "Cell",
      "CellStyle",
      "CellValue",
      "MergeSpan",
      "SheetSpec",
      "_render_sheet_spec",
  ]
  ```

- [ ] **Step 3: Run the test — expect PASS.**
  Command (from `backend/`): `uv run pytest tests/unit/test_sheet_spec.py -q`
  Expected: **PASS** (4 passed).

- [ ] **Step 4: Lint + commit.**
  Commands (from `backend/`): `uv run ruff check app/services/exports/extraction/sheet_spec.py tests/unit/test_sheet_spec.py && uv run ruff format app/services/exports/extraction/sheet_spec.py tests/unit/test_sheet_spec.py`
  Commit:
  ```
  feat(backend): add pure SheetSpec IR + openpyxl renderer for exports

  SheetSpec/Cell/CellStyle/MergeSpan are openpyxl-free value objects;
  _render_sheet_spec is the single worksheet writer (structural styling
  only, no conditional formatting per spec §9).

  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
  ```

---

### Task 38: Lift `_write_main_sheet` verbatim into `matrix.build_matrix` returning a `SheetSpec`

**Files:**
- Modify `backend/app/services/exports/extraction/matrix.py` (create)
- Modify `backend/app/services/exports/extraction/workbook.py` (route matrix through the sub-builder)
- Test: `backend/tests/unit/test_extraction_matrix_builder.py` (new)

> Behaviour contract for this task: `build_matrix` must produce a `SheetSpec` that, once rendered, yields a matrix sheet **byte-equivalent** (same cell values, merges, header layout, study-section repeat-not-merge, all-users reviewer fan-out) to today's `_write_main_sheet`. This is the "lift verbatim, tests stay green" step — **no styling change yet**.

- [ ] **Step 1: Write failing structural tests for `build_matrix`.** Mirror the existing `_write_main_sheet` assertions from `test_extraction_xlsx_builder.py` but against the rendered `SheetSpec`. Cover: header labels (`Section`/`Field`), a consensus value cell, study-section repeat-not-merge across model sub-columns, and the empty-articles placeholder.
  Create `backend/tests/unit/test_extraction_matrix_builder.py`:
  ```python
  """Matrix sub-builder (§5.4). Lifted verbatim from _write_main_sheet;
  asserted on the rendered SheetSpec so the split keeps cell values, merged
  record headers and study-section repeat-not-merge identical."""

  from __future__ import annotations

  from uuid import UUID, uuid4

  from openpyxl import Workbook

  from app.models.extraction import ExtractionEntityRole, ExtractionFieldType
  from app.services.exports.extraction.matrix import build_matrix
  from app.services.exports.extraction.sheet_spec import _render_sheet_spec
  from app.services.extraction_export_service import (
      ArticleDescriptor,
      ExportLayout,
      ExportMode,
      ExportNotes,
      FieldDescriptor,
      SectionDescriptor,
  )


  def _render(layout: ExportLayout):
      spec = build_matrix(layout)
      wb = Workbook()
      wb.remove(wb.active)
      ws = wb.create_sheet(title="tmp")
      _render_sheet_spec(ws, spec)
      return ws


  def _field(label: str, ftype: ExtractionFieldType, parent: UUID) -> FieldDescriptor:
      return FieldDescriptor(
          field_id=uuid4(),
          label=label,
          type=ftype,
          allowed_values=(),
          parent_section_id=parent,
      )


  def _layout(
      *,
      sections: tuple[SectionDescriptor, ...],
      articles: tuple[ArticleDescriptor, ...],
      value_map: dict | None = None,
      mode: ExportMode = ExportMode.CONSENSUS,
      reviewers: tuple = (),
  ) -> ExportLayout:
      return ExportLayout(
          project_name="P",
          template_name="My Template",
          template_version=1,
          sections=sections,
          articles=articles,
          reviewers=reviewers,
          mode=mode,
          include_ai_metadata=False,
          anonymize_reviewer_names=False,
          notes=ExportNotes(),
          value_map=value_map or {},
      )


  def test_header_block_labels() -> None:
      sec_id = uuid4()
      field = _field("1.1 Source", ExtractionFieldType.TEXT, sec_id)
      section = SectionDescriptor(
          entity_type_id=sec_id,
          label="1. Source of data",
          role=ExtractionEntityRole.STUDY_SECTION,
          parent_entity_type_id=None,
          fields=(field,),
      )
      run_id, inst_id, art_id = uuid4(), uuid4(), uuid4()
      article = ArticleDescriptor(
          article_id=art_id,
          header_label="Smith, 2020",
          run_id=run_id,
          run_stage=None,
          model_instances=(),
          study_instances={sec_id: inst_id},
      )
      layout = _layout(
          sections=(section,),
          articles=(article,),
          value_map={(run_id, inst_id, field.field_id): "Registry"},
      )
      ws = _render(layout)
      assert ws.cell(row=1, column=1).value == "Section"
      assert ws.cell(row=1, column=2).value == "Field"
      assert ws.cell(row=1, column=3).value == "Smith, 2020"
      # field value rendered in column C under the article.
      assert "Registry" in {
          ws.cell(row=r, column=3).value for r in range(1, ws.max_row + 1)
      }


  def test_empty_articles_placeholder() -> None:
      layout = _layout(sections=(), articles=())
      ws = _render(layout)
      assert ws.cell(row=1, column=1).value == "(No eligible articles for the selected mode.)"


  def test_study_section_repeats_not_merges_across_models() -> None:
      study_id = uuid4()
      study_field = _field("Author", ExtractionFieldType.TEXT, study_id)
      study = SectionDescriptor(
          entity_type_id=study_id,
          label="Study",
          role=ExtractionEntityRole.STUDY_SECTION,
          parent_entity_type_id=None,
          fields=(study_field,),
      )
      run_id, study_inst = uuid4(), uuid4()
      m1, m2 = uuid4(), uuid4()
      article = ArticleDescriptor(
          article_id=uuid4(),
          header_label="A",
          run_id=run_id,
          run_stage=None,
          model_instances=(m1, m2),
          study_instances={study_id: study_inst},
      )
      layout = _layout(
          sections=(study,),
          articles=(article,),
          value_map={(run_id, study_inst, study_field.field_id): "Doe"},
      )
      ws = _render(layout)
      # Study value repeated across BOTH model sub-columns (C and D), not merged.
      row = next(
          r
          for r in range(1, ws.max_row + 1)
          if ws.cell(row=r, column=3).value == "Doe"
      )
      assert ws.cell(row=row, column=4).value == "Doe"
      merged = {str(m) for m in ws.merged_cells.ranges}
      assert f"C{row}:D{row}" not in merged
  ```
  Command (from `backend/`): `uv run pytest tests/unit/test_extraction_matrix_builder.py -q`
  Expected: **FAIL** — `ModuleNotFoundError: No module named 'app.services.exports.extraction.matrix'`.

- [ ] **Step 2: Create `matrix.py` by lifting `_write_main_sheet` verbatim into a `SheetSpec` producer.** Re-implement the existing writer's logic as accumulation into `SheetSpec` rows/merges instead of direct `ws.cell(...)` calls — identical row/column math, identical `_resolve_instance_id`/`_lookup_value`/`_format_cell` semantics (import the still-living helpers from the legacy module to guarantee verbatim behaviour). Cells carry no style yet (styling is the next task).
  Create `backend/app/services/exports/extraction/matrix.py`:
  ```python
  """Extraction matrix sub-builder (§5.4) — fields-as-rows × record-columns.

  Lifted verbatim from the legacy ``_write_main_sheet``: identical row/column
  geometry, reviewer-axis fan-out, merged record headers and study-section
  repeat-not-merge (009 FR-010). Emits a pure ``SheetSpec``; structural
  styling is layered on in a later step. The value-resolution helpers are
  imported from the legacy module so behaviour is byte-equivalent during the
  split.
  """

  from __future__ import annotations

  from uuid import UUID

  from app.models.extraction import ExtractionEntityRole
  from app.services.exports.extraction.sheet_spec import Cell, MergeSpan, SheetSpec
  from app.services.extraction_export_service import (
      ArticleDescriptor,
      ExportLayout,
      ExportMode,
  )

  #: Column index (1-based) of the first article data column.
  _FIRST_DATA_COL = 3

  _FORBIDDEN_SHEET_CHARS = set(r"[]:*?/\\")
  _SHEET_MAX_LEN = 31


  def _safe_sheet_name(raw: str) -> str:
      cleaned = "".join(c for c in raw if c not in _FORBIDDEN_SHEET_CHARS).strip()
      return cleaned[:_SHEET_MAX_LEN]


  def build_matrix(layout: ExportLayout) -> SheetSpec:
      """Build the data-entry matrix sheet as a pure SheetSpec."""
      from app.services.exports.extraction_xlsx_builder import (
          _format_cell,
          _lookup_value,
          _resolve_instance_id,
          _xlsx_safe,
      )

      title = _safe_sheet_name(layout.template_name) or "Export"

      if not layout.articles:
          return SheetSpec(
              title=title,
              rows=((Cell("(No eligible articles for the selected mode.)"),),),
              column_widths=(60.0,),
          )

      is_all_users = layout.mode is ExportMode.ALL_USERS
      reviewer_axis: tuple[UUID | None, ...]
      if is_all_users:
          reviewer_axis = (None,) + tuple(r.reviewer_id for r in layout.reviewers)
      else:
          reviewer_axis = (None,)

      # Sparse cell grid: (row, col) -> value. Rows/cols are 1-based.
      grid: dict[tuple[int, int], object] = {}
      merges: list[MergeSpan] = []

      grid[(1, 1)] = "Section"
      grid[(1, 2)] = "Field"

      article_spans: list[tuple[ArticleDescriptor, int, int]] = []
      col_cursor = _FIRST_DATA_COL
      for article in layout.articles:
          models_per_article = max(1, len(article.model_instances))
          span = models_per_article * len(reviewer_axis)
          grid[(1, col_cursor)] = article.header_label
          first = col_cursor
          last = col_cursor + span - 1
          if span > 1:
              merges.append(MergeSpan(1, first, 1, last))
          article_spans.append((article, first, last))
          col_cursor += span

      header_offset = 1
      if is_all_users:
          header_offset = 2
          cur = _FIRST_DATA_COL
          for article in layout.articles:
              models_per_article = max(1, len(article.model_instances))
              for _model_idx in range(models_per_article):
                  for rev in reviewer_axis:
                      label = (
                          "Consensus"
                          if rev is None
                          else next(
                              (
                                  r.display_label
                                  for r in layout.reviewers
                                  if r.reviewer_id == rev
                              ),
                              str(rev).split("-")[0],
                          )
                      )
                      grid[(2, cur)] = label
                      cur += 1

      row_cursor = header_offset + 1
      for section in layout.sections:
          if section.role is ExtractionEntityRole.MODEL_CONTAINER and not section.fields:
              continue

          grid[(row_cursor, 1)] = section.label
          last_col = col_cursor - 1
          if last_col > 1:
              merges.append(MergeSpan(row_cursor, 1, row_cursor, last_col))
          row_cursor += 1

          for field_desc in section.fields:
              grid[(row_cursor, 2)] = field_desc.label
              for article, first_col, _last_col in article_spans:
                  models_per_article = max(1, len(article.model_instances))
                  slot = 0
                  for model_idx in range(models_per_article):
                      instance_id = _resolve_instance_id(
                          section=section,
                          article=article,
                          model_index=model_idx,
                      )
                      for rev in reviewer_axis:
                          sub_col = first_col + slot
                          slot += 1
                          value = _lookup_value(
                              layout=layout,
                              article=article,
                              instance_id=instance_id,
                              field=field_desc,
                              reviewer_id=rev,
                          )
                          formatted = _format_cell(value, field_desc)
                          if formatted is not None:
                              grid[(row_cursor, sub_col)] = _xlsx_safe(formatted)
              row_cursor += 1

      max_row = row_cursor - 1
      max_col = col_cursor - 1
      rows = tuple(
          tuple(Cell(grid.get((r, c))) for c in range(1, max_col + 1))
          for r in range(1, max_row + 1)
      )

      widths: list[float | None] = [16.0, 36.0]
      widths += [24.0] * (max_col - 2)

      return SheetSpec(
          title=title,
          rows=rows,
          merges=tuple(merges),
          column_widths=tuple(widths),
      )


  __all__ = ["build_matrix"]
  ```

- [ ] **Step 3: Run the matrix tests — expect PASS.**
  Command (from `backend/`): `uv run pytest tests/unit/test_extraction_matrix_builder.py -q`
  Expected: **PASS** (3 passed).

- [ ] **Step 4: Route the orchestrator's matrix sheet through `build_matrix`.** Replace the lazy `_write_main_sheet` call in `workbook.py` with render-from-spec; keep AI metadata + Notes on the legacy writers for now.
  Edit `backend/app/services/exports/extraction/workbook.py` — replace the `from ... import (_write_ai_metadata_sheet, _write_main_sheet, _write_notes_sheet)` + `_write_main_sheet(wb, layout)` block:
  ```python
      from app.services.exports.extraction_xlsx_builder import (
          _write_ai_metadata_sheet,
          _write_notes_sheet,
      )

      from app.services.exports.extraction.matrix import build_matrix
      from app.services.exports.extraction.sheet_spec import _render_sheet_spec

      wb = Workbook()
      default = wb.active
      if default is not None:
          wb.remove(default)

      matrix_ws = wb.create_sheet(title="matrix")
      _render_sheet_spec(matrix_ws, build_matrix(layout))
      if layout.include_ai_metadata:
          _write_ai_metadata_sheet(wb, layout)
      _write_notes_sheet(wb, layout)
  ```

- [ ] **Step 5: Run the full green-gate — matrix output must match the legacy sheet.** The existing `test_extraction_xlsx_builder.py` asserts cell values/merges on the main sheet; they must still pass against the spec-rendered matrix.
  Command (from `backend/`): `uv run pytest tests/unit/test_extraction_xlsx_builder.py tests/unit/test_extraction_export_determinism.py tests/unit/test_extraction_matrix_builder.py -q`
  Expected: **PASS** at the Step-1 baseline count (plus the new matrix tests).
  If any main-sheet test fails, the lift drifted — diff the failing cell coordinate against the legacy `_write_main_sheet` geometry before changing anything else.

- [ ] **Step 6: Lint + commit.**
  Commands (from `backend/`): `uv run ruff check app/services/exports/extraction/ tests/unit/test_extraction_matrix_builder.py && uv run ruff format app/services/exports/extraction/ tests/unit/test_extraction_matrix_builder.py`
  Commit:
  ```
  refactor(backend): lift extraction matrix into a pure SheetSpec sub-builder

  build_matrix(layout)->SheetSpec reproduces _write_main_sheet geometry
  verbatim (reviewer-axis fan-out, merged record headers, study-section
  repeat-not-merge); the orchestrator renders it via _render_sheet_spec.
  Output byte-equivalent — legacy builder tests stay green.

  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
  ```

---

### Task 39: Restyle the matrix structural-only (freeze, banding, tab colour, typed cells, numbering)

**Files:**
- Modify `backend/app/services/exports/extraction/matrix.py`
- Test: `backend/tests/unit/test_extraction_matrix_builder.py` (extend)

> Structural styling per §9 ONLY: freeze panes, bold/filled section-band rows, bold centered header row, tab colour, left-wrap label column, typed cells, and generic hierarchical `section.field` numbering on field labels. **No conditional formatting** (no per-value tinting, no traffic lights).

- [ ] **Step 1: Write failing styling assertions.** Extend `test_extraction_matrix_builder.py` with a styling test: header row bold, section-band row filled, freeze pane at `C2` (consensus/single) and `C3` (all-users), tab colour set, and hierarchical numbering `1.1` prefixed onto the first field of the first section.
  Append to `backend/tests/unit/test_extraction_matrix_builder.py`:
  ```python
  def test_matrix_structural_styling() -> None:
      sec_id = uuid4()
      f1 = _field("Source", ExtractionFieldType.TEXT, sec_id)
      f2 = _field("Year", ExtractionFieldType.TEXT, sec_id)
      section = SectionDescriptor(
          entity_type_id=sec_id,
          label="Source of data",
          role=ExtractionEntityRole.STUDY_SECTION,
          parent_entity_type_id=None,
          fields=(f1, f2),
      )
      run_id, inst_id = uuid4(), uuid4()
      article = ArticleDescriptor(
          article_id=uuid4(),
          header_label="A",
          run_id=run_id,
          run_stage=None,
          model_instances=(),
          study_instances={sec_id: inst_id},
      )
      layout = _layout(sections=(section,), articles=(article,))
      spec = build_matrix(layout)

      # Freeze locks label block (A,B) + header row -> first scrollable cell C2.
      assert spec.freeze == "C2"
      assert spec.tab_color is not None

      # Header row 1 is bold.
      assert spec.rows[0][0].style is not None and spec.rows[0][0].style.bold

      # The section-band row is bold + filled across the row.
      band = next(
          row
          for row in spec.rows
          if row[0].value == "1. Source of data" or row[0].value == "Source of data"
      )
      assert band[0].style is not None and band[0].style.bold
      assert band[0].style.fill is not None

      # Hierarchical numbering on field labels: section 1 -> "1.1 Source".
      labels = {
          row[1].value
          for row in spec.rows
          if row[1].value is not None
      }
      assert "1.1 Source" in labels
      assert "1.2 Year" in labels


  def test_matrix_freeze_all_users_uses_two_header_rows() -> None:
      from app.services.extraction_export_service import ReviewerDescriptor

      sec_id = uuid4()
      f1 = _field("Source", ExtractionFieldType.TEXT, sec_id)
      section = SectionDescriptor(
          entity_type_id=sec_id,
          label="Source",
          role=ExtractionEntityRole.STUDY_SECTION,
          parent_entity_type_id=None,
          fields=(f1,),
      )
      rid = uuid4()
      run_id, inst_id = uuid4(), uuid4()
      article = ArticleDescriptor(
          article_id=uuid4(),
          header_label="A",
          run_id=run_id,
          run_stage=None,
          model_instances=(),
          study_instances={sec_id: inst_id},
      )
      layout = _layout(
          sections=(section,),
          articles=(article,),
          mode=ExportMode.ALL_USERS,
          reviewers=(ReviewerDescriptor(reviewer_id=rid, display_label="R1"),),
      )
      spec = build_matrix(layout)
      assert spec.freeze == "C3"
  ```
  Command (from `backend/`): `uv run pytest tests/unit/test_extraction_matrix_builder.py -q`
  Expected: **FAIL** — `spec.freeze is None`, no styles, and numbering absent.

- [ ] **Step 2: Apply structural styling + hierarchical numbering in `build_matrix`.** Introduce module-level `CellStyle` constants, a `1.N` field-numbering counter per section, fill/bold the section-band row, bold-center the header row(s), set `freeze`/`tab_color`, and left-wrap the field label column.
  Edit `backend/app/services/exports/extraction/matrix.py` imports + constants (add to the existing `sheet_spec` import and after `_SHEET_MAX_LEN`):
  ```python
  from app.services.exports.extraction.sheet_spec import (
      Cell,
      CellStyle,
      MergeSpan,
      SheetSpec,
  )
  ```
  Add module constants:
  ```python
  _HEADER_STYLE = CellStyle(bold=True, align="center", wrap=False)
  _BAND_STYLE = CellStyle(bold=True, fill="EEEEEE", align="left")
  _LABEL_STYLE = CellStyle(align="left", wrap=True)
  _MATRIX_TAB_COLOR = "1F4E78"
  ```
  Then, in `build_matrix`, switch from a plain-value `grid` to a `(value, style)` grid. Replace the grid declaration and all `grid[...] = value` writes so styled cells carry their style, and build the final `Cell` from the tuple. Concretely:
  - Change `grid: dict[tuple[int, int], object] = {}` to `grid: dict[tuple[int, int], tuple[object, CellStyle | None]] = {}`.
  - Header writes: `grid[(1, 1)] = ("Section", _HEADER_STYLE)`, `grid[(1, 2)] = ("Field", _HEADER_STYLE)`, article header `grid[(1, col_cursor)] = (article.header_label, _HEADER_STYLE)`, all-users sub-label `grid[(2, cur)] = (label, _HEADER_STYLE)`.
  - Section band: `grid[(row_cursor, 1)] = (f"{section_number}. {section.label}", _BAND_STYLE)` and fill the band tail cells `for c in range(2, last_col + 1): grid.setdefault((row_cursor, c), (None, _BAND_STYLE))`.
  - Field label: `grid[(row_cursor, 2)] = (f"{section_number}.{field_number} {field_desc.label}", _LABEL_STYLE)`.
  - Value cells: `grid[(row_cursor, sub_col)] = (_xlsx_safe(formatted), None)`.
  - Section/field numbering: introduce `section_number = 0` before the section loop, `section_number += 1` only for emitted (non-skipped) sections, and `field_number` reset to 0 per section, `field_number += 1` per field.
  - Final rows build: `Cell(*grid.get((r, c), (None, None)))`.
  - Return `SheetSpec(..., freeze=f"C{header_offset + 1}", tab_color=_MATRIX_TAB_COLOR)`.
  Full replacement of the section/field loop and the tail:
  ```python
      section_number = 0
      for section in layout.sections:
          if section.role is ExtractionEntityRole.MODEL_CONTAINER and not section.fields:
              continue
          section_number += 1

          grid[(row_cursor, 1)] = (f"{section_number}. {section.label}", _BAND_STYLE)
          last_col = col_cursor - 1
          if last_col > 1:
              merges.append(MergeSpan(row_cursor, 1, row_cursor, last_col))
              for c in range(2, last_col + 1):
                  grid.setdefault((row_cursor, c), (None, _BAND_STYLE))
          row_cursor += 1

          field_number = 0
          for field_desc in section.fields:
              field_number += 1
              grid[(row_cursor, 2)] = (
                  f"{section_number}.{field_number} {field_desc.label}",
                  _LABEL_STYLE,
              )
              for article, first_col, _last_col in article_spans:
                  models_per_article = max(1, len(article.model_instances))
                  slot = 0
                  for model_idx in range(models_per_article):
                      instance_id = _resolve_instance_id(
                          section=section,
                          article=article,
                          model_index=model_idx,
                      )
                      for rev in reviewer_axis:
                          sub_col = first_col + slot
                          slot += 1
                          value = _lookup_value(
                              layout=layout,
                              article=article,
                              instance_id=instance_id,
                              field=field_desc,
                              reviewer_id=rev,
                          )
                          formatted = _format_cell(value, field_desc)
                          if formatted is not None:
                              grid[(row_cursor, sub_col)] = (_xlsx_safe(formatted), None)
              row_cursor += 1

      max_row = row_cursor - 1
      max_col = col_cursor - 1
      rows = tuple(
          tuple(Cell(*grid.get((r, c), (None, None))) for c in range(1, max_col + 1))
          for r in range(1, max_row + 1)
      )

      widths: list[float | None] = [16.0, 36.0]
      widths += [24.0] * (max_col - 2)

      return SheetSpec(
          title=title,
          rows=rows,
          merges=tuple(merges),
          column_widths=tuple(widths),
          freeze=f"C{header_offset + 1}",
          tab_color=_MATRIX_TAB_COLOR,
      )
  ```
  Also update the header-block writes earlier in the function to the styled `(value, style)` tuple form as listed above, and the empty-articles return to `rows=((Cell("(No eligible articles for the selected mode.)"),),)` (unchanged — no style needed).

- [ ] **Step 3: Run the matrix tests — expect PASS.**
  Command (from `backend/`): `uv run pytest tests/unit/test_extraction_matrix_builder.py -q`
  Expected: **PASS** (5 passed).

- [ ] **Step 4: Reconcile the legacy main-sheet tests with the new numbered labels.** The hierarchical numbering changes field-label cell text (`Source` → `1.1 Source`), so any `test_extraction_xlsx_builder.py` assertion matching a bare field label on the main sheet must be updated to the numbered form (or relaxed to substring). Run the green-gate to find them.
  Command (from `backend/`): `uv run pytest tests/unit/test_extraction_xlsx_builder.py tests/unit/test_extraction_export_determinism.py -q`
  Expected: initially **FAIL** on any label-equality assertion. For each failure, update the expected label in the test to the numbered form (e.g. `assert ws.cell(...).value == "1.1 Source of data"`), since the new structural numbering is the intended behaviour. Re-run until **PASS**.
  (If a determinism test asserts byte-structure of the Notes/AI sheets only, it stays green; the matrix sheet's added freeze/tab/fill is deterministic across identical layouts.)

- [ ] **Step 5: Lint + commit.**
  Commands (from `backend/`): `uv run ruff check app/services/exports/extraction/matrix.py tests/unit/test_extraction_matrix_builder.py tests/unit/test_extraction_xlsx_builder.py && uv run ruff format app/services/exports/extraction/matrix.py tests/unit/test_extraction_matrix_builder.py tests/unit/test_extraction_xlsx_builder.py`
  Commit:
  ```
  feat(backend): structural styling for the extraction matrix sheet

  Freeze panes (lock label block + header row), bold/filled section bands,
  bold-centered header rows, tab colour, left-wrap field labels, and generic
  hierarchical section.field numbering. Structural only — no conditional
  formatting (spec §9).

  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
  ```

---

### Task 40: Move the matrix value/format/sheet-name helpers into the package (kill the legacy import dependency)

**Files:**
- Modify `backend/app/services/exports/extraction/matrix.py` (inline the helpers it imports from the legacy module)
- Test: `backend/tests/unit/test_extraction_matrix_builder.py` (existing, regression)

> Goal: `matrix.py` must not depend on `extraction_xlsx_builder` at runtime, so the legacy module can later be deleted (a sibling slice removes it). Move `_resolve_instance_id`, `_lookup_value`, `_format_cell` into `matrix.py` verbatim; `_xlsx_safe`'s `str(dict)` fallback is owned/removed by the value-envelope slice — here we route formatted cells through the package-local helper without the silent dict fallback.

- [ ] **Step 1: Write a failing isolation test.** Assert `matrix` does not import the legacy builder module.
  Append to `backend/tests/unit/test_extraction_matrix_builder.py`:
  ```python
  def test_matrix_module_has_no_legacy_builder_dependency() -> None:
      import ast
      import pathlib

      src = pathlib.Path(
          "app/services/exports/extraction/matrix.py"
      ).read_text(encoding="utf-8")
      tree = ast.parse(src)
      imported = set()
      for node in ast.walk(tree):
          if isinstance(node, ast.ImportFrom) and node.module:
              imported.add(node.module)
      assert "app.services.exports.extraction_xlsx_builder" not in imported
  ```
  Command (from `backend/`): `uv run pytest tests/unit/test_extraction_matrix_builder.py::test_matrix_module_has_no_legacy_builder_dependency -q`
  Expected: **FAIL** — the lazy `from app.services.exports.extraction_xlsx_builder import (...)` inside `build_matrix` is detected.

- [ ] **Step 2: Inline the helpers into `matrix.py`.** Remove the lazy legacy import and define `_resolve_instance_id`, `_lookup_value`, `_format_cell`, and a package-local `_xlsx_safe` (lists → `"; "`-joined; tz-aware datetime → naive; **no `str(dict)` fallback** — a dict reaching this point is a resolver bug and must surface, so leave dicts to fail loudly in the renderer per §6).
  Edit `backend/app/services/exports/extraction/matrix.py` — delete the lazy import block in `build_matrix`, and add module-level helpers (verbatim copies from the legacy module, minus the dict fallback):
  ```python
  from datetime import datetime
  from typing import Any

  from app.models.extraction import ExtractionEntityRole, ExtractionFieldType
  from app.services.extraction_export_service import (
      ArticleDescriptor,
      ExportLayout,
      ExportMode,
      FieldDescriptor,
      SectionDescriptor,
  )


  def _resolve_instance_id(
      *,
      section: SectionDescriptor,
      article: ArticleDescriptor,
      model_index: int,
  ) -> UUID | None:
      if section.role is ExtractionEntityRole.STUDY_SECTION:
          return article.study_instances.get(section.entity_type_id)
      if section.role is ExtractionEntityRole.MODEL_SECTION:
          if not article.model_instances:
              return None
          return article.model_instances[model_index]
      return None


  def _lookup_value(
      *,
      layout: ExportLayout,
      article: ArticleDescriptor,
      instance_id: UUID | None,
      field: FieldDescriptor,
      reviewer_id: UUID | None = None,
  ) -> Any:
      if instance_id is None or article.run_id is None:
          return None
      if layout.mode is ExportMode.ALL_USERS:
          return layout.value_map.get(
              (article.run_id, instance_id, field.field_id, reviewer_id)
          )
      return layout.value_map.get((article.run_id, instance_id, field.field_id))


  def _format_cell(value: Any, field: FieldDescriptor) -> Any:
      if value is None:
          return None
      ftype = field.type
      if ftype is ExtractionFieldType.BOOLEAN:
          return "Yes" if bool(value) else "No"
      if ftype is ExtractionFieldType.MULTISELECT:
          if isinstance(value, list):
              return "; ".join(str(item) for item in value if item is not None)
          return str(value)
      if ftype is ExtractionFieldType.SELECT:
          return value if isinstance(value, str) else str(value)
      return value


  def _xlsx_safe(value: Any) -> Any:
      """Coerce only the openpyxl-incompatible-but-expected shapes.

      Lists are joined; tz-aware datetimes are made naive. A ``dict`` is NOT
      silently stringified: by §6 every envelope is collapsed to a scalar by
      ``resolve_value`` upstream, so a dict here is a resolver defect that
      must fail loudly (openpyxl raises) rather than ship a Python-repr cell.
      """
      if value is None:
          return None
      if isinstance(value, list):
          return "; ".join(str(item) for item in value if item is not None)
      if isinstance(value, datetime) and value.tzinfo is not None:
          return value.replace(tzinfo=None)
      return value
  ```
  Update the body of `build_matrix` to call these module-level helpers directly (drop the inner `from ... import (...)`).

- [ ] **Step 3: Run the isolation + full matrix suite — expect PASS.**
  Command (from `backend/`): `uv run pytest tests/unit/test_extraction_matrix_builder.py -q`
  Expected: **PASS** (6 passed), including the isolation test.

- [ ] **Step 4: Re-run the green-gate.** The orchestrator still uses the legacy AI/Notes writers, so those tests remain green; the matrix no longer depends on the legacy module.
  Command (from `backend/`): `uv run pytest tests/unit/test_extraction_xlsx_builder.py tests/unit/test_extraction_export_determinism.py tests/unit/test_extraction_workbook_package.py tests/unit/test_sheet_spec.py -q`
  Expected: **PASS** at the cumulative count.

- [ ] **Step 5: Layering fitness check.** Confirm the new package introduces no layer violation (services → models only).
  Command (from repo root): `uv run python scripts/fitness/check_layered_arch.py` (run from `backend/` with the repo-root path if the script expects it: `cd` is discouraged — invoke as `uv run python ../scripts/fitness/check_layered_arch.py` from `backend/`, or per the project `make quality-scan` path).
  Expected: **exit 0**, no new edges from `app/services/exports/extraction/`.

- [ ] **Step 6: Lint + commit.**
  Commands (from `backend/`): `uv run ruff check app/services/exports/extraction/matrix.py tests/unit/test_extraction_matrix_builder.py && uv run ruff format app/services/exports/extraction/matrix.py tests/unit/test_extraction_matrix_builder.py`
  Commit:
  ```
  refactor(backend): make matrix sub-builder self-contained (no legacy dep)

  Inline _resolve_instance_id/_lookup_value/_format_cell/_xlsx_safe into
  matrix.py and drop the runtime import of extraction_xlsx_builder. The
  package-local _xlsx_safe drops the silent str(dict) fallback so a missed
  envelope shape fails loud (spec §6).

  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
  ```

---

### Task 41: Generalize the orchestrator to render an ordered list of `SheetSpec`s with the column guard

**Files:**
- Modify `backend/app/services/exports/extraction/workbook.py`
- Test: `backend/tests/unit/test_extraction_workbook_orchestrator.py` (new)

> This wires the orchestrator to the §9 contract shape: collect `build_<sheet>(layout) -> SheetSpec | None` results in spec order, drop `None`s, render each via `_render_sheet_spec`, run the §5.5 column guard. For this slice only the matrix is a real sub-builder; AI metadata + Notes stay on the legacy writers, appended after the rendered specs so sheet order is preserved (matrix → AI → Notes).

- [ ] **Step 1: Write failing orchestrator tests.** Assert sheet order (matrix first, named after the template), that the AI sheet appears only when toggled, that Notes is always last, and that a layout exceeding 16,384 columns raises a clear pre-build error (not an openpyxl mid-build crash).
  Create `backend/tests/unit/test_extraction_workbook_orchestrator.py`:
  ```python
  """Orchestrator: spec-order sheet assembly + the §5.5 column guard."""

  from __future__ import annotations

  import io
  from uuid import uuid4

  import pytest
  from openpyxl import load_workbook

  from app.models.extraction import ExtractionEntityRole, ExtractionFieldType
  from app.services.exports.extraction.workbook import build_workbook
  from app.services.extraction_export_service import (
      ArticleDescriptor,
      ExportLayout,
      ExportMode,
      ExportNotes,
      FieldDescriptor,
      SectionDescriptor,
  )


  def _one_field_layout(*, include_ai: bool, n_articles: int = 1) -> ExportLayout:
      sec_id = uuid4()
      field = FieldDescriptor(
          field_id=uuid4(),
          label="Source",
          type=ExtractionFieldType.TEXT,
          allowed_values=(),
          parent_section_id=sec_id,
      )
      section = SectionDescriptor(
          entity_type_id=sec_id,
          label="Source of data",
          role=ExtractionEntityRole.STUDY_SECTION,
          parent_entity_type_id=None,
          fields=(field,),
      )
      articles = tuple(
          ArticleDescriptor(
              article_id=uuid4(),
              header_label=f"Art {i}",
              run_id=uuid4(),
              run_stage=None,
              model_instances=(),
              study_instances={sec_id: uuid4()},
          )
          for i in range(n_articles)
      )
      return ExportLayout(
          project_name="P",
          template_name="My Template",
          template_version=1,
          sections=(section,),
          articles=articles,
          reviewers=(),
          mode=ExportMode.CONSENSUS,
          include_ai_metadata=include_ai,
          anonymize_reviewer_names=False,
          notes=ExportNotes(),
          value_map={},
      )


  def test_sheet_order_without_ai() -> None:
      data = build_workbook(_one_field_layout(include_ai=False))
      wb = load_workbook(io.BytesIO(data))
      assert wb.sheetnames == ["My Template", "Notes"]


  def test_sheet_order_with_ai() -> None:
      data = build_workbook(_one_field_layout(include_ai=True))
      wb = load_workbook(io.BytesIO(data))
      assert wb.sheetnames == ["My Template", "AI metadata", "Notes"]


  def test_column_guard_rejects_oversized_layout() -> None:
      # 16,385 articles × 1 reviewer-less column each blows past Excel's
      # 16,384-column ceiling once the 2 label cols are added.
      layout = _one_field_layout(include_ai=False, n_articles=16_385)
      with pytest.raises(ValueError, match="16384|column"):
          build_workbook(layout)
  ```
  Command (from `backend/`): `uv run pytest tests/unit/test_extraction_workbook_orchestrator.py -q`
  Expected: **FAIL** — `test_column_guard_rejects_oversized_layout` raises an openpyxl error or none, not a clean `ValueError`; order tests may pass or fail depending on the placeholder sheet title.

- [ ] **Step 2: Rewrite `workbook.py` as a spec-ordered renderer with the column guard.** Compute the matrix column count, assert ≤ 16,384 before building, render the matrix spec, then append the legacy AI/Notes sheets in order.
  Replace the body of `backend/app/services/exports/extraction/workbook.py`:
  ```python
  """Workbook orchestrator for extraction exports.

  Owns the PUBLIC ``build_workbook(layout) -> bytes`` signature. Assembles the
  workbook by calling each pure sub-builder in spec order (§4), rendering each
  non-None ``SheetSpec`` via the single ``_render_sheet_spec`` writer, after a
  pre-build column guard (§5.5). Sheets not yet migrated to a pure sub-builder
  (AI metadata, Notes) are appended via the legacy writers so order is stable.
  """

  from __future__ import annotations

  import io

  from openpyxl import Workbook

  from app.services.exports.extraction.matrix import build_matrix
  from app.services.exports.extraction.sheet_spec import SheetSpec, _render_sheet_spec
  from app.services.extraction_export_service import ExportLayout, ExportMode

  #: Excel's hard ceiling — XFD is column 16,384.
  _EXCEL_MAX_COLUMNS = 16_384


  def _matrix_column_count(layout: ExportLayout) -> int:
      """Worst-case matrix width = 2 label cols + per-record sub-columns."""
      if not layout.articles:
          return 1
      reviewer_slots = 1
      if layout.mode is ExportMode.ALL_USERS:
          reviewer_slots = 1 + len(layout.reviewers)
      data_cols = 0
      for article in layout.articles:
          models = max(1, len(article.model_instances))
          data_cols += models * reviewer_slots
      return 2 + data_cols


  def _assert_within_column_limit(layout: ExportLayout) -> None:
      cols = _matrix_column_count(layout)
      if cols > _EXCEL_MAX_COLUMNS:
          raise ValueError(
              f"Export layout requires {cols} columns, exceeding Excel's "
              f"{_EXCEL_MAX_COLUMNS}-column limit. Narrow the export (fewer "
              "articles, models, or reviewers) or split it."
          )


  def build_workbook(layout: ExportLayout) -> bytes:
      """Build the export workbook bytes for the given layout."""
      from app.services.exports.extraction_xlsx_builder import (
          _write_ai_metadata_sheet,
          _write_notes_sheet,
      )

      _assert_within_column_limit(layout)

      wb = Workbook()
      default = wb.active
      if default is not None:
          wb.remove(default)

      # Ordered pure sub-builders (each -> SheetSpec | None). Only the matrix
      # is migrated in this slice; tidy tables / summary / front-matter / etc.
      # land in later slices and slot into this list in spec order.
      specs: list[SheetSpec | None] = [build_matrix(layout)]
      for spec in specs:
          if spec is None:
              continue
          ws = wb.create_sheet(title=spec.title)
          _render_sheet_spec(ws, spec)

      # Legacy sheets (not yet migrated) appended after the rendered specs.
      if layout.include_ai_metadata:
          _write_ai_metadata_sheet(wb, layout)
      _write_notes_sheet(wb, layout)

      buf = io.BytesIO()
      wb.save(buf)
      return buf.getvalue()


  __all__ = ["build_workbook"]
  ```

- [ ] **Step 3: Run the orchestrator tests — expect PASS.**
  Command (from `backend/`): `uv run pytest tests/unit/test_extraction_workbook_orchestrator.py -q`
  Expected: **PASS** (3 passed).

- [ ] **Step 4: Re-run the full green-gate + new suites.**
  Command (from `backend/`): `uv run pytest tests/unit/test_extraction_xlsx_builder.py tests/unit/test_extraction_export_determinism.py tests/unit/test_extraction_matrix_builder.py tests/unit/test_extraction_workbook_orchestrator.py tests/unit/test_extraction_workbook_package.py tests/unit/test_sheet_spec.py -q`
  Expected: **PASS** across all. (The determinism test's structural-equality assertion still holds: identical layouts → identical sheet structure incl. the new freeze/tab.)

- [ ] **Step 5: Endpoint + worker smoke.** The public signature is unchanged, but run the endpoint/worker-facing tests to prove the import path still resolves and produces bytes.
  Command (from `backend/`): `uv run pytest tests/unit/test_extraction_export_endpoint.py -q`
  Expected: **PASS** (the endpoint imports `build_workbook` from the legacy path → orchestrator).

- [ ] **Step 6: Lint + commit.**
  Commands (from `backend/`): `uv run ruff check app/services/exports/extraction/workbook.py tests/unit/test_extraction_workbook_orchestrator.py && uv run ruff format app/services/exports/extraction/workbook.py tests/unit/test_extraction_workbook_orchestrator.py`
  Commit:
  ```
  feat(backend): orchestrate export sheets from ordered SheetSpecs + column guard

  build_workbook now assembles sheets in spec order from pure sub-builders
  (matrix migrated; AI/Notes still legacy) and runs the §5.5 pre-build
  16,384-column guard, raising a clear ValueError instead of an openpyxl
  mid-build crash.

  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
  ```

---

### Task 42: Extend the determinism test to the restyled multi-sheet workbook

**Files:**
- Modify `backend/tests/unit/test_extraction_export_determinism.py`

> The determinism guarantee must cover the new structural styling (freeze, tab colour, banded fills are layout-deterministic) and the column-guard boundary. No production code changes — this is a test-coverage extension proving the split preserved byte-structural determinism.

- [ ] **Step 1: Add a failing determinism assertion for the styled matrix + a guard-boundary case.** Extend the existing module with (a) a check that two builds of a styled multi-section layout are structurally identical except doc-props/generated_at, and (b) that a layout exactly at the 16,384-column boundary builds while one over it raises.
  Append to `backend/tests/unit/test_extraction_export_determinism.py`:
  ```python
  def test_styled_matrix_is_structurally_deterministic() -> None:
      layout = _fixed_layout()
      a = build_workbook(layout)
      b = build_workbook(layout)

      def _entries(data: bytes) -> dict[str, bytes]:
          with zipfile.ZipFile(io.BytesIO(data)) as zf:
              return {
                  n: zf.read(n)
                  for n in zf.namelist()
                  if not n.startswith("docProps/")
              }

      ea, eb = _entries(a), _entries(b)
      assert ea.keys() == eb.keys()
      for name in ea:
          # The Notes sheet carries generated_at; every other part (incl. the
          # styled matrix sheet + styles.xml) must be byte-identical.
          if "notes" in name.lower() or name.endswith("sharedStrings.xml"):
              continue
          assert ea[name] == eb[name], f"non-deterministic part: {name}"


  def test_column_guard_boundary() -> None:
      import pytest

      from app.services.exports.extraction.workbook import _matrix_column_count

      # Build a layout whose matrix is exactly at the limit, and one over it.
      def _n_article_layout(n: int) -> ExportLayout:
          sec_id = uuid4()
          field = FieldDescriptor(
              field_id=uuid4(),
              label="F",
              type=ExtractionFieldType.TEXT,
              allowed_values=(),
              parent_section_id=sec_id,
          )
          section = SectionDescriptor(
              entity_type_id=sec_id,
              label="S",
              role=ExtractionEntityRole.STUDY_SECTION,
              parent_entity_type_id=None,
              fields=(field,),
          )
          articles = tuple(
              ArticleDescriptor(
                  article_id=uuid4(),
                  header_label=f"a{i}",
                  run_id=uuid4(),
                  run_stage=None,
                  model_instances=(),
                  study_instances={sec_id: uuid4()},
              )
              for i in range(n)
          )
          return ExportLayout(
              project_name="P",
              template_name="T",
              template_version=1,
              sections=(section,),
              articles=articles,
              reviewers=(),
              mode=ExportMode.CONSENSUS,
              include_ai_metadata=False,
              anonymize_reviewer_names=False,
              notes=ExportNotes(),
              value_map={},
          )

      at_limit = _n_article_layout(16_382)  # 2 + 16382 = 16384
      assert _matrix_column_count(at_limit) == 16_384
      build_workbook(at_limit)  # must not raise

      with pytest.raises(ValueError):
          build_workbook(_n_article_layout(16_383))
  ```
  (Ensure the module's existing imports include `uuid4`, `FieldDescriptor`, `SectionDescriptor`, `ArticleDescriptor`, `ExportMode`, `ExportNotes`, `ExportLayout` — add any missing to the top-level import block.)
  Command (from `backend/`): `uv run pytest tests/unit/test_extraction_export_determinism.py -q`
  Expected: initially **FAIL** if `sharedStrings.xml`/styles ordering differs, or **PASS** if already deterministic — the boundary test is the real new gate; it must pass once `_matrix_column_count` math is correct.

- [ ] **Step 2: If the structural-determinism assertion flags a part, narrow the comparison.** openpyxl orders shared strings/styles deterministically for identical inputs; if a part legitimately varies (e.g. an embedded creation revision id outside `docProps/`), add it to the skip set in `_entries` with a one-line comment, never weaken the matrix-sheet comparison. Re-run until **PASS**.
  Command (from `backend/`): `uv run pytest tests/unit/test_extraction_export_determinism.py -q`
  Expected: **PASS**.

- [ ] **Step 3: Lint + commit.**
  Commands (from `backend/`): `uv run ruff check tests/unit/test_extraction_export_determinism.py && uv run ruff format tests/unit/test_extraction_export_determinism.py`
  Commit:
  ```
  test(backend): extend export determinism to styled matrix + column guard

  Cover structural determinism of the restyled multi-sheet workbook (freeze,
  tab colour, banded fills are layout-deterministic) and the exact 16,384
  column-guard boundary via _matrix_column_count.

  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
  ```

---

### Task 43: Final slice gate — full export suite + fitness + endpoint/worker green

**Files:**
- No production changes (verification + any test reconciliation surfaced here)

- [ ] **Step 1: Run the whole export-related unit suite.**
  Command (from `backend/`):
  `uv run pytest tests/unit/test_extraction_xlsx_builder.py tests/unit/test_extraction_export_determinism.py tests/unit/test_extraction_matrix_builder.py tests/unit/test_extraction_workbook_orchestrator.py tests/unit/test_extraction_workbook_package.py tests/unit/test_sheet_spec.py tests/unit/test_extraction_export_endpoint.py tests/unit/test_extraction_export_service.py tests/unit/test_extraction_export_schemas.py -q`
  Expected: **PASS** (all green; count = Step-1 baseline of the first task + the new tests added across this slice).

- [ ] **Step 2: Run the layering fitness function.**
  Command (from `backend/`): `uv run python ../scripts/fitness/check_layered_arch.py`
  Expected: **exit 0** — `app/services/exports/extraction/` imports only `app.models.*`, `app.services.*`, and cross-cutting; no `api`/`repositories` edges, no new baseline entries.

- [ ] **Step 3: Lint + format the full new package.**
  Command (from `backend/`): `uv run ruff check app/services/exports/extraction/ && uv run ruff format --check app/services/exports/extraction/`
  Expected: **All checks passed**, **already formatted**.

- [ ] **Step 4: Confirm the public import contract is intact (no caller changes needed).** Grep proves the endpoint + worker still import from the unchanged path and resolve to the orchestrator.
  Command (from repo root): `grep -rn "from app.services.exports.extraction_xlsx_builder import build_workbook" backend/app/`
  Expected: still two hits (`extraction_export.py:40`, `extraction_export_tasks.py:62`), both resolving via the re-export shim to `workbook.build_workbook`. No edits to endpoint/worker.

- [ ] **Step 5: No commit (verification-only task).** If any test required reconciliation, it was committed under the owning task above. State the final green summary as the slice exit criterion: package created, matrix lifted + restyled structural-only, orchestrator renders ordered `SheetSpec`s with the column guard, legacy `build_workbook` re-exports the orchestrator, endpoint/worker/tests untouched.

---

**Slice notes for the synthesizer (not tasks):**
- This slice deliberately keeps `_write_ai_metadata_sheet` + `_write_notes_sheet` (and their `_xlsx_safe` with the `str(dict)` fallback) **alive in the legacy module**; their migration to `ai_metadata.py` / `front_matter.py` and the legacy-module **deletion** belong to the later sub-builder slices (per the file-structure contract). The orchestrator already appends them in spec order so the eventual swap is a one-line list edit.
- The `ExportLayout`/`SectionDescriptor.cardinality`/`ArticleDescriptor.section_instances` growth and the `study_instances → section_instances` rename are owned by the earlier correctness slices (phasing #1–#2). This slice's `matrix.py` uses whatever descriptor shape is current at synthesis time; if `study_instances` has already been renamed, the two `article.study_instances.get(...)` sites in `_resolve_instance_id` become an iteration over `article.section_instances[entity_type_id]` (1-tuple for cardinality=one) — flag this as the single merge-point the synthesizer must reconcile across slices.
- The `SheetSpec` IR + `_render_sheet_spec` and the column guard are introduced here because the matrix is the first sheet; later slices (tidy tables, summary, front-matter, appraisal, data dictionary, AI metadata) only add `build_<sheet>` functions and slot their `SheetSpec | None` into the orchestrator's ordered `specs` list.


---

## Phase S6 — New sheets: front-matter, summary, data dictionary, dropdown lists, tidy tables

### Task 44: Decide tidy-table record grain + section-instance read contract (read + decision)

**Files:**
- Read: `backend/app/services/extraction_export_service.py` (`_resolve_articles_for_consensus` @477, `ArticleDescriptor` @99, `_load_ai_proposal_rows` @1140)
- Read: `docs/superpowers/specs/2026-06-14-publication-ready-xlsx-export-design.md` (§4 #2, §5.2, §5.3)
- Decision: no file output — record decisions inline in the next tasks' code.

- [ ] **Step 1: Confirm the cardinality fan-out key and record grain.** Per §5.2 the fan-out key is `SectionDescriptor.cardinality == ExtractionCardinality.MANY` for **any** role, never a `role==MODEL_SECTION` allow-list. Confirm with `grep -n "cardinality" backend/app/services/extraction_export_service.py` that `SectionDescriptor` now carries `cardinality` (added by the descriptors slice). Decision A: `build_tidy_tables` emits **one row per article** for a `cardinality==ONE` section and **one row per (article × instance)** for a `cardinality==MANY` section, reading instances from `ArticleDescriptor.section_instances[section.entity_type_id]` (the ordered tuple that replaced the `study_instances` dict collapse).
- [ ] **Step 2: Confirm the Summary record grain.** Per §4 #2 the Summary sheet is "one row per record (article, or article × model when a `MODEL_CONTAINER` exists)". Decision B: `build_summary` emits one row per article when no section has `role == MODEL_CONTAINER`; when a `MODEL_CONTAINER` exists, it fans out one row per (article × model instance) using `ArticleDescriptor.model_instances`. Completeness = `filled_fields / total_fields` over every (section, instance, field) coordinate in scope for that record, where "filled" means a non-`None` resolved value in `value_map`.
- [ ] **Step 3: Confirm the data-dictionary / dropdown read source.** Per §4 #k+2 and §5.1 the dictionary is built from the **snapshot** field metadata (`FieldDescriptor.description/unit/is_required/allow_other` + `allowed_values`), surfaced onto `ExportLayout.data_dictionary` as a tuple of `FieldDictEntry`. Decision C: `build_data_dictionary(layout)` reads `layout.data_dictionary`; `build_dropdown_lists(layout)` projects only the `FieldDictEntry` rows whose `allowed_values` is non-empty (returns `None` when none carry allowed values). Both are pure sub-builders consuming already-resolved `ExportLayout` projections — they do not touch the snapshot reader directly.
- [ ] **Step 4: Confirm front-matter content source.** Per §4 #1 the README/Methods sheet absorbs the old `Notes` content. Decision D: `build_front_matter(layout)` reads `layout.front_matter` (a `FrontMatter` instance, built service-side in `resolve_layout`); it renders template name+version, project, mode label, `generated_at`, article/record counts, the generated `contents` list, the glyph/sentinel `legend`, `caveats`, and the `obsolete_fields_per_article` block. No git commit (decision-only task).

### Task 45: Front-matter sub-builder (`front_matter.py`)

**Files:**
- Create: `backend/app/services/exports/extraction/front_matter.py`
- Test: `backend/tests/unit/test_extraction_front_matter_builder.py`

Assumes (owned by sibling slices): `SheetSpec`/`Cell`/`CellStyle` in `app.services.exports.extraction.sheet_spec`; `FrontMatter` dataclass + `ExportLayout.front_matter` field in `extraction_export_service`.

- [ ] **Step 1: Write the failing test.** Create the test file. It builds a `FrontMatter` + minimal `ExportLayout` and asserts the spec rows.

```python
"""Unit tests for the README/Methods (front-matter) sub-builder. Pure — no DB."""

from __future__ import annotations

from datetime import UTC, datetime
from uuid import uuid4

from app.services.exports.extraction.front_matter import build_front_matter
from app.services.extraction_export_service import (
    ExportLayout,
    ExportMode,
    ExportNotes,
    FrontMatter,
)


def _layout_with_front_matter(fm: FrontMatter) -> ExportLayout:
    return ExportLayout(
        project_name=fm.project_name,
        template_name=fm.template_name,
        template_version=fm.template_version,
        sections=(),
        articles=(),
        reviewers=(),
        mode=ExportMode.CONSENSUS,
        include_ai_metadata=False,
        anonymize_reviewer_names=False,
        notes=ExportNotes(),
        value_map={},
        front_matter=fm,
    )


def _front_matter() -> FrontMatter:
    return FrontMatter(
        project_name="My SR Project",
        template_name="CHARMS",
        template_version=3,
        export_mode_label="Consensus",
        generated_at=datetime(2026, 6, 14, 9, 30, 0, tzinfo=UTC),
        article_count=12,
        record_count=20,
        contents=("README / Methods", "Summary", "CHARMS", "Study characteristics"),
        legend=(("(blank)", "No value / rejected"), ("No information", "Reported as not stated")),
        caveats=("Reviewer outcomes labelled best-effort rely on heuristics.",),
        obsolete_fields_per_article={},
    )


def _flat(spec) -> str:
    return " \n ".join(
        " | ".join("" if c.value is None else str(c.value) for c in row) for row in spec.rows
    )


def test_front_matter_renders_identity_block():
    spec = build_front_matter(_layout_with_front_matter(_front_matter()))
    flat = _flat(spec)
    assert spec.title == "README"
    assert "My SR Project" in flat
    assert "CHARMS" in flat
    assert "v3" in flat
    assert "Consensus" in flat
    assert "2026-06-14" in flat
    assert "12" in flat  # article count
    assert "20" in flat  # record count


def test_front_matter_lists_contents_and_legend():
    spec = build_front_matter(_layout_with_front_matter(_front_matter()))
    flat = _flat(spec)
    assert "Summary" in flat
    assert "Study characteristics" in flat
    assert "No information" in flat
    assert "Reported as not stated" in flat
    assert "best-effort" in flat.lower()


def test_front_matter_renders_obsolete_fields_block():
    aid = uuid4()
    fm = _front_matter()
    fm = FrontMatter(
        project_name=fm.project_name,
        template_name=fm.template_name,
        template_version=fm.template_version,
        export_mode_label=fm.export_mode_label,
        generated_at=fm.generated_at,
        article_count=fm.article_count,
        record_count=fm.record_count,
        contents=fm.contents,
        legend=fm.legend,
        caveats=fm.caveats,
        obsolete_fields_per_article={aid: ("Old field A", "Old field B")},
    )
    spec = build_front_matter(_layout_with_front_matter(fm))
    flat = _flat(spec)
    assert "Old field A" in flat
    assert "Old field B" in flat
    assert str(aid) in flat


def test_front_matter_handles_missing_front_matter_gracefully():
    layout = ExportLayout(
        project_name="P",
        template_name="T",
        template_version=1,
        sections=(),
        articles=(),
        reviewers=(),
        mode=ExportMode.CONSENSUS,
        include_ai_metadata=False,
        anonymize_reviewer_names=False,
        notes=ExportNotes(),
        value_map={},
        front_matter=None,
    )
    spec = build_front_matter(layout)
    # Falls back to layout fields; never raises.
    assert "T" in _flat(spec)
```

- [ ] **Step 2: Run it — expect FAIL (ModuleNotFoundError).** From `backend/`: `uv run pytest tests/unit/test_extraction_front_matter_builder.py -q`. Expected: collection error — `front_matter.py` does not exist.
- [ ] **Step 3: Implement `front_matter.py` (complete).**

```python
"""README / Methods (front-matter) sub-builder.

Pure: consumes an ``ExportLayout`` and returns a ``SheetSpec``. Absorbs the
old Notes sheet — template identity, export provenance, a generated contents
list, a glyph/sentinel legend, caveats, and the per-Run obsolete-field block
(§4 #1, §5.1).
"""

from __future__ import annotations

from app.services.exports.extraction.sheet_spec import Cell, CellStyle, SheetSpec
from app.services.extraction_export_service import ExportLayout

_TITLE = CellStyle(bold=True)


def _kv(label: str, value: object) -> tuple[Cell, ...]:
    return (Cell(label, _TITLE), Cell("" if value is None else str(value)))


def build_front_matter(layout: ExportLayout) -> SheetSpec:
    fm = layout.front_matter
    rows: list[tuple[Cell, ...]] = []

    rows.append((Cell("README / Methods", _TITLE),))
    rows.append(())

    project_name = fm.project_name if fm else layout.project_name
    template_name = fm.template_name if fm else layout.template_name
    template_version = fm.template_version if fm else layout.template_version
    mode_label = fm.export_mode_label if fm else layout.mode.value
    generated = fm.generated_at if fm else None

    rows.append(_kv("Project", project_name))
    rows.append(_kv("Template", f"{template_name} (v{template_version})"))
    rows.append(_kv("Export mode", mode_label))
    rows.append(
        _kv("Generated at", generated.isoformat() if generated is not None else "")
    )
    if fm is not None:
        rows.append(_kv("Articles", fm.article_count))
        rows.append(_kv("Records", fm.record_count))

    if fm is not None and fm.contents:
        rows.append(())
        rows.append((Cell("Contents", _TITLE),))
        for sheet_name in fm.contents:
            rows.append((Cell(""), Cell(sheet_name)))

    if fm is not None and fm.legend:
        rows.append(())
        rows.append((Cell("Legend", _TITLE),))
        for glyph, meaning in fm.legend:
            rows.append((Cell(glyph, _TITLE), Cell(meaning)))

    if fm is not None and fm.caveats:
        rows.append(())
        rows.append((Cell("Notes", _TITLE),))
        for caveat in fm.caveats:
            rows.append((Cell(""), Cell(caveat, CellStyle(wrap=True))))

    if fm is not None and fm.obsolete_fields_per_article:
        rows.append(())
        rows.append((Cell("Fields removed from active template (per Run)", _TITLE),))
        for article_id, labels in fm.obsolete_fields_per_article.items():
            rows.append((Cell(str(article_id)), Cell("; ".join(labels))))

    return SheetSpec(
        title="README",
        rows=tuple(rows),
        column_widths=(36.0, 90.0),
        tab_color="1F4E78",
    )
```

- [ ] **Step 4: Run it — expect PASS.** From `backend/`: `uv run pytest tests/unit/test_extraction_front_matter_builder.py -q`. Then `uv run ruff check app/services/exports/extraction/front_matter.py tests/unit/test_extraction_front_matter_builder.py` and `uv run ruff format app/services/exports/extraction/front_matter.py tests/unit/test_extraction_front_matter_builder.py`.
- [ ] **Step 5: Commit.**

```
git add backend/app/services/exports/extraction/front_matter.py backend/tests/unit/test_extraction_front_matter_builder.py
git commit -m "feat(export): add README/Methods front-matter sub-builder

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

### Task 46: Data-dictionary sub-builder (`data_dictionary.py`)

**Files:**
- Create: `backend/app/services/exports/extraction/data_dictionary.py`
- Test: `backend/tests/unit/test_extraction_data_dictionary_builder.py`

Assumes: `SheetSpec`/`Cell`/`CellStyle`; `FieldDictEntry` + `AllowedValue` + `ExportLayout.data_dictionary` field.

- [ ] **Step 1: Write the failing test.**

```python
"""Unit tests for the Data dictionary sub-builder. Pure — no DB."""

from __future__ import annotations

from uuid import uuid4

from app.models.extraction import ExtractionFieldType
from app.services.exports.extraction.data_dictionary import build_data_dictionary
from app.services.extraction_export_service import (
    AllowedValue,
    ExportLayout,
    ExportMode,
    ExportNotes,
    FieldDictEntry,
)


def _layout(entries: tuple[FieldDictEntry, ...]) -> ExportLayout:
    return ExportLayout(
        project_name="P",
        template_name="CHARMS",
        template_version=1,
        sections=(),
        articles=(),
        reviewers=(),
        mode=ExportMode.CONSENSUS,
        include_ai_metadata=False,
        anonymize_reviewer_names=False,
        notes=ExportNotes(),
        value_map={},
        data_dictionary=entries,
    )


def _entries() -> tuple[FieldDictEntry, ...]:
    return (
        FieldDictEntry(
            field_id=uuid4(),
            section_label="1. Source of data",
            label="Source of data",
            type=ExtractionFieldType.SELECT,
            unit=None,
            description="Where the data came from",
            allowed_values=(
                AllowedValue(value="Cohort", label="Cohort"),
                AllowedValue(value="RCT", label="RCT"),
            ),
            is_required=True,
            allow_other=True,
        ),
        FieldDictEntry(
            field_id=uuid4(),
            section_label="3. Sample size",
            label="Number of participants",
            type=ExtractionFieldType.NUMBER,
            unit="patients",
            description="Total enrolled",
            allowed_values=(),
            is_required=False,
            allow_other=False,
        ),
    )


def _header(spec) -> list[str]:
    return ["" if c.value is None else str(c.value) for c in spec.rows[0]]


def _flat(spec) -> str:
    return " \n ".join(
        " | ".join("" if c.value is None else str(c.value) for c in row) for row in spec.rows
    )


def test_data_dictionary_header_columns():
    spec = build_data_dictionary(_layout(_entries()))
    assert spec.title == "Data dictionary"
    header = _header(spec)
    for col in (
        "Section",
        "Field",
        "Type",
        "Unit",
        "Description",
        "Allowed values",
        "Required",
        "Allow other",
    ):
        assert col in header


def test_data_dictionary_renders_one_row_per_field():
    spec = build_data_dictionary(_layout(_entries()))
    flat = _flat(spec)
    assert "Source of data" in flat
    assert "Number of participants" in flat
    # select options surfaced
    assert "Cohort" in flat
    assert "RCT" in flat
    # unit + required + allow_other rendered
    assert "patients" in flat
    assert "Yes" in flat  # is_required True / allow_other True
    assert "No" in flat   # is_required False / allow_other False


def test_data_dictionary_empty_entries_is_header_only():
    spec = build_data_dictionary(_layout(()))
    assert len(spec.rows) == 1  # header only
```

- [ ] **Step 2: Run it — expect FAIL.** `uv run pytest tests/unit/test_extraction_data_dictionary_builder.py -q` from `backend/`. Expected: ModuleNotFoundError.
- [ ] **Step 3: Implement `data_dictionary.py` (complete).**

```python
"""Data dictionary sub-builder.

One row per field with its full metadata (§4 #k+2). Doubles as the catalogue
the Dropdown lists sheet narrows. Pure: consumes ``ExportLayout.data_dictionary``.
"""

from __future__ import annotations

from app.services.exports.extraction.sheet_spec import Cell, CellStyle, SheetSpec
from app.services.extraction_export_service import FieldDictEntry, ExportLayout

_HEADER = CellStyle(bold=True, fill="EEEEEE")

_HEADERS = (
    "Section",
    "Field",
    "Type",
    "Unit",
    "Description",
    "Allowed values",
    "Required",
    "Allow other",
)


def _allowed_values_text(entry: FieldDictEntry) -> str:
    return "; ".join(
        av.label if av.label == av.value else f"{av.value} ({av.label})"
        for av in entry.allowed_values
    )


def _yes_no(flag: bool) -> str:
    return "Yes" if flag else "No"


def build_data_dictionary(layout: ExportLayout) -> SheetSpec:
    rows: list[tuple[Cell, ...]] = [tuple(Cell(h, _HEADER) for h in _HEADERS)]
    for entry in layout.data_dictionary:
        rows.append(
            (
                Cell(entry.section_label),
                Cell(entry.label),
                Cell(entry.type.value),
                Cell(entry.unit or ""),
                Cell(entry.description or "", CellStyle(wrap=True)),
                Cell(_allowed_values_text(entry), CellStyle(wrap=True)),
                Cell(_yes_no(entry.is_required)),
                Cell(_yes_no(entry.allow_other)),
            )
        )
    return SheetSpec(
        title="Data dictionary",
        rows=tuple(rows),
        column_widths=(24.0, 30.0, 12.0, 14.0, 48.0, 40.0, 10.0, 12.0),
        freeze="A2",
        tab_color="7F7F7F",
    )
```

- [ ] **Step 4: Run it — expect PASS.** `uv run pytest tests/unit/test_extraction_data_dictionary_builder.py -q`, then `uv run ruff check` + `uv run ruff format` on both files.
- [ ] **Step 5: Commit.**

```
git add backend/app/services/exports/extraction/data_dictionary.py backend/tests/unit/test_extraction_data_dictionary_builder.py
git commit -m "feat(export): add data dictionary sub-builder

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

### Task 47: Dropdown-lists sub-builder (`dropdown_lists.py`)

**Files:**
- Create: `backend/app/services/exports/extraction/dropdown_lists.py`
- Test: `backend/tests/unit/test_extraction_dropdown_lists_builder.py`

Assumes: `SheetSpec`/`Cell`/`CellStyle`; `FieldDictEntry`/`AllowedValue`/`ExportLayout.data_dictionary`.

- [ ] **Step 1: Write the failing test.** One column per select/multiselect field that carries `allowed_values`; header = field label; cells = the option labels down the column.

```python
"""Unit tests for the Dropdown lists sub-builder. Pure — no DB."""

from __future__ import annotations

from uuid import uuid4

from app.models.extraction import ExtractionFieldType
from app.services.exports.extraction.dropdown_lists import build_dropdown_lists
from app.services.extraction_export_service import (
    AllowedValue,
    ExportLayout,
    ExportMode,
    ExportNotes,
    FieldDictEntry,
)


def _layout(entries: tuple[FieldDictEntry, ...]) -> ExportLayout:
    return ExportLayout(
        project_name="P",
        template_name="CHARMS",
        template_version=1,
        sections=(),
        articles=(),
        reviewers=(),
        mode=ExportMode.CONSENSUS,
        include_ai_metadata=False,
        anonymize_reviewer_names=False,
        notes=ExportNotes(),
        value_map={},
        data_dictionary=entries,
    )


def _entry(label, type_, values) -> FieldDictEntry:
    return FieldDictEntry(
        field_id=uuid4(),
        section_label="S",
        label=label,
        type=type_,
        unit=None,
        description=None,
        allowed_values=tuple(AllowedValue(value=v, label=v) for v in values),
        is_required=False,
        allow_other=False,
    )


def test_dropdown_lists_one_column_per_select_field():
    entries = (
        _entry("Study design", ExtractionFieldType.SELECT, ["Cohort", "RCT", "Case-control"]),
        _entry("Outcomes", ExtractionFieldType.MULTISELECT, ["Mortality", "MI"]),
        # a non-select field with no allowed_values must NOT appear:
        _entry("Free text", ExtractionFieldType.TEXT, []),
    )
    spec = build_dropdown_lists(_layout(entries))
    assert spec is not None
    header = [c.value for c in spec.rows[0]]
    assert header == ["Study design", "Outcomes"]
    # column 0 values down the rows
    col0 = [spec.rows[r][0].value for r in range(1, len(spec.rows))]
    assert col0[:3] == ["Cohort", "RCT", "Case-control"]
    # column 1 shorter — padded with blank below its options
    assert spec.rows[1][1].value == "Mortality"
    assert spec.rows[2][1].value == "MI"
    assert spec.rows[3][1].value is None


def test_dropdown_lists_returns_none_when_no_allowed_values():
    entries = (_entry("Free text", ExtractionFieldType.TEXT, []),)
    assert build_dropdown_lists(_layout(entries)) is None
```

- [ ] **Step 2: Run it — expect FAIL.** `uv run pytest tests/unit/test_extraction_dropdown_lists_builder.py -q`. Expected: ModuleNotFoundError.
- [ ] **Step 3: Implement `dropdown_lists.py` (complete).**

```python
"""Dropdown lists sub-builder.

One column per field carrying ``allowed_values`` (select / multiselect);
header = field label, cells = the option labels down the column. Returns
``None`` when no field in the dictionary carries allowed values (§4 #k+2).
Pure: consumes ``ExportLayout.data_dictionary``.
"""

from __future__ import annotations

from app.services.exports.extraction.sheet_spec import Cell, CellStyle, SheetSpec
from app.services.extraction_export_service import ExportLayout

_HEADER = CellStyle(bold=True, fill="EEEEEE")


def build_dropdown_lists(layout: ExportLayout) -> SheetSpec | None:
    columns = [e for e in layout.data_dictionary if e.allowed_values]
    if not columns:
        return None

    header = tuple(Cell(e.label, _HEADER) for e in columns)
    max_options = max(len(e.allowed_values) for e in columns)

    body: list[tuple[Cell, ...]] = []
    for row_idx in range(max_options):
        row: list[Cell] = []
        for entry in columns:
            if row_idx < len(entry.allowed_values):
                row.append(Cell(entry.allowed_values[row_idx].label))
            else:
                row.append(Cell(None))
        body.append(tuple(row))

    return SheetSpec(
        title="Dropdown lists",
        rows=(header, *body),
        column_widths=tuple(24.0 for _ in columns),
        freeze="A2",
        tab_color="7F7F7F",
    )
```

- [ ] **Step 4: Run it — expect PASS.** `uv run pytest tests/unit/test_extraction_dropdown_lists_builder.py -q`, then `uv run ruff check` + `uv run ruff format` on both files.
- [ ] **Step 5: Commit.**

```
git add backend/app/services/exports/extraction/dropdown_lists.py backend/tests/unit/test_extraction_dropdown_lists_builder.py
git commit -m "feat(export): add dropdown lists sub-builder

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

### Task 48: Summary sub-builder (`summary.py`)

**Files:**
- Create: `backend/app/services/exports/extraction/summary.py`
- Test: `backend/tests/unit/test_extraction_summary_builder.py`

Assumes: `SheetSpec`/`Cell`/`CellStyle`; grown `ArticleDescriptor` (`section_instances: dict[UUID, tuple[UUID, ...]]`, `model_instances`); `SectionDescriptor.cardinality`; `ExportMode`. Summary derives completeness directly from `layout.value_map` + the consensus key shape `(run_id, instance_id, field_id)` (or 4-tuple `…, None` for all-users) — no new `ExportLayout` field needed.

- [ ] **Step 1: Write the failing test.** One row per record; identity columns + completeness fraction + omitted-by-stage from `layout.notes`.

```python
"""Unit tests for the Summary sub-builder. Pure — no DB."""

from __future__ import annotations

from uuid import uuid4

from app.models.extraction import (
    ExtractionCardinality,
    ExtractionEntityRole,
    ExtractionFieldType,
)
from app.services.exports.extraction.summary import build_summary
from app.services.extraction_export_service import (
    ArticleDescriptor,
    ExportLayout,
    ExportMode,
    ExportNotes,
    FieldDescriptor,
    SectionDescriptor,
)


def _field(parent):
    return FieldDescriptor(
        field_id=uuid4(),
        label="F",
        type=ExtractionFieldType.TEXT,
        allowed_values=(),
        parent_section_id=parent,
    )


def _study_section_two_fields():
    eid = uuid4()
    return SectionDescriptor(
        entity_type_id=eid,
        label="Study",
        role=ExtractionEntityRole.STUDY_SECTION,
        parent_entity_type_id=None,
        fields=(_field(eid), _field(eid)),
        cardinality=ExtractionCardinality.ONE,
        sort_order=0,
    )


def _layout(sections, articles, value_map, notes=None):
    return ExportLayout(
        project_name="P",
        template_name="CHARMS",
        template_version=1,
        sections=sections,
        articles=articles,
        reviewers=(),
        mode=ExportMode.CONSENSUS,
        include_ai_metadata=False,
        anonymize_reviewer_names=False,
        notes=notes or ExportNotes(),
        value_map=value_map,
    )


def _flat(spec) -> str:
    return " \n ".join(
        " | ".join("" if c.value is None else str(c.value) for c in row) for row in spec.rows
    )


def test_summary_one_row_per_article_with_completeness():
    section = _study_section_two_fields()
    inst = uuid4()
    run = uuid4()
    article = ArticleDescriptor(
        article_id=uuid4(),
        header_label="Gaca, 2011",
        run_id=run,
        run_stage=None,
        version_id=None,
        model_instances=(),
        section_instances={section.entity_type_id: (inst,)},
    )
    f0, f1 = section.fields
    # one of two fields filled → 50% completeness
    value_map = {(run, inst, f0.field_id): "filled"}
    spec = build_summary(_layout((section,), (article,), value_map))
    flat = _flat(spec)
    assert spec.title == "Summary"
    assert "Gaca, 2011" in flat
    # 1/2 fields present
    assert "1" in flat and "2" in flat


def test_summary_fans_out_per_model_when_model_container_present():
    study = _study_section_two_fields()
    container = SectionDescriptor(
        entity_type_id=uuid4(),
        label="Models",
        role=ExtractionEntityRole.MODEL_CONTAINER,
        parent_entity_type_id=None,
        fields=(),
        cardinality=ExtractionCardinality.MANY,
        sort_order=1,
    )
    run = uuid4()
    m_a, m_b = uuid4(), uuid4()
    article = ArticleDescriptor(
        article_id=uuid4(),
        header_label="Gaca, 2011",
        run_id=run,
        run_stage=None,
        version_id=None,
        model_instances=(m_a, m_b),
        section_instances={study.entity_type_id: (uuid4(),)},
    )
    spec = build_summary(_layout((study, container), (article,), {}))
    # 2 model rows (header excluded)
    body = [r for r in spec.rows[1:]]
    assert len(body) == 2


def test_summary_includes_omitted_by_stage():
    notes = ExportNotes(omitted_articles_by_stage={"review": 3, "no_run": 1})
    spec = build_summary(_layout((), (), {}, notes=notes))
    flat = _flat(spec)
    assert "review" in flat
    assert "3" in flat
```

- [ ] **Step 2: Run it — expect FAIL.** `uv run pytest tests/unit/test_extraction_summary_builder.py -q`. Expected: ModuleNotFoundError.
- [ ] **Step 3: Implement `summary.py` (complete).**

```python
"""Summary sub-builder.

One row per record (article, or article × model when a MODEL_CONTAINER exists),
with identity columns + per-record completeness + an omitted-by-stage tally
(§4 #2). Completeness is computed from the already-resolved ``value_map``: a
coordinate counts as "filled" when its resolved value is not None. Pure.
"""

from __future__ import annotations

from uuid import UUID

from app.models.extraction import ExtractionEntityRole
from app.services.exports.extraction.sheet_spec import Cell, CellStyle, SheetSpec
from app.services.extraction_export_service import (
    ArticleDescriptor,
    ExportLayout,
    ExportMode,
    SectionDescriptor,
)

_HEADER = CellStyle(bold=True, fill="EEEEEE")

_HEADERS = ("Record", "Model #", "Fields filled", "Fields total", "Completeness")


def _has_model_container(sections: tuple[SectionDescriptor, ...]) -> bool:
    return any(s.role is ExtractionEntityRole.MODEL_CONTAINER for s in sections)


def _consensus_value(layout: ExportLayout, run_id: UUID, instance_id: UUID, field_id: UUID):
    if layout.mode is ExportMode.ALL_USERS:
        return layout.value_map.get((run_id, instance_id, field_id, None))
    return layout.value_map.get((run_id, instance_id, field_id))


def _instance_for(article: ArticleDescriptor, section: SectionDescriptor, model_index: int | None):
    if section.role is ExtractionEntityRole.MODEL_SECTION:
        if model_index is None or model_index >= len(article.model_instances):
            return None
        return article.model_instances[model_index]
    # study / other sections — first instance for the entity type
    instances = article.section_instances.get(section.entity_type_id, ())
    return instances[0] if instances else None


def _completeness_for_record(
    layout: ExportLayout,
    article: ArticleDescriptor,
    model_index: int | None,
) -> tuple[int, int]:
    filled = 0
    total = 0
    if article.run_id is None:
        return 0, 0
    for section in layout.sections:
        if section.role is ExtractionEntityRole.MODEL_CONTAINER:
            continue
        # When fanning out by model, a model-section row belongs to one model;
        # study sections apply to every model row (their values repeat).
        instance_id = _instance_for(article, section, model_index)
        if instance_id is None:
            continue
        for field in section.fields:
            total += 1
            if _consensus_value(layout, article.run_id, instance_id, field.field_id) is not None:
                filled += 1
    return filled, total


def _record_rows(layout: ExportLayout, fan_out_models: bool) -> list[tuple[Cell, ...]]:
    rows: list[tuple[Cell, ...]] = []
    for article in layout.articles:
        model_iter: list[int | None]
        if fan_out_models and article.model_instances:
            model_iter = list(range(len(article.model_instances)))
        else:
            model_iter = [None]
        for model_index in model_iter:
            filled, total = _completeness_for_record(layout, article, model_index)
            pct = f"{(filled / total * 100):.0f}%" if total else ""
            rows.append(
                (
                    Cell(article.header_label),
                    Cell("" if model_index is None else model_index + 1),
                    Cell(filled),
                    Cell(total),
                    Cell(pct),
                )
            )
    return rows


def build_summary(layout: ExportLayout) -> SheetSpec:
    fan_out = _has_model_container(layout.sections)
    rows: list[tuple[Cell, ...]] = [tuple(Cell(h, _HEADER) for h in _HEADERS)]
    rows.extend(_record_rows(layout, fan_out))

    if layout.notes.omitted_articles_by_stage:
        rows.append(())
        rows.append((Cell("Articles omitted", _HEADER),))
        for stage, count in sorted(layout.notes.omitted_articles_by_stage.items()):
            rows.append((Cell(f"stage={stage}"), Cell(count)))

    return SheetSpec(
        title="Summary",
        rows=tuple(rows),
        column_widths=(36.0, 10.0, 14.0, 14.0, 14.0),
        freeze="A2",
        tab_color="2E75B6",
    )
```

- [ ] **Step 4: Run it — expect PASS.** `uv run pytest tests/unit/test_extraction_summary_builder.py -q`, then `uv run ruff check` + `uv run ruff format` on both files.
- [ ] **Step 5: Commit.**

```
git add backend/app/services/exports/extraction/summary.py backend/tests/unit/test_extraction_summary_builder.py
git commit -m "feat(export): add Summary sub-builder

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

### Task 49: Tidy-tables sub-builder (`tidy_tables.py`)

**Files:**
- Create: `backend/app/services/exports/extraction/tidy_tables.py`
- Test: `backend/tests/unit/test_extraction_tidy_tables_builder.py`

Assumes: `SheetSpec`/`Cell`/`CellStyle`; `TidyTable`/`TidyRow` dataclasses + `ExportLayout.tidy_tables` field (built service-side). This sub-builder is a **pure renderer** of the already-resolved `layout.tidy_tables` — one `SheetSpec` per `TidyTable`, values pre-baked.

- [ ] **Step 1: Write the failing test.** Records-as-rows: header = record-id column + each `column_labels`; one body row per `TidyRow` with `record_label` then `values` baked.

```python
"""Unit tests for the tidy-tables sub-builder. Pure — no DB."""

from __future__ import annotations

from uuid import uuid4

from app.models.extraction import ExtractionCardinality
from app.services.exports.extraction.tidy_tables import build_tidy_tables
from app.services.extraction_export_service import (
    ExportLayout,
    ExportMode,
    ExportNotes,
    TidyRow,
    TidyTable,
)


def _layout(tables: tuple[TidyTable, ...]) -> ExportLayout:
    return ExportLayout(
        project_name="P",
        template_name="CHARMS",
        template_version=1,
        sections=(),
        articles=(),
        reviewers=(),
        mode=ExportMode.CONSENSUS,
        include_ai_metadata=False,
        anonymize_reviewer_names=False,
        notes=ExportNotes(),
        value_map={},
        tidy_tables=tables,
    )


def _study_table() -> TidyTable:
    fid_a, fid_b = uuid4(), uuid4()
    return TidyTable(
        section_id=uuid4(),
        title="Study characteristics",
        cardinality=ExtractionCardinality.ONE,
        column_field_ids=(fid_a, fid_b),
        column_labels=("Author", "Year"),
        rows=(
            TidyRow(
                article_id=uuid4(),
                instance_id=None,
                record_label="Gaca, 2011",
                values=("Gaca", 2011),
            ),
            TidyRow(
                article_id=uuid4(),
                instance_id=None,
                record_label="De Feo, 2012",
                values=("De Feo", 2012),
            ),
        ),
    )


def _model_table() -> TidyTable:
    fid = uuid4()
    aid = uuid4()
    return TidyTable(
        section_id=uuid4(),
        title="Model characteristics",
        cardinality=ExtractionCardinality.MANY,
        column_field_ids=(fid,),
        column_labels=("Method",),
        rows=(
            TidyRow(article_id=aid, instance_id=uuid4(), record_label="Gaca, 2011 — Model 1",
                    values=("Logistic regression",)),
            TidyRow(article_id=aid, instance_id=uuid4(), record_label="Gaca, 2011 — Model 2",
                    values=("Cox model",)),
        ),
    )


def test_one_sheet_per_tidy_table():
    specs = build_tidy_tables(_layout((_study_table(), _model_table())))
    assert [s.title for s in specs] == ["Study characteristics", "Model characteristics"]


def test_tidy_table_header_is_record_plus_field_labels():
    spec = build_tidy_tables(_layout((_study_table(),)))[0]
    header = [c.value for c in spec.rows[0]]
    assert header == ["Record", "Author", "Year"]


def test_tidy_table_one_row_per_record_with_baked_values():
    spec = build_tidy_tables(_layout((_study_table(),)))[0]
    body = spec.rows[1:]
    assert [r[0].value for r in body] == ["Gaca, 2011", "De Feo, 2012"]
    assert body[0][1].value == "Gaca"
    assert body[0][2].value == 2011  # numeric preserved
    assert body[1][1].value == "De Feo"


def test_many_cardinality_records_each_instance():
    spec = build_tidy_tables(_layout((_model_table(),)))[0]
    body = spec.rows[1:]
    assert [r[0].value for r in body] == ["Gaca, 2011 — Model 1", "Gaca, 2011 — Model 2"]
    assert body[0][1].value == "Logistic regression"
    assert body[1][1].value == "Cox model"


def test_empty_tidy_tables_returns_empty_list():
    assert build_tidy_tables(_layout(())) == []
```

- [ ] **Step 2: Run it — expect FAIL.** `uv run pytest tests/unit/test_extraction_tidy_tables_builder.py -q`. Expected: ModuleNotFoundError.
- [ ] **Step 3: Implement `tidy_tables.py` (complete).**

```python
"""Tidy-tables sub-builder.

One records-as-rows sheet per template section, at the section's cardinality
grain (§5.3) — the publication "Table 1" sheets authors paste into a paper.
Pure renderer: the per-record rows + baked values live on
``ExportLayout.tidy_tables`` (a tuple of ``TidyTable``), built service-side.
"""

from __future__ import annotations

from app.services.exports.extraction.sheet_spec import Cell, CellStyle, SheetSpec
from app.services.extraction_export_service import ExportLayout, TidyTable

_HEADER = CellStyle(bold=True, fill="EEEEEE")
_RECORD_COL = "Record"
_SHEET_MAX_LEN = 31
_FORBIDDEN_SHEET_CHARS = set(r"[]:*?/\\")


def _safe_sheet_name(raw: str, *, fallback: str) -> str:
    cleaned = "".join(c for c in raw if c not in _FORBIDDEN_SHEET_CHARS).strip()
    cleaned = cleaned[:_SHEET_MAX_LEN]
    return cleaned or fallback


def _build_one(table: TidyTable, *, index: int) -> SheetSpec:
    header = (Cell(_RECORD_COL, _HEADER), *(Cell(lbl, _HEADER) for lbl in table.column_labels))
    body: list[tuple[Cell, ...]] = []
    for row in table.rows:
        cells = [Cell(row.record_label)]
        cells.extend(Cell(v) for v in row.values)
        body.append(tuple(cells))

    widths = (36.0, *(24.0 for _ in table.column_labels))
    return SheetSpec(
        title=_safe_sheet_name(table.title, fallback=f"Table {index + 1}"),
        rows=(header, *body),
        column_widths=widths,
        freeze="B2",
        tab_color="548235",
    )


def build_tidy_tables(layout: ExportLayout) -> list[SheetSpec]:
    return [_build_one(table, index=i) for i, table in enumerate(layout.tidy_tables)]
```

- [ ] **Step 4: Run it — expect PASS.** `uv run pytest tests/unit/test_extraction_tidy_tables_builder.py -q`, then `uv run ruff check` + `uv run ruff format` on both files.
- [ ] **Step 5: Commit.**

```
git add backend/app/services/exports/extraction/tidy_tables.py backend/tests/unit/test_extraction_tidy_tables_builder.py
git commit -m "feat(export): add per-section tidy-tables sub-builder

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

### Task 50: Wire the new sheets into `workbook.py` order

**Files:**
- Modify: `backend/app/services/exports/extraction/workbook.py` (the orchestrator owned by the builder-split slice; this task adds the new `build_*` calls in §4 order)
- Test: `backend/tests/unit/test_extraction_xlsx_builder.py` (the orchestrator sheet-order test, retargeted by the builder-split slice)

Assumes the builder-split slice has already created `workbook.py` with `build_workbook(layout) -> bytes`, `_render_sheet_spec`, and wired `build_front_matter`, `build_summary`, `build_matrix`, `build_appraisal_summary`, `build_ai_metadata`. This task inserts the five sheets this slice owns at their §4 positions: front-matter (#1), summary (#2), tidy tables (#4..k), data dictionary (#k+2), dropdown lists (co-located after the data dictionary).

- [ ] **Step 1: Write the failing sheet-order test.** Append to `test_extraction_xlsx_builder.py` a test asserting the full §4 order for a layout that exercises every sheet. (The helper `_layout` here is the orchestrator-level helper the builder-split slice rebuilt; this test extends it with `front_matter`, `data_dictionary`, `tidy_tables`.)

```python
def test_workbook_emits_sheets_in_section4_order():
    """README → Summary → matrix → tidy tables → Data dictionary → Dropdown lists."""
    from datetime import UTC, datetime
    from uuid import uuid4

    from app.models.extraction import (
        ExtractionCardinality,
        ExtractionEntityRole,
        ExtractionFieldType,
    )
    from app.services.exports.extraction.workbook import build_workbook
    from app.services.extraction_export_service import (
        AllowedValue,
        ArticleDescriptor,
        ExportLayout,
        ExportMode,
        ExportNotes,
        FieldDescriptor,
        FieldDictEntry,
        FrontMatter,
        SectionDescriptor,
        TidyRow,
        TidyTable,
    )

    eid = uuid4()
    fid = uuid4()
    section = SectionDescriptor(
        entity_type_id=eid,
        label="Study",
        role=ExtractionEntityRole.STUDY_SECTION,
        parent_entity_type_id=None,
        fields=(
            FieldDescriptor(
                field_id=fid,
                label="Design",
                type=ExtractionFieldType.SELECT,
                allowed_values=("Cohort", "RCT"),
                parent_section_id=eid,
            ),
        ),
        cardinality=ExtractionCardinality.ONE,
        sort_order=0,
    )
    inst = uuid4()
    run = uuid4()
    article = ArticleDescriptor(
        article_id=uuid4(),
        header_label="Gaca, 2011",
        run_id=run,
        run_stage=None,
        version_id=None,
        model_instances=(),
        section_instances={eid: (inst,)},
    )
    fm = FrontMatter(
        project_name="P",
        template_name="CHARMS",
        template_version=1,
        export_mode_label="Consensus",
        generated_at=datetime(2026, 6, 14, tzinfo=UTC),
        article_count=1,
        record_count=1,
        contents=("README", "Summary"),
        legend=(),
        caveats=(),
        obsolete_fields_per_article={},
    )
    dict_entry = FieldDictEntry(
        field_id=fid,
        section_label="Study",
        label="Design",
        type=ExtractionFieldType.SELECT,
        unit=None,
        description=None,
        allowed_values=(AllowedValue(value="Cohort", label="Cohort"),),
        is_required=False,
        allow_other=False,
    )
    tidy = TidyTable(
        section_id=eid,
        title="Study characteristics",
        cardinality=ExtractionCardinality.ONE,
        column_field_ids=(fid,),
        column_labels=("Design",),
        rows=(TidyRow(article_id=article.article_id, instance_id=None,
                      record_label="Gaca, 2011", values=("Cohort",)),),
    )
    layout = ExportLayout(
        project_name="P",
        template_name="CHARMS",
        template_version=1,
        sections=(section,),
        articles=(article,),
        reviewers=(),
        mode=ExportMode.CONSENSUS,
        include_ai_metadata=False,
        anonymize_reviewer_names=False,
        notes=ExportNotes(generated_at=datetime(2026, 6, 14, tzinfo=UTC)),
        value_map={(run, inst, fid): "Cohort"},
        front_matter=fm,
        data_dictionary=(dict_entry,),
        tidy_tables=(tidy,),
    )
    wb = load_workbook(io.BytesIO(build_workbook(layout)))
    assert wb.sheetnames == [
        "README",
        "Summary",
        "CHARMS",
        "Study characteristics",
        "Data dictionary",
        "Dropdown lists",
    ]
```

- [ ] **Step 2: Run it — expect FAIL.** `uv run pytest tests/unit/test_extraction_xlsx_builder.py::test_workbook_emits_sheets_in_section4_order -q`. Expected: AssertionError on `sheetnames` (the new sheets are not yet wired) or NameError on the new `build_*` calls in `workbook.py`.
- [ ] **Step 3: Wire the sheet order in `workbook.py`.** In the orchestrator body, render the new sheets at their §4 positions. Concrete change to `build_workbook` (insert into the existing render loop the builder-split slice created):

```python
from app.services.exports.extraction.front_matter import build_front_matter
from app.services.exports.extraction.summary import build_summary
from app.services.exports.extraction.tidy_tables import build_tidy_tables
from app.services.exports.extraction.data_dictionary import build_data_dictionary
from app.services.exports.extraction.dropdown_lists import build_dropdown_lists


def _ordered_specs(layout: ExportLayout) -> list[SheetSpec]:
    """Sheets in §4 order; None-returning conditional builders are skipped."""
    specs: list[SheetSpec] = [
        build_front_matter(layout),   # #1 README / Methods
        build_summary(layout),        # #2 Summary
        build_matrix(layout),         # #3 Extraction matrix
    ]
    specs.extend(build_tidy_tables(layout))            # #4..k tidy tables
    appraisal = build_appraisal_summary(layout)        # #k+1 (conditional)
    if appraisal is not None:
        specs.append(appraisal)
    specs.append(build_data_dictionary(layout))        # #k+2 Data dictionary
    dropdowns = build_dropdown_lists(layout)           # co-located catalogue
    if dropdowns is not None:
        specs.append(dropdowns)
    ai = build_ai_metadata(layout)                     # last (optional)
    if ai is not None:
        specs.append(ai)
    return specs
```

Then ensure `build_workbook` iterates `_ordered_specs(layout)`, calling `_render_sheet_spec(ws, spec)` per spec after de-duplicating sheet titles (the builder-split slice owns `_render_sheet_spec` and the dedup helper — this task only inserts the new `build_*` entries in order).

- [ ] **Step 4: Run it — expect PASS.** `uv run pytest tests/unit/test_extraction_xlsx_builder.py -q`, then `uv run ruff check app/services/exports/extraction/workbook.py` + `uv run ruff format app/services/exports/extraction/workbook.py`.
- [ ] **Step 5: Commit.**

```
git add backend/app/services/exports/extraction/workbook.py backend/tests/unit/test_extraction_xlsx_builder.py
git commit -m "feat(export): wire new sheets into workbook §4 order

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

### Task 51: Service-side — build `data_dictionary` projection onto `ExportLayout`

**Files:**
- Modify: `backend/app/services/extraction_export_service.py` (`resolve_layout` @255; add `_build_data_dictionary` helper; populate `ExportLayout.data_dictionary`)
- Test: `backend/tests/unit/test_extraction_export_data_dictionary_projection.py` (new pure unit test on the helper)

Assumes: `FieldDescriptor` carries `description`/`unit`/`is_required`/`allow_other` + `allowed_values` as `tuple[AllowedValue, ...]`-compatible (descriptors slice); `FieldDictEntry`/`AllowedValue`/`ExportLayout.data_dictionary` exist.

- [ ] **Step 1: Write the failing test for the pure helper.** Test `_build_data_dictionary(sections)` directly (no DB) — it flattens snapshot sections into `FieldDictEntry` rows in (section sort_order, field sort_order) order.

```python
"""Pure unit test for the data-dictionary projection helper."""

from __future__ import annotations

from uuid import uuid4

from app.models.extraction import (
    ExtractionCardinality,
    ExtractionEntityRole,
    ExtractionFieldType,
)
from app.services.extraction_export_service import (
    FieldDescriptor,
    SectionDescriptor,
    _build_data_dictionary,
)


def _section(label, *fields, sort_order=0):
    eid = uuid4()
    return SectionDescriptor(
        entity_type_id=eid,
        label=label,
        role=ExtractionEntityRole.STUDY_SECTION,
        parent_entity_type_id=None,
        fields=tuple(fields),
        cardinality=ExtractionCardinality.ONE,
        sort_order=sort_order,
    )


def _field(label, *, unit=None, required=False, allow_other=False, desc=None):
    return FieldDescriptor(
        field_id=uuid4(),
        label=label,
        type=ExtractionFieldType.SELECT,
        allowed_values=("Cohort", "RCT"),
        parent_section_id=uuid4(),
        description=desc,
        unit=unit,
        is_required=required,
        allow_other=allow_other,
    )


def test_build_data_dictionary_flattens_fields_with_metadata():
    s = _section(
        "1. Source",
        _field("Design", required=True, allow_other=True, desc="Study design"),
        _field("N", unit="patients"),
    )
    entries = _build_data_dictionary((s,))
    assert [e.label for e in entries] == ["Design", "N"]
    assert entries[0].section_label == "1. Source"
    assert entries[0].is_required is True
    assert entries[0].allow_other is True
    assert entries[0].description == "Study design"
    # allowed_values surfaced as value+label pairs
    assert tuple(av.value for av in entries[0].allowed_values) == ("Cohort", "RCT")
    assert tuple(av.label for av in entries[0].allowed_values) == ("Cohort", "RCT")
    assert entries[1].unit == "patients"
```

- [ ] **Step 2: Run it — expect FAIL.** `uv run pytest tests/unit/test_extraction_export_data_dictionary_projection.py -q`. Expected: ImportError — `_build_data_dictionary` not defined.
- [ ] **Step 3: Add the helper + populate the layout.** Add the module-level helper after `_normalize_allowed_values`:

```python
def _build_data_dictionary(
    sections: tuple[SectionDescriptor, ...],
) -> tuple[FieldDictEntry, ...]:
    """Flatten the snapshot sections into one FieldDictEntry per field (§4 #k+2).

    Order follows section then field order as already resolved on the
    descriptors (snapshot sort_order). ``allowed_values`` are surfaced as
    value+label pairs (value == label in prumo; both preserved — §11).
    """
    entries: list[FieldDictEntry] = []
    for section in sections:
        for field in section.fields:
            entries.append(
                FieldDictEntry(
                    field_id=field.field_id,
                    section_label=section.label,
                    label=field.label,
                    type=field.type,
                    unit=field.unit,
                    description=field.description,
                    allowed_values=tuple(
                        AllowedValue(value=v, label=v) for v in field.allowed_values
                    ),
                    is_required=field.is_required,
                    allow_other=field.allow_other,
                )
            )
    return tuple(entries)
```

In `resolve_layout`, after `sections = await self._load_sections(...)` (now the snapshot reader per §5.1) and before the `return ExportLayout(...)`, compute `data_dictionary = _build_data_dictionary(sections)` and pass `data_dictionary=data_dictionary` into the `ExportLayout(...)` constructor. (Land the `AllowedValue`/`FieldDictEntry` imports atomically with this usage — they are defined in the same module by the descriptors slice, so no new import is needed; reference them directly.)

- [ ] **Step 4: Run it — expect PASS.** `uv run pytest tests/unit/test_extraction_export_data_dictionary_projection.py -q`, then `uv run ruff check app/services/extraction_export_service.py` + `uv run ruff format app/services/extraction_export_service.py`.
- [ ] **Step 5: Commit.**

```
git add backend/app/services/extraction_export_service.py backend/tests/unit/test_extraction_export_data_dictionary_projection.py
git commit -m "feat(export): build data-dictionary projection onto ExportLayout

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

### Task 52: Service-side — build `tidy_tables` projection onto `ExportLayout`

**Files:**
- Modify: `backend/app/services/extraction_export_service.py` (add `_build_tidy_tables`; populate `ExportLayout.tidy_tables` in `resolve_layout`)
- Test: `backend/tests/unit/test_extraction_export_tidy_tables_projection.py` (new pure unit test on the helper)

Assumes: grown `ArticleDescriptor` (`section_instances: dict[UUID, tuple[UUID, ...]]`, `model_instances`); `SectionDescriptor.cardinality`/`sort_order`; `TidyTable`/`TidyRow`; value-map key shapes per `ExportMode`. The helper bakes the consensus (or all-users `…, None`) value per coordinate — values are already resolved scalars in `value_map` (the resolver slice owns `resolve_value`).

- [ ] **Step 1: Write the failing test for the pure helper.** `_build_tidy_tables(sections, articles, value_map, mode)` → one `TidyTable` per non-container section; grain by cardinality; records labelled; values baked.

```python
"""Pure unit test for the tidy-tables projection helper."""

from __future__ import annotations

from uuid import uuid4

from app.models.extraction import (
    ExtractionCardinality,
    ExtractionEntityRole,
    ExtractionFieldType,
)
from app.services.extraction_export_service import (
    ArticleDescriptor,
    ExportMode,
    FieldDescriptor,
    SectionDescriptor,
    _build_tidy_tables,
)


def _field(parent, label):
    return FieldDescriptor(
        field_id=uuid4(),
        label=label,
        type=ExtractionFieldType.TEXT,
        allowed_values=(),
        parent_section_id=parent,
    )


def _study_section():
    eid = uuid4()
    return SectionDescriptor(
        entity_type_id=eid,
        label="Study characteristics",
        role=ExtractionEntityRole.STUDY_SECTION,
        parent_entity_type_id=None,
        fields=(_field(eid, "Author"), _field(eid, "Year")),
        cardinality=ExtractionCardinality.ONE,
        sort_order=0,
    )


def _model_section():
    eid = uuid4()
    return SectionDescriptor(
        entity_type_id=eid,
        label="Model characteristics",
        role=ExtractionEntityRole.MODEL_SECTION,
        parent_entity_type_id=None,
        fields=(_field(eid, "Method"),),
        cardinality=ExtractionCardinality.MANY,
        sort_order=1,
    )


def test_one_cardinality_section_is_one_row_per_article():
    study = _study_section()
    inst = uuid4()
    run = uuid4()
    article = ArticleDescriptor(
        article_id=uuid4(),
        header_label="Gaca, 2011",
        run_id=run,
        run_stage=None,
        version_id=None,
        model_instances=(),
        section_instances={study.entity_type_id: (inst,)},
    )
    f_author, f_year = study.fields
    value_map = {
        (run, inst, f_author.field_id): "Gaca",
        (run, inst, f_year.field_id): "2011",
    }
    tables = _build_tidy_tables((study,), (article,), value_map, ExportMode.CONSENSUS)
    assert len(tables) == 1
    table = tables[0]
    assert table.title == "Study characteristics"
    assert table.column_labels == ("Author", "Year")
    assert len(table.rows) == 1
    assert table.rows[0].record_label == "Gaca, 2011"
    assert table.rows[0].values == ("Gaca", "2011")


def test_many_cardinality_section_fans_out_per_instance():
    model = _model_section()
    run = uuid4()
    m_a, m_b = uuid4(), uuid4()
    article = ArticleDescriptor(
        article_id=uuid4(),
        header_label="Gaca, 2011",
        run_id=run,
        run_stage=None,
        version_id=None,
        model_instances=(m_a, m_b),
        section_instances={},
    )
    f_method = model.fields[0]
    value_map = {
        (run, m_a, f_method.field_id): "Logistic regression",
        (run, m_b, f_method.field_id): "Cox model",
    }
    tables = _build_tidy_tables((model,), (article,), value_map, ExportMode.CONSENSUS)
    table = tables[0]
    assert len(table.rows) == 2
    assert table.rows[0].record_label.endswith("Model 1")
    assert table.rows[0].values == ("Logistic regression",)
    assert table.rows[1].values == ("Cox model",)


def test_model_container_section_is_skipped():
    container = SectionDescriptor(
        entity_type_id=uuid4(),
        label="Models",
        role=ExtractionEntityRole.MODEL_CONTAINER,
        parent_entity_type_id=None,
        fields=(),
        cardinality=ExtractionCardinality.MANY,
        sort_order=0,
    )
    tables = _build_tidy_tables((container,), (), {}, ExportMode.CONSENSUS)
    assert tables == ()
```

- [ ] **Step 2: Run it — expect FAIL.** `uv run pytest tests/unit/test_extraction_export_tidy_tables_projection.py -q`. Expected: ImportError — `_build_tidy_tables` not defined.
- [ ] **Step 3: Add the helper + populate the layout.** Add the module-level helper:

```python
def _tidy_value(
    value_map: dict[tuple[Any, ...], Any],
    *,
    run_id: UUID,
    instance_id: UUID,
    field_id: UUID,
    mode: ExportMode,
) -> Any:
    """Baked consensus value for one tidy-cell coordinate.

    All-users keys are 4-tuples ``(run, instance, field, reviewer|None)``; the
    tidy table shows the consensus sub-column (reviewer_id=None). Other modes
    use 3-tuple keys. Values are already resolved scalars (resolver slice).
    """
    if mode is ExportMode.ALL_USERS:
        return value_map.get((run_id, instance_id, field_id, None))
    return value_map.get((run_id, instance_id, field_id))


def _build_tidy_tables(
    sections: tuple[SectionDescriptor, ...],
    articles: tuple[ArticleDescriptor, ...],
    value_map: dict[tuple[Any, ...], Any],
    mode: ExportMode,
) -> tuple[TidyTable, ...]:
    """One publication table per non-container section at its cardinality grain.

    ``cardinality==MANY`` fans out one row per (article × instance); ``ONE``
    yields one row per article. Columns = section fields by sort order; values
    baked from ``value_map`` (§5.3).
    """
    tables: list[TidyTable] = []
    for section in sections:
        if section.role is ExtractionEntityRole.MODEL_CONTAINER:
            continue
        if not section.fields:
            continue
        column_field_ids = tuple(f.field_id for f in section.fields)
        column_labels = tuple(f.label for f in section.fields)
        rows: list[TidyRow] = []
        for article in articles:
            if article.run_id is None:
                continue
            if section.cardinality is ExtractionCardinality.MANY:
                if section.role is ExtractionEntityRole.MODEL_SECTION:
                    instances = article.model_instances
                else:
                    instances = article.section_instances.get(section.entity_type_id, ())
                for idx, instance_id in enumerate(instances, start=1):
                    rows.append(
                        _tidy_row(
                            section=section,
                            article=article,
                            instance_id=instance_id,
                            record_label=f"{article.header_label} \u2014 Model {idx}"
                            if section.role is ExtractionEntityRole.MODEL_SECTION
                            else f"{article.header_label} \u2014 {section.label} {idx}",
                            value_map=value_map,
                            mode=mode,
                        )
                    )
            else:
                instances = article.section_instances.get(section.entity_type_id, ())
                instance_id = instances[0] if instances else None
                if instance_id is None:
                    continue
                rows.append(
                    _tidy_row(
                        section=section,
                        article=article,
                        instance_id=instance_id,
                        record_label=article.header_label,
                        value_map=value_map,
                        mode=mode,
                    )
                )
        tables.append(
            TidyTable(
                section_id=section.entity_type_id,
                title=section.label,
                cardinality=section.cardinality,
                column_field_ids=column_field_ids,
                column_labels=column_labels,
                rows=tuple(rows),
            )
        )
    return tuple(tables)


def _tidy_row(
    *,
    section: SectionDescriptor,
    article: ArticleDescriptor,
    instance_id: UUID,
    record_label: str,
    value_map: dict[tuple[Any, ...], Any],
    mode: ExportMode,
) -> TidyRow:
    values = tuple(
        _tidy_value(
            value_map,
            run_id=article.run_id,  # type: ignore[arg-type]  # run_id checked non-None by caller
            instance_id=instance_id,
            field_id=f.field_id,
            mode=mode,
        )
        for f in section.fields
    )
    return TidyRow(
        article_id=article.article_id,
        instance_id=instance_id,
        record_label=record_label,
        values=values,
    )
```

In `resolve_layout`, after the value map is built, compute `tidy_tables = _build_tidy_tables(sections, tuple(articles), value_map, mode)` and pass `tidy_tables=tidy_tables` into `ExportLayout(...)`.

- [ ] **Step 4: Run it — expect PASS.** `uv run pytest tests/unit/test_extraction_export_tidy_tables_projection.py -q`, then `uv run ruff check` + `uv run ruff format` on the service file.
- [ ] **Step 5: Commit.**

```
git add backend/app/services/extraction_export_service.py backend/tests/unit/test_extraction_export_tidy_tables_projection.py
git commit -m "feat(export): build per-section tidy-table projection onto ExportLayout

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

### Task 53: Service-side — build `front_matter` projection onto `ExportLayout`

**Files:**
- Modify: `backend/app/services/extraction_export_service.py` (add `_build_front_matter`; populate `ExportLayout.front_matter` in `resolve_layout`)
- Test: `backend/tests/unit/test_extraction_export_front_matter_projection.py` (new pure unit test on the helper)

Assumes: grown `ExportLayout.front_matter`; `FrontMatter` dataclass; grown `ExportNotes.obsolete_fields_per_article` (already declared, now populated by the resolver/snapshot slice). This task assembles `FrontMatter` from already-computed inputs — counts, generated `contents`, the static `legend`/`caveats`, and `obsolete_fields_per_article` (lifted from `notes`). `record_count` = total tidy-table rows.

- [ ] **Step 1: Write the failing test for the helper.** `_build_front_matter(...)` assembles the dataclass from explicit params.

```python
"""Pure unit test for the front-matter projection helper."""

from __future__ import annotations

from datetime import UTC, datetime
from uuid import uuid4

from app.models.extraction import (
    ExtractionCardinality,
    ExtractionEntityRole,
    ExtractionFieldType,
)
from app.services.extraction_export_service import (
    ArticleDescriptor,
    ExportMode,
    FieldDescriptor,
    SectionDescriptor,
    _build_front_matter,
    _build_tidy_tables,
)


def _study():
    eid = uuid4()
    return SectionDescriptor(
        entity_type_id=eid,
        label="Study characteristics",
        role=ExtractionEntityRole.STUDY_SECTION,
        parent_entity_type_id=None,
        fields=(
            FieldDescriptor(
                field_id=uuid4(),
                label="Author",
                type=ExtractionFieldType.TEXT,
                allowed_values=(),
                parent_section_id=eid,
            ),
        ),
        cardinality=ExtractionCardinality.ONE,
        sort_order=0,
    )


def test_front_matter_assembles_counts_contents_and_obsolete():
    study = _study()
    inst, run = uuid4(), uuid4()
    aid = uuid4()
    article = ArticleDescriptor(
        article_id=aid,
        header_label="Gaca, 2011",
        run_id=run,
        run_stage=None,
        version_id=None,
        model_instances=(),
        section_instances={study.entity_type_id: (inst,)},
    )
    value_map = {(run, inst, study.fields[0].field_id): "Gaca"}
    tidy = _build_tidy_tables((study,), (article,), value_map, ExportMode.CONSENSUS)
    fm = _build_front_matter(
        project_name="My Project",
        template_name="CHARMS",
        template_version=2,
        mode=ExportMode.CONSENSUS,
        generated_at=datetime(2026, 6, 14, tzinfo=UTC),
        articles=(article,),
        tidy_tables=tidy,
        obsolete_fields_per_article={aid: ["Removed field"]},
    )
    assert fm.project_name == "My Project"
    assert fm.template_version == 2
    assert fm.export_mode_label  # non-empty human label
    assert fm.article_count == 1
    assert fm.record_count == 1  # one tidy row
    # contents lists the rendered sheet names incl. the tidy table title
    assert "README / Methods" in fm.contents
    assert "Study characteristics" in fm.contents
    # legend + caveats are non-empty (generic glyph/sentinel legend)
    assert fm.legend
    assert fm.caveats
    assert fm.obsolete_fields_per_article[aid] == ("Removed field",)
```

- [ ] **Step 2: Run it — expect FAIL.** `uv run pytest tests/unit/test_extraction_export_front_matter_projection.py -q`. Expected: ImportError — `_build_front_matter` not defined.
- [ ] **Step 3: Add the helper + populate the layout.** Add module-level constants + helper:

```python
_FRONT_MATTER_LEGEND: tuple[tuple[str, str], ...] = (
    ("(blank)", "No value recorded, or the reviewer rejected the AI proposal."),
    ("No information", "The source reported that the item was not stated."),
    ("Yes / No", "Boolean field rendered from its true/false value."),
    ("; ", "Separator between multiple selected options."),
)

_FRONT_MATTER_CAVEATS: tuple[str, ...] = (
    "Every value is a static literal baked from the resolved extraction; "
    "this workbook contains no live formulas.",
    "Reviewer outcomes labelled 'best-effort' rely on heuristics; the data "
    "model does not preserve the exact AI-proposal to edited-value lineage.",
    "Columns reflect the active template version. Fields a Run was finalized "
    "on but later removed are listed under 'Fields removed from active template'.",
)

_MODE_LABELS: dict[ExportMode, str] = {
    ExportMode.CONSENSUS: "Consensus",
    ExportMode.SINGLE_USER: "Single user",
    ExportMode.ALL_USERS: "All users",
}


def _build_front_matter(
    *,
    project_name: str,
    template_name: str,
    template_version: int,
    mode: ExportMode,
    generated_at: datetime,
    articles: tuple[ArticleDescriptor, ...],
    tidy_tables: tuple[TidyTable, ...],
    obsolete_fields_per_article: dict[UUID, list[str]],
) -> FrontMatter:
    """Assemble the README/Methods front matter (§4 #1)."""
    contents: list[str] = ["README / Methods", "Summary", template_name]
    contents.extend(t.title for t in tidy_tables)
    contents.append("Data dictionary")
    record_count = sum(len(t.rows) for t in tidy_tables)
    return FrontMatter(
        project_name=project_name,
        template_name=template_name,
        template_version=template_version,
        export_mode_label=_MODE_LABELS.get(mode, mode.value),
        generated_at=generated_at,
        article_count=len(articles),
        record_count=record_count,
        contents=tuple(contents),
        legend=_FRONT_MATTER_LEGEND,
        caveats=_FRONT_MATTER_CAVEATS,
        obsolete_fields_per_article={
            aid: tuple(labels) for aid, labels in obsolete_fields_per_article.items()
        },
    )
```

In `resolve_layout`, after `tidy_tables` and `notes` are built, compute:

```python
front_matter = _build_front_matter(
    project_name=project_name,
    template_name=template.name,
    template_version=version.version,
    mode=mode,
    generated_at=notes.generated_at or datetime.now(UTC),
    articles=tuple(articles),
    tidy_tables=tidy_tables,
    obsolete_fields_per_article=notes.obsolete_fields_per_article,
)
```

and pass `front_matter=front_matter` into `ExportLayout(...)`.

- [ ] **Step 4: Run it — expect PASS.** `uv run pytest tests/unit/test_extraction_export_front_matter_projection.py -q`, then `uv run ruff check` + `uv run ruff format` on the service file.
- [ ] **Step 5: Commit.**

```
git add backend/app/services/extraction_export_service.py backend/tests/unit/test_extraction_export_front_matter_projection.py
git commit -m "feat(export): build front-matter projection onto ExportLayout

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

### Task 54: End-to-end builder integration — new sheets render from a service-resolved layout

**Files:**
- Test (new): `backend/tests/integration/test_extraction_export_new_sheets.py`
- Read (setup pattern): `backend/tests/integration/test_extraction_manual_only_flow.py` (run/instance/proposal/finalize pattern)

Assumes the service-side projections from the three prior tasks are wired into `resolve_layout`, and `workbook.py` renders them. Uses the real local Supabase per backend test rule; scope all queries by `project_id`.

- [ ] **Step 1: Read the integration setup pattern.** Read `test_extraction_manual_only_flow.py` to copy the seeded-template + run + finalize + publish helper sequence (and confirm the autouse `SEED` fixture + `db_session` usage). Do not write code in this step.
- [ ] **Step 2: Write the failing integration test.** Resolve a Consensus layout for a finalized CHARMS run, build the workbook, and assert the new sheets are present and carry baked data. Mirror the manual-only flow's fixtures; scope by `project_id`.

```python
"""Integration: the resolved ExportLayout renders the new publication sheets.

Real local Supabase (autouse SEED). Scopes all queries by project_id.
"""

from __future__ import annotations

import io

import pytest
from openpyxl import load_workbook

from app.services.exports.extraction.workbook import build_workbook
from app.services.extraction_export_service import ExportMode, ExtractionExportService


@pytest.mark.asyncio
async def test_resolved_layout_renders_new_sheets(db_session, seeded_charms_export_fixture):
    """README, Summary, a tidy table, and Data dictionary render with data."""
    fx = seeded_charms_export_fixture  # provides project_id, template_id, article_ids, user_id
    service = ExtractionExportService(
        db=db_session, user_id=str(fx.user_id), storage=fx.storage_stub
    )
    layout = await service.resolve_layout(
        project_id=fx.project_id,
        template_id=fx.template_id,
        mode=ExportMode.CONSENSUS,
        article_ids=list(fx.article_ids),
        include_ai_metadata=False,
        anonymize_reviewer_names=False,
    )

    # Projections are populated.
    assert layout.front_matter is not None
    assert layout.data_dictionary  # ≥1 field
    assert layout.tidy_tables  # ≥1 section table

    wb = load_workbook(io.BytesIO(build_workbook(layout)))
    assert "README" in wb.sheetnames
    assert "Summary" in wb.sheetnames
    assert "Data dictionary" in wb.sheetnames
    # at least one tidy-table sheet beyond the always-present ones
    base = {"README", "Summary", "Data dictionary", layout.template_name[:31]}
    assert any(name not in base and name != "Dropdown lists" for name in wb.sheetnames)

    # Front matter carries the template identity.
    readme = wb["README"]
    flat = " ".join(
        str(c.value) for row in readme.iter_rows(values_only=True) for c in row if c is not None
    )
    assert layout.template_name in flat
    assert "Consensus" in flat
```

If the repo has no shared `seeded_charms_export_fixture`, this step also adds a local fixture in the test module that builds the seed graph using the exact helper sequence read in Step 1 (create template version → run → instances → proposals → finalize → publish), returning a small dataclass with `project_id`, `template_id`, `article_ids`, `user_id`, and a `storage_stub` (a no-op `StorageAdapter`). Keep the fixture queries scoped by `project_id`.

- [ ] **Step 3: Run it — expect FAIL (then iterate).** `uv run pytest tests/integration/test_extraction_export_new_sheets.py -q` from `backend/` (needs local Supabase on :54322). Expected first failure: missing fixture or an assertion on the new sheet names if any wiring gap remains. Fix wiring/fixture until green — do not weaken assertions.
- [ ] **Step 4: Run the full export unit + integration suite green.** `uv run pytest tests/unit/test_extraction_front_matter_builder.py tests/unit/test_extraction_summary_builder.py tests/unit/test_extraction_data_dictionary_builder.py tests/unit/test_extraction_dropdown_lists_builder.py tests/unit/test_extraction_tidy_tables_builder.py tests/unit/test_extraction_export_data_dictionary_projection.py tests/unit/test_extraction_export_tidy_tables_projection.py tests/unit/test_extraction_export_front_matter_projection.py tests/unit/test_extraction_xlsx_builder.py tests/integration/test_extraction_export_new_sheets.py -q`. Then `uv run ruff check` + `uv run ruff format` on every file touched in this slice.
- [ ] **Step 5: Commit.**

```
git add backend/tests/integration/test_extraction_export_new_sheets.py
git commit -m "test(export): integration coverage for new publication sheets

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

**Cross-slice dependencies (the synthesizer must order these after the owning slices):** this slice consumes, by exact name, types owned by sibling slices — `SheetSpec`/`Cell`/`CellStyle` (`app.services.exports.extraction.sheet_spec`), `resolve_value` (`app.services.exports.value_envelope`, used transitively via the populated `value_map`), the grown descriptors (`FieldDescriptor.{description,unit,is_required,allow_other}`, `SectionDescriptor.{cardinality,sort_order}`, `ArticleDescriptor.{version_id,section_instances,model_instances}`), and the new element dataclasses (`TidyTable`/`TidyRow`/`FieldDictEntry`/`AllowedValue`/`FrontMatter`) plus the four new `ExportLayout` fields. The `workbook.py` orchestrator + `_render_sheet_spec` + `build_matrix`/`build_appraisal_summary`/`build_ai_metadata` are owned by the builder-split, appraisal, and AI-metadata slices; the "Wire the new sheets" task touches only the §4 ordering inside `_ordered_specs`.


---

## Phase S7 — Appraisal summary with mode-aware Overall

### Task 55: Confirm how an appraisal section is identified (read + decision)

**Files:**
- Read: `backend/app/models/extraction.py` (`ExtractionEntityRole` @64-86, `ExtractionFieldType` @46-54, template `kind` @141-145)
- Read: `backend/app/models/extraction_versioning.py` (`TemplateKind` @21-25)
- Read: `backend/app/services/extraction_export_service.py` (`resolve_layout` @255, `_load_active_template_version` @394, `ExtractionRun.kind == "extraction"` filter @496)
- Read: `backend/app/seed.py` (QA template seed @1379, @1690)
- No code is written in this task — it records the identification decision the later tasks build on.

Steps:

- [ ] **Step 1: Enumerate the candidate signals.** Confirm against the model that there is **no** `APPRAISAL` entity role (`ExtractionEntityRole` is exactly `STUDY_SECTION / MODEL_CONTAINER / MODEL_SECTION`) and **no** per-section `is_appraisal` flag. The only first-class "appraisal" signal in the schema is at the **template level**: `TemplateKind` ∈ `{extraction, quality_assessment}` (`backend/app/models/extraction_versioning.py:21-25`), carried on `ProjectExtractionTemplate.kind`, `ExtractionTemplateVersion` (via its template), and `ExtractionRun.kind`. Risk-of-bias / quality-assessment templates (CHARMS+PROBAST style) are seeded with `kind=TemplateKind.QUALITY_ASSESSMENT.value` (`backend/app/seed.py:1379,1690`).

- [ ] **Step 2: Record the DECISION (used verbatim by every later task in this slice).**
  - **An "appraisal layer" exists for an export iff the exported template's `kind == TemplateKind.QUALITY_ASSESSMENT`.** This is a template-kind signal, not an entity-role or per-section flag.
  - When the exported template is `quality_assessment`: `resolve_layout` populates `ExportLayout.appraisal: AppraisalModel`, and `build_appraisal_summary(layout)` emits the conditional sheet (workbook position k+1, §4).
  - When the exported template is `extraction` (the default kind): `layout.appraisal is None`, `build_appraisal_summary` returns `None`, the sheet is omitted, and any risk-of-bias-shaped section inside the template still renders as an ordinary tidy table via `build_tidy_tables` (§5.3 / §7 plan-time note: "a PROBAST-style section still appears as an ordinary tidy table").
  - **Appraisal "domains" = the sections (entity_types) of the QA template**, taken in snapshot `sort_order`. Each domain is one `SectionDescriptor`/`SnapshotSection` from `load_export_sections`.
  - **A domain's "verdict" = the resolved value of that domain's designated judgment field.** "First `SELECT` field in `sort_order`" would be **wrong** against the actual seed (`backend/app/seed.py`): the per-domain **signalling questions are themselves `SELECT`-typed** (`_signaling` → `_qa_field(..., "select", ...)`, `backend/app/seed.py:1301-1318`) and are seeded at **lower** `sort_order` than the judgment, so "first `SELECT`" selects a signalling question (e.g. PROBAST Domain 1 `q1_1_appropriate_data_sources`, `sort_order 0`), never the `risk_of_bias` verdict (`sort_order 2`). A domain also carries **two** categorical judgment `SELECT` fields — `risk_of_bias` **and** `applicability_concerns` (`_domain_judgment`, `backend/app/seed.py:1321-1354`) — so "exactly one" is false too. The verdict field is therefore identified **by its label set, not its position**: it is the **first `SELECT`-typed field in `sort_order` whose `allowed_values` equal the risk-label set** `{Low, High, Unclear}` (case-insensitive; value == label per §11). This cleanly separates the judgment fields from the signalling fields, whose answer sets are distinct (PROBAST `{Y, PY, PN, N, NI, NA}`; QUADAS-2 `{Y, N, Unclear}` — `_PROBAST_SIGNALING`/`_QUADAS2_SIGNALING`, `backend/app/seed.py:155,160`), and "first in `sort_order`" among the judgment fields deterministically picks `risk_of_bias` over `applicability_concerns` (it is seeded first). The risk-label set is the recognised severity vocabulary of the worst-case order below (`{High, Unclear, Some concerns, Moderate, Low}`); matching is membership-based (a domain qualifies when **every** non-blank allowed value is a recognised label), keeping QUADAS-2/ROBINS-style label sets in scope while excluding signalling sets. Only `FieldDescriptor.{type, allowed_values}` are needed (the machine `name` `risk_of_bias` is **not** carried onto the descriptor — `FieldDescriptor` has no `name`, `extraction_export_service.py:77-94` — so selection must key on `allowed_values`, not the name). (Per-domain non-verdict fields — signalling questions and `applicability_concerns` — are not rolled up; they remain available in that section's ordinary tidy table.)
  - **"Overall" = worst-case rollup** over a record's domain verdicts using a fixed severity order `High > Unclear > Some concerns > Moderate > Low` (case-insensitive match; any unrecognised non-empty verdict is treated as more severe than every recognised label so a novel label never silently downgrades the rollup; all-blank ⇒ blank Overall). This satisfies "any `High` ⇒ `High`" (§7) while staying template-agnostic for QUADAS-2/ROBINS-style label sets.

- [ ] **Step 3: Record the MODE-AWARE Overall mapping (mirrors the matrix reviewer-axis fan-out, §7 + §6.1).**
  - **Consensus** → one `Overall` column. `AppraisalRow.overall` = worst-case rollup over consensus domain verdicts; `per_reviewer_overall == {}`.
  - **All-users** → the consensus `Overall` column **plus one `Overall` column per reviewer**, in the exact reviewer order of `layout.reviewers` (so the appraisal fan-out lines up 1:1 with the matrix sub-columns). `AppraisalRow.overall` = consensus rollup; `AppraisalRow.per_reviewer_overall[reviewer_id]` = that reviewer's rollup over their own domain verdicts.
  - **Single-user** → one `Overall` column holding **that reviewer's** rollup. `AppraisalRow.overall` = the single reviewer's rollup; `per_reviewer_overall == {}`.
  - All three read **already-resolved scalars** from `layout.value_map` keyed by the verdict field (3-tuple `(run_id, instance_id, field_id)` for consensus/single-user; 4-tuple `(run_id, instance_id, field_id, reviewer_id)` for all-users) — the appraisal builder never re-handles envelopes (`resolve_value` already ran upstream).

- [ ] **Step 4: Record the GRAIN + emission rules.**
  - Appraisal grain = **one row per record at the appraisal grain** = one row per article (QA templates are study-level: domains are `cardinality='one'` `STUDY_SECTION`s). If a QA domain is `cardinality='many'` (e.g. per-index-test QUADAS-2), the row grain fans out one row per instance, reusing the same per-record instance resolution the tidy tables use (`ArticleDescriptor.section_instances[entity_type_id]`). `record_label` matches the tidy-table record label (article header, or `"<header> — <instance ordinal>"`).
  - The sheet is emitted (`AppraisalModel` non-None) **only when ≥1 domain has a resolvable verdict field** (a `SELECT` field whose `allowed_values` are the risk-label set, per Step 2); a QA template with no risk-label-set `SELECT` field in any domain yields `appraisal=None` (no empty roll-up sheet) — fall back to ordinary tidy tables. Note the `Overall` summary domain (PROBAST/QUADAS-2 entity `overall`, `backend/app/seed.py:1636-1660,1884-1908`) carries its own risk-label-set `SELECT` (`overall_risk_of_bias`) and so qualifies as a "domain"; the worst-case rollup over the per-domain verdicts (including that one) still satisfies "any `High` ⇒ `High`".

- [ ] **Step 5: No commit (read/decision task).** This task produces the decision recorded above; it is referenced verbatim by the code tasks below. Proceed to the contract-extension task.

---

### Task 56: Add `AppraisalModel` / `AppraisalRow` dataclasses + `ExportLayout.appraisal` field (failing import test first)

**Files:**
- Modify: `backend/app/services/extraction_export_service.py` (add dataclasses near the other layout descriptors @72-178; add `appraisal` field to `ExportLayout`)
- Test: `backend/tests/unit/test_extraction_appraisal_summary_builder.py` (new)

> Depends on the shared-contract dataclasses (`AppraisalModel`, `AppraisalRow`) and `ExportLayout.appraisal` declared in the preamble. If a sibling slice already added them, skip Steps 2-3 and keep only the import-smoke assertion.

Steps:

- [ ] **Step 1: Write the failing import/shape test.** Create `backend/tests/unit/test_extraction_appraisal_summary_builder.py`:
```python
"""Unit tests for the appraisal-summary sub-builder (§7)."""

from __future__ import annotations

import pytest


def test_appraisal_dataclasses_importable_and_default_none() -> None:
    """AppraisalModel/AppraisalRow exist and ExportLayout.appraisal defaults to None."""
    from app.services.extraction_export_service import (
        AppraisalModel,
        AppraisalRow,
        ExportLayout,
    )

    row = AppraisalRow(
        article_id=__import__("uuid").uuid4(),
        record_label="Gaca, 2011",
        domain_verdicts=("Low", "High"),
        overall="High",
        per_reviewer_overall={},
    )
    assert row.overall == "High"

    model = AppraisalModel(
        domain_section_ids=(),
        domain_labels=("Participants", "Predictors"),
        rows=(row,),
    )
    assert model.domain_labels[1] == "Predictors"

    # ExportLayout.appraisal is an optional projection (back-compat default).
    assert "appraisal" in ExportLayout.__dataclass_fields__
    field = ExportLayout.__dataclass_fields__["appraisal"]
    assert field.default is None
```

- [ ] **Step 2: Run it — expect FAIL** (ImportError: cannot import `AppraisalModel`):
  `cd backend && uv run pytest tests/unit/test_extraction_appraisal_summary_builder.py -q`

- [ ] **Step 3: Add the dataclasses + the `ExportLayout` field.** In `extraction_export_service.py`, alongside the existing layout descriptors (after `ReviewerDescriptor`, before `ExportLayout`), add (imports `Any`, `UUID`, `dataclass` already present in this module):
```python
@dataclass(frozen=True)
class AppraisalRow:
    """One record's appraisal roll-up (§7). Values are already-resolved scalars."""

    article_id: UUID
    record_label: str
    domain_verdicts: tuple[Any, ...]  # aligned to AppraisalModel.domain_labels
    overall: Any  # worst-case rollup (consensus / single-user)
    per_reviewer_overall: dict[UUID, Any]  # all-users only: reviewer_id -> Overall


@dataclass(frozen=True)
class AppraisalModel:
    """Computed appraisal roll-up (§7); None on ExportLayout when no QA layer."""

    domain_section_ids: tuple[UUID, ...]
    domain_labels: tuple[str, ...]
    rows: tuple[AppraisalRow, ...]
```
Then add the field to `ExportLayout` (after `ai_proposal_rows`, keeping back-compat default):
```python
    appraisal: "AppraisalModel | None" = None
```

- [ ] **Step 4: Lint the touched file (imports land atomically):**
  `cd backend && uv run ruff check app/services/extraction_export_service.py && uv run ruff format app/services/extraction_export_service.py`

- [ ] **Step 5: Run the test — expect PASS:**
  `cd backend && uv run pytest tests/unit/test_extraction_appraisal_summary_builder.py -q`

- [ ] **Step 6: Commit:**
```
feat(backend): add AppraisalModel/AppraisalRow layout descriptors

Adds the appraisal roll-up dataclasses and the optional
ExportLayout.appraisal projection consumed by the conditional
appraisal-summary sheet (§7). Read-only consumer; no model change.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
```

---

### Task 57: Pure worst-case Overall rollup helper (`_appraisal_overall`)

**Files:**
- Create: `backend/app/services/exports/extraction/appraisal_summary.py` (helper only in this task; sub-builder added next)
- Test: `backend/tests/unit/test_extraction_appraisal_summary_builder.py` (extend)

Steps:

- [ ] **Step 1: Write the failing rollup test.** Append to `test_extraction_appraisal_summary_builder.py`:
```python
@pytest.mark.parametrize(
    ("verdicts", "expected"),
    [
        (("Low", "Low", "Low"), "Low"),
        (("Low", "High", "Low"), "High"),          # any High => High (§7)
        (("Low", "Unclear", "Low"), "Unclear"),    # Unclear outranks Low
        (("Unclear", "High"), "High"),             # High outranks Unclear
        (("Some concerns", "Low"), "Some concerns"),  # QUADAS/ROBINS labels
        (("Moderate", "Low"), "Moderate"),
        ((None, "", None), None),                  # all-blank => blank Overall
        (("Low", None, "High"), "High"),           # blanks ignored, High wins
        (("Critical", "Low"), "Critical"),         # unknown non-empty => most severe
        (("low", "high"), "high"),                 # case-insensitive rank, label preserved
    ],
)
def test_appraisal_overall_worst_case(verdicts, expected) -> None:
    from app.services.exports.extraction.appraisal_summary import _appraisal_overall

    assert _appraisal_overall(verdicts) == expected
```

- [ ] **Step 2: Run it — expect FAIL** (ModuleNotFoundError for the package):
  `cd backend && uv run pytest tests/unit/test_extraction_appraisal_summary_builder.py -q -k worst_case`

- [ ] **Step 3: Create the package + helper.** First ensure the package marker exists (create `backend/app/services/exports/extraction/__init__.py` only if a sibling slice has not — if it exists, leave it). Then create `backend/app/services/exports/extraction/appraisal_summary.py`:
```python
"""Appraisal-summary sub-builder (§7).

Pure, no-IO. Computes a per-domain-verdict + worst-case Overall sheet for
quality-assessment templates. Consumes already-resolved scalars from the
layout's value_map (resolve_value ran upstream); never re-handles envelopes.
"""

from __future__ import annotations

from typing import Any

# Worst-case severity order, most severe first. Case-insensitive match.
# Covers PROBAST (High/Unclear/Low), QUADAS-2 (High/Unclear/Low),
# ROB-2 / ROBINS-I (High/Some concerns/Moderate/Serious/Critical/Low).
_SEVERITY_RANK: tuple[str, ...] = (
    "critical",
    "serious",
    "high",
    "some concerns",
    "moderate",
    "unclear",
    "low",
)

# Recognised risk-label vocabulary (case-folded). Single source of truth for
# "which SELECT field is a domain verdict": a domain's verdict field is the
# first SELECT whose allowed_values are all drawn from this set, which
# separates the judgment fields (Low/High/Unclear) from the SELECT-typed
# signalling questions (Y/PY/PN/N/NI/NA, Y/N/Unclear). Reused by
# extraction_export_service._build_appraisal_model (§7 verdict selection).
_RISK_LABELS: frozenset[str] = frozenset(_SEVERITY_RANK)


def _verdict_rank(verdict: Any) -> int:
    """Severity rank for one verdict; higher == worse. Blank == -1 (ignored).

    A non-empty verdict not in the known table outranks every known label
    (rank == len(table)) so a novel risk label never silently downgrades the
    Overall — the rollup fails toward caution, not toward a green light.
    """
    if verdict is None:
        return -1
    text = str(verdict).strip()
    if not text:
        return -1
    lowered = text.casefold()
    for rank, label in enumerate(reversed(_SEVERITY_RANK)):
        if lowered == label:
            return rank
    # Unknown non-empty label: most severe.
    return len(_SEVERITY_RANK)


def _appraisal_overall(verdicts: tuple[Any, ...]) -> Any:
    """Worst-case rollup over a record's domain verdicts (§7).

    Returns the original (label-preserving) verdict with the highest severity
    rank; blanks are ignored; an all-blank record yields None (blank Overall).
    Ties resolve to the first encountered, keeping output deterministic.
    """
    worst: Any = None
    worst_rank = -1
    for verdict in verdicts:
        rank = _verdict_rank(verdict)
        if rank > worst_rank:
            worst_rank = rank
            worst = verdict
    return worst if worst_rank >= 0 else None
```

- [ ] **Step 4: Lint:**
  `cd backend && uv run ruff check app/services/exports/extraction/appraisal_summary.py && uv run ruff format app/services/exports/extraction/appraisal_summary.py`

- [ ] **Step 5: Run the test — expect PASS:**
  `cd backend && uv run pytest tests/unit/test_extraction_appraisal_summary_builder.py -q -k worst_case`

- [ ] **Step 6: Commit:**
```
feat(backend): add worst-case appraisal Overall rollup helper

Severity-ranked, label-preserving, caution-biased rollup over a
record's domain verdicts (§7: any High => High). Unknown labels rank
most-severe; all-blank yields a blank Overall.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
```

---

### Task 58: `build_appraisal_summary` — consensus-mode sheet (one Overall column)

**Files:**
- Modify: `backend/app/services/exports/extraction/appraisal_summary.py` (add `build_appraisal_summary`)
- Test: `backend/tests/unit/test_extraction_appraisal_summary_builder.py` (extend)

> Consumes the shared `SheetSpec`/`Cell` from `app.services.exports.extraction.sheet_spec` and the `ExportLayout`/`AppraisalModel`/`AppraisalRow` dataclasses. `build_appraisal_summary(layout) -> SheetSpec | None`; returns `None` when `layout.appraisal is None` (§7). This task wires only the rendering from a *pre-computed* `AppraisalModel` (consensus); the `resolve_layout` computation is a later task.

Steps:

- [ ] **Step 1: Write the failing builder test.** Append a helper that fabricates a minimal `ExportLayout` carrying a consensus `AppraisalModel`, then asserts the rendered `SheetSpec`. Add to the test file:
```python
def _layout_with_appraisal(appraisal, *, mode_name="consensus", reviewers=()):
    """Minimal ExportLayout carrying a pre-computed AppraisalModel."""
    from datetime import UTC, datetime

    from app.services.extraction_export_service import (
        ExportLayout,
        ExportMode,
        ExportNotes,
    )

    notes = ExportNotes(
        omitted_articles_by_stage={},
        template_version_label="QA v1",
        export_mode_label=mode_name,
        anonymize_reviewer_names=False,
        include_ai_metadata=False,
        generated_at=datetime.now(UTC),
    )
    return ExportLayout(
        project_name="P",
        template_name="PROBAST",
        template_version=1,
        sections=(),
        articles=(),
        reviewers=reviewers,
        mode=ExportMode(mode_name),
        include_ai_metadata=False,
        anonymize_reviewer_names=False,
        notes=notes,
        value_map={},
        appraisal=appraisal,
    )


def test_build_appraisal_summary_none_when_no_layer() -> None:
    from app.services.exports.extraction.appraisal_summary import build_appraisal_summary

    layout = _layout_with_appraisal(None)
    assert build_appraisal_summary(layout) is None


def test_build_appraisal_summary_consensus_shape() -> None:
    import uuid

    from app.services.exports.extraction.appraisal_summary import build_appraisal_summary
    from app.services.extraction_export_service import AppraisalModel, AppraisalRow

    aid = uuid.uuid4()
    appraisal = AppraisalModel(
        domain_section_ids=(uuid.uuid4(), uuid.uuid4()),
        domain_labels=("Participants", "Predictors"),
        rows=(
            AppraisalRow(
                article_id=aid,
                record_label="Gaca, 2011",
                domain_verdicts=("Low", "High"),
                overall="High",
                per_reviewer_overall={},
            ),
        ),
    )
    spec = build_appraisal_summary(_layout_with_appraisal(appraisal))
    assert spec is not None
    # Header row: Record + each domain + Overall.
    header = tuple(c.value for c in spec.rows[0])
    assert header == ("Record", "Participants", "Predictors", "Overall")
    # Data row: label, verdicts, rolled-up Overall.
    data = tuple(c.value for c in spec.rows[1])
    assert data == ("Gaca, 2011", "Low", "High", "High")
    assert spec.freeze == "B2"  # record column + header frozen
```

- [ ] **Step 2: Run it — expect FAIL** (ImportError: `build_appraisal_summary`):
  `cd backend && uv run pytest tests/unit/test_extraction_appraisal_summary_builder.py -q -k "consensus_shape or no_layer"`

- [ ] **Step 3: Implement `build_appraisal_summary` (consensus path).** Append to `appraisal_summary.py` (land the imports atomically):
```python
from app.services.exports.extraction.sheet_spec import Cell, CellStyle, SheetSpec
from app.services.extraction_export_service import ExportLayout, ExportMode

_HEADER_STYLE = CellStyle(bold=True, fill="EEEEEE")


def build_appraisal_summary(layout: ExportLayout) -> SheetSpec | None:
    """Build the conditional appraisal-summary sheet (§7).

    Returns None when the exported template carries no appraisal layer
    (``layout.appraisal is None``) — the workbook orchestrator then omits
    sheet #k+1 and any risk-of-bias section still renders as a tidy table.

    Mode-aware Overall columns (§7):
      * consensus / single_user -> a single ``Overall`` column.
      * all_users -> consensus ``Overall`` + one ``Overall`` column per
        reviewer, in ``layout.reviewers`` order (mirrors the matrix fan-out).
    """
    appraisal = layout.appraisal
    if appraisal is None:
        return None

    domain_labels = appraisal.domain_labels
    header_cells = [Cell("Record", _HEADER_STYLE)]
    header_cells.extend(Cell(label, _HEADER_STYLE) for label in domain_labels)
    header_cells.append(Cell("Overall", _HEADER_STYLE))

    reviewer_overall_cols: tuple = ()
    if layout.mode is ExportMode.ALL_USERS:
        reviewer_overall_cols = tuple(layout.reviewers)
        for reviewer in reviewer_overall_cols:
            header_cells.append(
                Cell(f"Overall — {reviewer.display_name}", _HEADER_STYLE)
            )

    rows: list[tuple[Cell, ...]] = [tuple(header_cells)]
    for row in appraisal.rows:
        cells = [Cell(row.record_label)]
        cells.extend(Cell(v) for v in row.domain_verdicts)
        cells.append(Cell(row.overall))
        for reviewer in reviewer_overall_cols:
            cells.append(Cell(row.per_reviewer_overall.get(reviewer.reviewer_id)))
        rows.append(tuple(cells))

    return SheetSpec(
        title="Appraisal summary",
        rows=tuple(rows),
        freeze="B2",
        column_widths=(28.0,) + (16.0,) * (len(domain_labels) + 1),
    )
```
(`ReviewerDescriptor.display_name` is the existing reviewer label field; confirm its exact name when wiring — if it is `name`, use that. The anonymize toggle already baked the display name upstream in `_list_reviewers_for_runs`.)

- [ ] **Step 4: Lint:**
  `cd backend && uv run ruff check app/services/exports/extraction/appraisal_summary.py && uv run ruff format app/services/exports/extraction/appraisal_summary.py`

- [ ] **Step 5: Run the test — expect PASS:**
  `cd backend && uv run pytest tests/unit/test_extraction_appraisal_summary_builder.py -q -k "consensus_shape or no_layer"`

- [ ] **Step 6: Commit:**
```
feat(backend): render consensus appraisal-summary sheet

build_appraisal_summary emits a record-row × domain-verdict sheet with
a single worst-case Overall column; returns None when no QA layer (§7).

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
```

---

### Task 59: `build_appraisal_summary` — all-users (per-reviewer Overall fan-out) + single-user

**Files:**
- Modify: `backend/app/services/exports/extraction/appraisal_summary.py` (no change expected if Step-3 above already handled all_users; this task proves it)
- Test: `backend/tests/unit/test_extraction_appraisal_summary_builder.py` (extend)

Steps:

- [ ] **Step 1: Write the failing fan-out test.** Append:
```python
def test_build_appraisal_summary_all_users_per_reviewer_columns() -> None:
    import uuid

    from app.services.exports.extraction.appraisal_summary import build_appraisal_summary
    from app.services.extraction_export_service import (
        AppraisalModel,
        AppraisalRow,
        ReviewerDescriptor,
    )

    r1, r2 = uuid.uuid4(), uuid.uuid4()
    reviewers = (
        ReviewerDescriptor(reviewer_id=r1, display_name="Reviewer 1"),
        ReviewerDescriptor(reviewer_id=r2, display_name="Reviewer 2"),
    )
    appraisal = AppraisalModel(
        domain_section_ids=(uuid.uuid4(),),
        domain_labels=("Participants",),
        rows=(
            AppraisalRow(
                article_id=uuid.uuid4(),
                record_label="Gaca, 2011",
                domain_verdicts=("Low",),
                overall="Low",
                per_reviewer_overall={r1: "Low", r2: "High"},
            ),
        ),
    )
    spec = build_appraisal_summary(
        _layout_with_appraisal(appraisal, mode_name="all_users", reviewers=reviewers)
    )
    header = tuple(c.value for c in spec.rows[0])
    # consensus Overall + one Overall column PER reviewer, in reviewer order.
    assert header == (
        "Record",
        "Participants",
        "Overall",
        "Overall — Reviewer 1",
        "Overall — Reviewer 2",
    )
    data = tuple(c.value for c in spec.rows[1])
    assert data == ("Gaca, 2011", "Low", "Low", "Low", "High")


def test_build_appraisal_summary_single_user_one_overall() -> None:
    import uuid

    from app.services.exports.extraction.appraisal_summary import build_appraisal_summary
    from app.services.extraction_export_service import AppraisalModel, AppraisalRow

    appraisal = AppraisalModel(
        domain_section_ids=(uuid.uuid4(),),
        domain_labels=("Participants",),
        rows=(
            AppraisalRow(
                article_id=uuid.uuid4(),
                record_label="Gaca, 2011",
                domain_verdicts=("High",),
                overall="High",  # the single reviewer's rollup
                per_reviewer_overall={},
            ),
        ),
    )
    spec = build_appraisal_summary(
        _layout_with_appraisal(appraisal, mode_name="single_user")
    )
    header = tuple(c.value for c in spec.rows[0])
    assert header == ("Record", "Participants", "Overall")  # no per-reviewer cols
    assert tuple(c.value for c in spec.rows[1]) == ("Gaca, 2011", "High", "High")
```

- [ ] **Step 2: Run it — expect FAIL or PASS.** Run:
  `cd backend && uv run pytest tests/unit/test_extraction_appraisal_summary_builder.py -q -k "all_users or single_user"`
  If the consensus-task implementation already covered `ExportMode.ALL_USERS`, both PASS immediately — that is the intended outcome and confirms the fan-out (no extra code). If `ReviewerDescriptor`'s label attr is named differently (`name` vs `display_name`), this is where it FAILS; fix the attribute reference in the f-string in Step 3.

- [ ] **Step 3: Reconcile the reviewer-label attribute (only if Step 2 failed on attribute name).** Read `ReviewerDescriptor` (`extraction_export_service.py:116-119`) and replace `reviewer.display_name` in both the header f-string and the test fabrication with the real attribute. No behavioural change otherwise.

- [ ] **Step 4: Run the full builder test file — expect PASS:**
  `cd backend && uv run pytest tests/unit/test_extraction_appraisal_summary_builder.py -q`

- [ ] **Step 5: Commit (only if Step 3 changed code; otherwise fold the test into the previous commit before pushing):**
```
test(backend): cover per-reviewer + single-user appraisal Overall

Proves the all-users fan-out emits a consensus Overall plus one Overall
column per reviewer in reviewer order, and single-user emits exactly one
reviewer-scoped Overall (§7).

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
```

---

### Task 60: Compute `AppraisalModel` in `resolve_layout` (QA-template-gated; verdict field selection + per-mode rollup)

**Files:**
- Modify: `backend/app/services/extraction_export_service.py` (`resolve_layout` @255-347 — build `appraisal` and pass to `ExportLayout`; new private `_build_appraisal_model`; load `template.kind`)
- Test: `backend/tests/unit/test_extraction_appraisal_model_resolution.py` (new — pure unit, no DB; drives `_build_appraisal_model` directly with fabricated sections + value_map)

> `_build_appraisal_model` is a **pure** method (no DB): it takes the already-loaded `sections`, `articles`, `reviewers`, `value_map`, and `mode`, and returns `AppraisalModel | None`. `resolve_layout` calls it only when `template.kind == TemplateKind.QUALITY_ASSESSMENT.value`. This keeps the DB-touching surface in `resolve_layout` (which already loads `template`) and lets the rollup logic be unit-tested without Supabase.

Steps:

- [ ] **Step 1: Write the failing pure-resolution test.** Create `backend/tests/unit/test_extraction_appraisal_model_resolution.py`:
```python
"""Pure unit tests for _build_appraisal_model (§7) — no DB."""

from __future__ import annotations

import uuid

from app.models.extraction import (
    ExtractionCardinality,
    ExtractionEntityRole,
    ExtractionFieldType,
)
from app.services.extraction_export_service import (
    ArticleDescriptor,
    ExtractionExportService,
    ExportMode,
    FieldDescriptor,
    ReviewerDescriptor,
    SectionDescriptor,
)


def _field(
    label,
    ftype=ExtractionFieldType.SELECT,
    parent=None,
    allowed_values=("Low", "Unclear", "High"),
):
    return FieldDescriptor(
        field_id=uuid.uuid4(),
        label=label,
        type=ftype,
        allowed_values=allowed_values,
        parent_section_id=parent or uuid.uuid4(),
    )


def _section(label, verdict_field, sort_order):
    sid = uuid.uuid4()
    vf = FieldDescriptor(
        field_id=verdict_field.field_id,
        label=verdict_field.label,
        type=verdict_field.type,
        allowed_values=verdict_field.allowed_values,
        parent_section_id=sid,
    )
    return SectionDescriptor(
        entity_type_id=sid,
        label=label,
        role=ExtractionEntityRole.STUDY_SECTION,
        parent_entity_type_id=None,
        fields=(vf,),
        cardinality=ExtractionCardinality.ONE,
        sort_order=sort_order,
    )


def test_build_appraisal_model_consensus_rollup() -> None:
    d1 = _section("Participants", _field("RoB"), 0)
    d2 = _section("Predictors", _field("RoB"), 1)
    f1 = d1.fields[0].field_id
    f2 = d2.fields[0].field_id

    run_id = uuid.uuid4()
    inst1 = uuid.uuid4()
    inst2 = uuid.uuid4()
    aid = uuid.uuid4()
    article = ArticleDescriptor(
        article_id=aid,
        header_label="Gaca, 2011",
        run_id=run_id,
        run_stage=None,
        version_id=None,
        model_instances=(),
        section_instances={d1.entity_type_id: (inst1,), d2.entity_type_id: (inst2,)},
    )
    # consensus value_map: 3-tuple keys, already-resolved scalars.
    value_map = {
        (run_id, inst1, f1): "Low",
        (run_id, inst2, f2): "High",
    }

    model = ExtractionExportService._build_appraisal_model(
        sections=(d1, d2),
        articles=(article,),
        reviewers=(),
        value_map=value_map,
        mode=ExportMode.CONSENSUS,
    )
    assert model is not None
    assert model.domain_labels == ("Participants", "Predictors")
    assert len(model.rows) == 1
    row = model.rows[0]
    assert row.record_label == "Gaca, 2011"
    assert row.domain_verdicts == ("Low", "High")
    assert row.overall == "High"  # worst-case
    assert row.per_reviewer_overall == {}


def test_build_appraisal_model_all_users_per_reviewer() -> None:
    d1 = _section("Participants", _field("RoB"), 0)
    f1 = d1.fields[0].field_id
    run_id, inst1, aid = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    r1, r2 = uuid.uuid4(), uuid.uuid4()
    reviewers = (
        ReviewerDescriptor(reviewer_id=r1, display_name="R1"),
        ReviewerDescriptor(reviewer_id=r2, display_name="R2"),
    )
    article = ArticleDescriptor(
        article_id=aid,
        header_label="Gaca, 2011",
        run_id=run_id,
        run_stage=None,
        version_id=None,
        model_instances=(),
        section_instances={d1.entity_type_id: (inst1,)},
    )
    # all_users value_map: 4-tuple keys; consensus row uses reviewer_id=None.
    value_map = {
        (run_id, inst1, f1, None): "Low",
        (run_id, inst1, f1, r1): "Low",
        (run_id, inst1, f1, r2): "High",
    }
    model = ExtractionExportService._build_appraisal_model(
        sections=(d1,),
        articles=(article,),
        reviewers=reviewers,
        value_map=value_map,
        mode=ExportMode.ALL_USERS,
    )
    row = model.rows[0]
    assert row.overall == "Low"  # consensus rollup
    assert row.per_reviewer_overall == {r1: "Low", r2: "High"}


def test_build_appraisal_model_none_when_no_select_field() -> None:
    # A QA template whose domains carry no SELECT verdict field -> None (no sheet).
    text_field = _field("Notes", ftype=ExtractionFieldType.TEXT)
    d1 = _section("Free notes", text_field, 0)
    model = ExtractionExportService._build_appraisal_model(
        sections=(d1,),
        articles=(),
        reviewers=(),
        value_map={},
        mode=ExportMode.CONSENSUS,
    )
    assert model is None


def test_build_appraisal_model_skips_signalling_select_picks_risk_label_field() -> None:
    # Mirrors the real seed: SELECT-typed signalling questions precede the
    # risk_of_bias judgment in sort_order. The verdict must be the risk-label
    # SELECT (Low/High/Unclear), NOT the first SELECT (a signalling answer).
    sid = uuid.uuid4()
    signalling = FieldDescriptor(
        field_id=uuid.uuid4(),
        label="q1_1 appropriate data sources",
        type=ExtractionFieldType.SELECT,
        allowed_values=("Y", "PY", "PN", "N", "NI", "NA"),  # _PROBAST_SIGNALING
        parent_section_id=sid,
    )
    risk = FieldDescriptor(
        field_id=uuid.uuid4(),
        label="Risk of bias",
        type=ExtractionFieldType.SELECT,
        allowed_values=("Low", "High", "Unclear"),  # _PROBAST_JUDGMENT
        parent_section_id=sid,
    )
    applicability = FieldDescriptor(
        field_id=uuid.uuid4(),
        label="Applicability concerns",
        type=ExtractionFieldType.SELECT,
        allowed_values=("Low", "High", "Unclear"),
        parent_section_id=sid,
    )
    d1 = SectionDescriptor(
        entity_type_id=sid,
        label="Participants",
        role=ExtractionEntityRole.STUDY_SECTION,
        parent_entity_type_id=None,
        fields=(signalling, risk, applicability),  # signalling first, by sort_order
        cardinality=ExtractionCardinality.ONE,
        sort_order=0,
    )
    run_id, inst, aid = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    article = ArticleDescriptor(
        article_id=aid,
        header_label="Gaca, 2011",
        run_id=run_id,
        run_stage=None,
        version_id=None,
        model_instances=(),
        section_instances={sid: (inst,)},
    )
    # If selection wrongly picked the signalling field, "Y" would be read and
    # ranked maximally severe -> Overall "Y". Keying on the risk-label set
    # reads risk_of_bias instead, so the verdict is the judgment "Low".
    value_map = {
        (run_id, inst, signalling.field_id): "Y",
        (run_id, inst, risk.field_id): "Low",
        (run_id, inst, applicability.field_id): "High",
    }
    model = ExtractionExportService._build_appraisal_model(
        sections=(d1,),
        articles=(article,),
        reviewers=(),
        value_map=value_map,
        mode=ExportMode.CONSENSUS,
    )
    assert model is not None
    row = model.rows[0]
    assert row.domain_verdicts == ("Low",)  # risk_of_bias, not "Y" or "High"
    assert row.overall == "Low"
```

- [ ] **Step 2: Run it — expect FAIL** (`AttributeError: _build_appraisal_model`). Note this test also depends on the grown `ArticleDescriptor` (`version_id`, `section_instances`) and `SectionDescriptor.cardinality` from sibling slices — if those fields are not yet present the test errors on construction, which is the correct RED:
  `cd backend && uv run pytest tests/unit/test_extraction_appraisal_model_resolution.py -q`

- [ ] **Step 3: Implement `_build_appraisal_model` (pure static method).** Add to `ExtractionExportService` (import `AppraisalModel`, `AppraisalRow` are same-module names; import the rollup helper at module top, landing the import atomically):
```python
from app.services.exports.extraction.appraisal_summary import (
    _RISK_LABELS,
    _appraisal_overall,
)
```
```python
    @staticmethod
    def _build_appraisal_model(
        *,
        sections: tuple[SectionDescriptor, ...],
        articles: tuple[ArticleDescriptor, ...],
        reviewers: tuple[ReviewerDescriptor, ...],
        value_map: dict[tuple[Any, ...], Any],
        mode: ExportMode,
    ) -> "AppraisalModel | None":
        """Compute the appraisal roll-up for a quality-assessment template (§7).

        Each domain = one section; its verdict field = the first SELECT-typed
        field in sort_order whose ``allowed_values`` are the risk-label set
        (``{Low, High, Unclear, ...}`` — the recognised severity vocabulary).
        This is NOT "the first SELECT field": signalling questions are also
        SELECT-typed and precede the judgment in sort_order (seed.py), so a
        positional rule would wrongly pick a signalling answer. Keying on the
        risk-label set selects ``risk_of_bias`` (and excludes signalling fields
        whose answer sets are Y/PY/PN/N/... ); among the two judgment fields
        (risk_of_bias, applicability_concerns) the first-in-sort_order tiebreak
        deterministically picks risk_of_bias. The descriptor carries no machine
        ``name``, so selection keys on ``allowed_values``, not the field name.

        Overall = worst-case rollup over the record's domain verdicts.
        Mode-aware:

          * consensus / single_user -> AppraisalRow.overall only (3-tuple keys).
          * all_users -> consensus overall (reviewer_id=None) + one rollup per
            reviewer (4-tuple keys), in ``reviewers`` order.

        Returns None when no domain has a risk-label-set SELECT verdict field
        (no roll-up sheet; the sections still ship as ordinary tidy tables).
        """
        # Verdict field per domain: first SELECT field in sort_order whose
        # allowed_values are the recognised risk-label set (excludes signalling
        # SELECT fields, whose answer sets differ — see _appraisal_overall's
        # severity table for the recognised labels).
        def _is_verdict(field: FieldDescriptor) -> bool:
            if field.type is not ExtractionFieldType.SELECT:
                return False
            labels = [v.strip().lower() for v in field.allowed_values if v.strip()]
            return bool(labels) and all(
                label in _RISK_LABELS for label in labels
            )

        domains: list[tuple[SectionDescriptor, FieldDescriptor]] = []
        for section in sorted(sections, key=lambda s: s.sort_order):
            verdict_field = next(
                (f for f in section.fields if _is_verdict(f)),
                None,
            )
            if verdict_field is not None:
                domains.append((section, verdict_field))
        if not domains:
            return None

        domain_section_ids = tuple(s.entity_type_id for s, _ in domains)
        domain_labels = tuple(s.label for s, _ in domains)
        is_all_users = mode is ExportMode.ALL_USERS

        rows: list[AppraisalRow] = []
        for article in articles:
            run_id = article.run_id
            if run_id is None:
                continue
            consensus_verdicts: list[Any] = []
            per_reviewer_verdicts: dict[UUID, list[Any]] = {
                r.reviewer_id: [] for r in reviewers
            }
            for section, field in domains:
                instance_ids = article.section_instances.get(
                    section.entity_type_id, ()
                )
                instance_id = instance_ids[0] if instance_ids else None
                if is_all_users:
                    consensus_verdicts.append(
                        value_map.get((run_id, instance_id, field.field_id, None))
                    )
                    for reviewer in reviewers:
                        per_reviewer_verdicts[reviewer.reviewer_id].append(
                            value_map.get(
                                (run_id, instance_id, field.field_id, reviewer.reviewer_id)
                            )
                        )
                else:
                    consensus_verdicts.append(
                        value_map.get((run_id, instance_id, field.field_id))
                    )

            per_reviewer_overall = (
                {
                    rid: _appraisal_overall(tuple(verdicts))
                    for rid, verdicts in per_reviewer_verdicts.items()
                }
                if is_all_users
                else {}
            )
            rows.append(
                AppraisalRow(
                    article_id=article.article_id,
                    record_label=article.header_label,
                    domain_verdicts=tuple(consensus_verdicts),
                    overall=_appraisal_overall(tuple(consensus_verdicts)),
                    per_reviewer_overall=per_reviewer_overall,
                )
            )

        return AppraisalModel(
            domain_section_ids=domain_section_ids,
            domain_labels=domain_labels,
            rows=tuple(rows),
        )
```

- [ ] **Step 4: Gate it in `resolve_layout`.** After `template, version = await self._load_active_template_version(template_id)` and after `value_map`/`reviewers` are built, before the `return ExportLayout(...)`, add:
```python
        appraisal: AppraisalModel | None = None
        if template.kind == TemplateKind.QUALITY_ASSESSMENT.value:
            appraisal = self._build_appraisal_model(
                sections=sections,
                articles=tuple(articles),
                reviewers=reviewers,
                value_map=value_map,
                mode=mode,
            )
```
Add `appraisal=appraisal,` to the `ExportLayout(...)` constructor call. Ensure `TemplateKind` is imported in this module (it is re-exported via `app.models`; if not already imported, add `from app.models.extraction_versioning import TemplateKind` atomically).

- [ ] **Step 5: Lint:**
  `cd backend && uv run ruff check app/services/extraction_export_service.py app/services/exports/extraction/appraisal_summary.py && uv run ruff format app/services/extraction_export_service.py`

- [ ] **Step 6: Run the resolution test — expect PASS:**
  `cd backend && uv run pytest tests/unit/test_extraction_appraisal_model_resolution.py -q`

- [ ] **Step 7: Commit:**
```
feat(backend): compute mode-aware appraisal model in resolve_layout

QA-template-gated (kind == quality_assessment). Picks each domain's verdict
field as the first SELECT whose allowed_values are the risk-label set
(Low/High/Unclear...) — not the first SELECT, since signalling questions are
also SELECT-typed and precede the judgment in sort_order. Rolls up worst-case
Overall and fans out one Overall per reviewer in all-users mode (§7). Pure
rollup, DB-free unit tested; layout stays a read-only consumer (no model
change).

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
```

---

### Task 61: Wire `build_appraisal_summary` into the workbook orchestrator at position k+1

**Files:**
- Modify: `backend/app/services/exports/extraction/workbook.py` (insert `build_appraisal_summary` in sheet order after tidy tables, before data dictionary)
- Test: `backend/tests/unit/test_extraction_xlsx_builder.py` (extend — orchestrator sheet-order / conditional-emission)

> The orchestrator (`build_workbook`) and `SheetSpec` rendering come from sibling slices. This task only proves the appraisal sheet lands at the correct ordinal and is omitted when `layout.appraisal is None`. If `workbook.py` does not yet exist when this slice runs, this task's RED is the import error; it goes green once the orchestrator slice lands and this one-line insertion is made — sequence it after the orchestrator task in synthesis.

Steps:

- [ ] **Step 1: Write the failing orchestrator test.** Add to `test_extraction_xlsx_builder.py`:
```python
def test_workbook_emits_appraisal_sheet_after_tidy_tables() -> None:
    """Appraisal sheet appears (k+1) only when layout.appraisal is set."""
    import io
    import uuid

    from openpyxl import load_workbook

    from app.services.exports.extraction.workbook import build_workbook
    from app.services.extraction_export_service import AppraisalModel, AppraisalRow

    # Build the smallest QA layout that yields one appraisal row.
    # (reuse the consensus fixture helper added to the appraisal builder test;
    #  here construct inline to keep this file self-contained.)
    appraisal = AppraisalModel(
        domain_section_ids=(uuid.uuid4(),),
        domain_labels=("Participants",),
        rows=(
            AppraisalRow(
                article_id=uuid.uuid4(),
                record_label="Gaca, 2011",
                domain_verdicts=("High",),
                overall="High",
                per_reviewer_overall={},
            ),
        ),
    )
    layout_with = _minimal_layout(appraisal=appraisal)  # helper in this test module
    wb = load_workbook(io.BytesIO(build_workbook(layout_with)))
    assert "Appraisal summary" in wb.sheetnames

    layout_without = _minimal_layout(appraisal=None)
    wb2 = load_workbook(io.BytesIO(build_workbook(layout_without)))
    assert "Appraisal summary" not in wb2.sheetnames
```
(`_minimal_layout` is the shared test helper this file already uses to construct an `ExportLayout`; extend its signature with an `appraisal=None` kwarg passed straight through to the `ExportLayout(...)` it builds. If the helper does not yet take that kwarg, add it in the same edit.)

- [ ] **Step 2: Run it — expect FAIL** (sheet absent, or import error if orchestrator not yet present):
  `cd backend && uv run pytest tests/unit/test_extraction_xlsx_builder.py -q -k appraisal`

- [ ] **Step 3: Insert the sub-builder in the orchestrator.** In `workbook.py`, where the sheet builders are invoked in order, add the appraisal call between the tidy tables and the data dictionary, honouring the `None` skip (the renderer must already skip `None` specs — this matches the other conditional sheets):
```python
from app.services.exports.extraction.appraisal_summary import build_appraisal_summary
```
```python
        # ... after build_tidy_tables(layout) specs are appended ...
        appraisal_spec = build_appraisal_summary(layout)
        if appraisal_spec is not None:
            _render_sheet_spec(wb.create_sheet(appraisal_spec.title), appraisal_spec)
        # ... then build_data_dictionary(layout) ...
```
(Match the exact rendering idiom the orchestrator uses for the other `SheetSpec | None` sub-builders — `build_dropdown_lists` / `build_ai_metadata` — so the insertion is symmetric.)

- [ ] **Step 4: Lint:**
  `cd backend && uv run ruff check app/services/exports/extraction/workbook.py && uv run ruff format app/services/exports/extraction/workbook.py`

- [ ] **Step 5: Run the orchestrator test — expect PASS:**
  `cd backend && uv run pytest tests/unit/test_extraction_xlsx_builder.py -q -k appraisal`

- [ ] **Step 6: Commit:**
```
feat(backend): emit appraisal-summary sheet at workbook position k+1

Wires build_appraisal_summary into the orchestrator between the tidy
tables and the data dictionary; omitted when layout.appraisal is None
(§4 / §7).

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
```

---

### Task 62: Integration — appraisal sheet against real Supabase (QA template, all three modes)

**Files:**
- Create: `backend/tests/integration/test_extraction_export_appraisal_summary.py` (new)
- Reference patterns: `backend/tests/integration/test_extraction_manual_only_flow.py` (run/instance/proposal/decision setup), `backend/tests/integration/test_extraction_export_ai_outcome_ordering.py` (export-service integration harness, A6)

> Needs local Supabase on :54322 (gitignored `backend/.env` already present in this worktree). Self-seeds via the autouse `SEED` fixture; uses the `db_session` fixture (rollback). **Scope every article/template/instance query by `project_id`** (test-fixture scoping rule).

Steps:

- [ ] **Step 1: Write the failing integration test (consensus + emission gate).** Create `test_extraction_export_appraisal_summary.py` with:
  - a fixture building a **`quality_assessment`** project template (kind `TemplateKind.QUALITY_ASSESSMENT.value`) with two domain `STUDY_SECTION`s (`cardinality='one'`), each holding one `SELECT` verdict field whose `allowed_values` are `[{value:"Low",label:"Low"},{value:"Unclear",label:"Unclear"},{value:"High",label:"High"}]`, an active published version (so `version.schema_` carries the domains), one article, a finalized QA run + instances, and consensus published-state verdicts `Low` / `High` for the two domains (mirror the proposal/decision setup in `test_extraction_manual_only_flow.py`, scoped by `project_id`);
  - assert `ExtractionExportService(...).resolve_layout(..., template_id=<QA template>, mode=ExportMode.CONSENSUS)` returns `layout.appraisal is not None`, `layout.appraisal.domain_labels == (<d1>, <d2>)`, the single row's `domain_verdicts == ("Low", "High")` and `overall == "High"`;
  - assert that resolving the project's **extraction** template (kind `extraction`) under the same fixture yields `layout.appraisal is None` (emission gate).

- [ ] **Step 2: Run it — expect FAIL** (until the QA-gated `resolve_layout` path + `_build_appraisal_model` from the earlier task are in place; if run before those tasks merge, it RED-fails on `layout.appraisal is None`):
  `cd backend && uv run pytest tests/integration/test_extraction_export_appraisal_summary.py -q`

- [ ] **Step 3: No new production code expected.** This test exercises the already-implemented `resolve_layout` QA gate end-to-end against real Postgres (RLS, CHECK constraints, the real `version.schema_` snapshot). If it fails for a reason other than a fixture bug, fix the production path identified (e.g. the verdict value-map key arity or `section_instances` tuple iteration) — do **not** weaken the test.

- [ ] **Step 4: Add the all-users + single-user assertions.** Extend the fixture with a second reviewer's per-coordinate decisions producing divergent verdicts (`r1: Low`, `r2: High` on the same domain), then:
  - `mode=ExportMode.ALL_USERS`: assert `layout.appraisal.rows[0].per_reviewer_overall` has one entry per reviewer (in `layout.reviewers` order) with the correct per-reviewer rollup, and the consensus `overall` matches the published state;
  - `mode=ExportMode.SINGLE_USER, reviewer_id=r2`: assert `overall == "High"` (that reviewer's rollup) and `per_reviewer_overall == {}`.

- [ ] **Step 5: Render-through assertion (workbook bytes).** Build the workbook from the consensus QA layout via `build_workbook(layout)` and assert (via `openpyxl.load_workbook`) that the `"Appraisal summary"` sheet exists, its header row is `("Record", <d1>, <d2>, "Overall")`, and the data row's last cell is the string `"High"` (proves no envelope-dict leak reaches the appraisal cells — the value_map fed already-resolved scalars).

- [ ] **Step 6: Run the full integration file — expect PASS:**
  `cd backend && uv run pytest tests/integration/test_extraction_export_appraisal_summary.py -q`

- [ ] **Step 7: Commit:**
```
test(backend): integration-cover appraisal summary across modes

QA-template export against real Supabase: consensus/all-users/single-user
Overall roll-up, emission gate (extraction template -> no sheet), and a
render-through assertion that resolved verdicts reach the cells (§7).

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
```

---

### Task 63: Determinism coverage for the appraisal sheet

**Files:**
- Modify: `backend/tests/unit/test_extraction_export_determinism.py` (extend with an appraisal case)

> Mirrors the A6 red-green-across-seeds discipline: prove byte-stable output and tie-break stability, not just one happy path.

Steps:

- [ ] **Step 1: Write the failing determinism test.** Add a case that builds an `ExportLayout` carrying an all-users `AppraisalModel` with **tied** worst-case verdicts across two domains (e.g. both `High`) and two reviewers, then asserts:
  - `build_appraisal_summary(layout)` produces an identical `SheetSpec` across repeated calls (rows + header tuple equality), and
  - the `Overall` for a tied record is the **first**-encountered worst verdict (deterministic tie-break per `_appraisal_overall`), and
  - reviewer Overall columns appear in a stable order across 5 reshuffles of the input `reviewers` tuple feeding `_build_appraisal_model` **only when `layout.reviewers` order is held fixed** (the builder preserves `layout.reviewers` order; the model must not re-sort reviewers). Use a seeded RNG loop like the A6 test to shuffle non-order-bearing inputs (article iteration is order-bearing; reviewer column order is fixed by `layout.reviewers`) and assert byte-identical workbook output via `build_workbook`.

- [ ] **Step 2: Run it — expect FAIL** if any nondeterminism exists (e.g. a dict-iteration order leaking into `per_reviewer_overall` rendering):
  `cd backend && uv run pytest tests/unit/test_extraction_export_determinism.py -q -k appraisal`

- [ ] **Step 3: Fix any nondeterminism surfaced.** If RED, the likely cause is iterating `per_reviewer_overall` (a dict) for column order instead of `layout.reviewers`; the builder already iterates `layout.reviewers` (fix it there if not). No new public API.

- [ ] **Step 4: Run the determinism file — expect PASS:**
  `cd backend && uv run pytest tests/unit/test_extraction_export_determinism.py -q -k appraisal`

- [ ] **Step 5: Run the full appraisal + export unit suite as a guard:**
  `cd backend && uv run pytest tests/unit/test_extraction_appraisal_summary_builder.py tests/unit/test_extraction_appraisal_model_resolution.py tests/unit/test_extraction_export_determinism.py -q`

- [ ] **Step 6: Commit:**
```
test(backend): assert appraisal-summary determinism + tie-break

Byte-stable workbook output, first-wins tie-break in the worst-case
rollup, and reviewer-column order pinned to layout.reviewers (§7).

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
```

---

**Slice notes for the synthesizer (sequencing + shared-contract dependencies):**

- **Plan-time decision (Task 1) is load-bearing:** "appraisal layer" ⇔ `TemplateKind.QUALITY_ASSESSMENT`; domain ⇔ QA-template section; verdict ⇔ the domain's first `SELECT` field **whose `allowed_values` are the risk-label set** (`{Low, High, Unclear, ...}`) — NOT the first `SELECT` outright, because signalling questions are SELECT-typed and precede the judgment in `sort_order` (grounded in `backend/app/seed.py:1301-1354`); Overall ⇔ caution-biased worst-case rollup. There is **no** appraisal entity role and **no** per-section flag — confirmed against `backend/app/models/extraction.py` (`ExtractionEntityRole` has only `STUDY_SECTION/MODEL_CONTAINER/MODEL_SECTION`) and `extraction_versioning.py` (`TemplateKind`).
- **Cross-slice dependencies (do not redefine — reference by name):** `SheetSpec`/`Cell`/`CellStyle` (`sheet_spec.py`), `build_workbook`/`_render_sheet_spec` (`workbook.py`), the grown `ArticleDescriptor` (`version_id`, `section_instances: dict[UUID, tuple[UUID,...]]`) and `SectionDescriptor.cardinality`/`sort_order`, and `resolve_value` (the AI/matrix slices delete `_unwrap_value`). The appraisal builder consumes **already-resolved scalars** from `value_map` — it never touches `resolve_value` directly.
- **Sequencing:** Tasks 2→3→4→5→6 are intra-slice ordered. Task 6 (orchestrator wiring) must land **after** the orchestrator slice creates `workbook.py`/`sheet_spec.py`. Tasks 7 (integration) and 8 (determinism) require the grown `ArticleDescriptor`/`SectionDescriptor` from the service-refactor slice; if those land later, Tasks 5/7/8 RED until then (expected, TDD-correct).
- **One open reconciliation:** `ReviewerDescriptor`'s human-label attribute (`display_name` vs `name`) — confirmed at `extraction_export_service.py:116-119` during Task 4 Step 3; all reviewer-label references use the real attribute.
- **No model change, no migration** in this slice — the export is a read-only consumer of the QA template snapshot + value map.


---

## Phase S8 — Frontend consolidation, legacy cascade, column guard, e2e/golden gates

### Task 64: Verify the legacy-cascade dependency graph and lock the keep/delete lists (read + decision)

**Files:**
- Read: `frontend/components/extraction/header/HeaderMoreMenu.tsx` (import @23, `exportOpen` state @70, "Export Data" item @233-236, Export `Dialog` @250-266)
- Read: `frontend/components/extraction/ExtractionHeader.tsx` (props @82-84, pass-through @200-202 / @270-272, `templateId={template?.id}` @205/@275)
- Read: `frontend/pages/ExtractionFullScreen.tsx` (`<ExtractionHeader>` call site @982-1021; passes `templateId={template?.id}` @1007, `template={template}` @1017, `instances={instances}` @1018, no `values`)
- Read: `frontend/lib/copy/extraction.ts` (legacy block @568-595, @699-701; `moreExport*` @299/@302-303)
- Read: `frontend/services/extractionExportService.ts` + `frontend/integrations/api/client.ts`
- Read: `backend/app/services/exports/extraction/workbook.py` (the post-phase-3 orchestrator that owns `build_workbook`)
- Test: none (investigation only)

- [ ] **Step 1: Re-confirm the single mount + cross-referenced copy keys.** Run, from repo root:
  ```bash
  grep -rn "ExtractionExport\b" frontend --include="*.ts" --include="*.tsx" | grep -v "ExtractionExportDialog"
  for k in exportButton instancesCardTitle exportTitle; do echo "== $k =="; grep -rn "'$k'" frontend --include="*.ts" --include="*.tsx" | grep -v "lib/copy/extraction.ts"; done
  ```
  Expected: `ExtractionExport` (the legacy card) appears only in `HeaderMoreMenu.tsx:23` (import) and `ExtractionExport.tsx` (definition). `exportButton` is still referenced by `ExtractionInterface.tsx:264` and `NotificationCenter.tsx:165`; `instancesCardTitle` by `InstanceEditor.tsx:120`; `exportTitle` only by `ExtractionExport.tsx` (and an unrelated `articles.exportTitle` in `NotificationCenter.tsx:414`).
- [ ] **Step 2: Lock the keep/delete decision (no code).** Record in the PR description:
  - **DELETE these 29 `extraction` copy keys** (orphaned with `ExtractionExport.tsx`): `exportNoData`, `exportNoDataHint`, `exportTitle`, `exportSubtitle`, `exportTemplate`, `exportInstances`, `exportInstancesCreated`, `exportValues`, `exportValuesExtracted`, `exportCompleteness`, `exportCompletenessOf`, `exportSettingsTitle`, `exportSettingsDesc`, `exportFormatLabel`, `exportFormatCsv`, `exportFormatCsvDesc`, `exportFormatJson`, `exportFormatJsonDesc`, `exportFormatExcel`, `exportFormatExcelDesc`, `exportIncludeOptions`, `exportIncludeEvidence`, `exportIncludeMetadata`, `exportOnlyComplete`, `exportNoTemplate`, `exportNoTemplateHint`, `dataPreviewTitle`, `dataPreviewDesc`, `valuesLabelShort` — plus the **3 `moreExport*`** keys `moreExportData`, `moreExportDialogTitle`, `moreExportDialogDesc`.
  - **KEEP (still referenced after the card is deleted):** `exportButton`, `instancesCardTitle`.
  - **Cascade decision for `templateId`:** `HeaderMoreMenu` keeps its `templateId?: string` prop (line 44 — needed by AI extraction) and drops `template`/`instances`/`values`. `ExtractionHeader` switches the `templateId={template?.id}` pass-through to `templateId={templateId}` (its own existing prop, line 70) and drops `template`/`instances`/`values`. `ExtractionFullScreen.tsx` already passes `templateId={template?.id}` (line 1007) so the AI path is preserved; only `template={template}` (1017) and `instances={instances}` (1018) are removed at the call site.
  - **Typed-client decision:** `apiClient` returns parsed JSON (`responseData.data`) and cannot return a binary `.xlsx` blob. Add a `apiBlobClient` helper to `frontend/integrations/api/client.ts` (auth + base-url + trace-id, returns `{ blob, filename }` for 200 / `{ async, job_id }` for 202 / throws `ApiError` for ≥400) and route `startExport` through it. This removes the raw `fetch` + `import.meta.env.VITE_API_URL` + `supabase.auth` from the service while keeping the `startExport` signature and `StartExtractionExportResult` shape unchanged (so `ExtractionExportDialog` is untouched).
  - **`generate:api-types`:** NOT required for this slice — no endpoint path or Pydantic request/response model changes (the column guard raises an existing `ValidationError`, already surfaced through the `ApiResponse` envelope).

---

### Task 65: Add the typed binary client helper (`apiBlobClient`) — failing test first

**Files:**
- Modify: `frontend/integrations/api/client.ts` (add `apiBlobClient` after `apiClient`, ~line 218)
- Test: `frontend/integrations/api/__tests__/apiBlobClient.test.ts` (new)

- [ ] **Step 1: Write the failing unit test.** Create `frontend/integrations/api/__tests__/apiBlobClient.test.ts`:
  ```ts
  import { afterEach, describe, expect, it, vi } from 'vitest';
  import { ApiError, apiBlobClient } from '@/integrations/api/client';

  vi.mock('@/integrations/supabase/client', () => ({
    supabase: {
      auth: {
        getSession: vi.fn().mockResolvedValue({
          data: { session: { access_token: 'tok' } },
        }),
      },
    },
  }));

  function res(init: { status: number; headers?: Record<string, string>; body?: BodyInit | null }) {
    return new Response(init.body ?? null, { status: init.status, headers: init.headers });
  }

  describe('apiBlobClient', () => {
    afterEach(() => vi.restoreAllMocks());

    it('returns a sync blob + parsed filename on 200', async () => {
      vi.spyOn(global, 'fetch').mockResolvedValue(
        res({
          status: 200,
          headers: {
            'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'Content-Disposition': 'attachment; filename="charms_export.xlsx"',
          },
          body: 'PK\x03\x04binary',
        }),
      );
      const out = await apiBlobClient('/api/v1/x', { method: 'POST', body: { a: 1 } });
      expect(out.kind).toBe('sync');
      if (out.kind === 'sync') {
        expect(out.filename).toBe('charms_export.xlsx');
        expect(out.blob.size).toBeGreaterThan(0);
      }
    });

    it('returns an async job_id on 202', async () => {
      vi.spyOn(global, 'fetch').mockResolvedValue(
        res({ status: 202, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data: { job_id: 'job-1' } }) }),
      );
      const out = await apiBlobClient('/api/v1/x', { method: 'POST', body: {} });
      expect(out).toEqual({ kind: 'async', job_id: 'job-1' });
    });

    it('throws ApiError carrying error.message on a 422 JSON envelope', async () => {
      vi.spyOn(global, 'fetch').mockResolvedValue(
        res({ status: 422, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: false, error: { code: 'VALIDATION_ERROR', message: 'too many columns' } }) }),
      );
      await expect(apiBlobClient('/api/v1/x', { method: 'POST', body: {} })).rejects.toMatchObject({
        name: 'ApiError',
        message: 'too many columns',
        status: 422,
      });
    });

    it('rejects a 200 that is actually a JSON error', async () => {
      vi.spyOn(global, 'fetch').mockResolvedValue(
        res({ status: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: { message: 'boom' } }) }),
      );
      await expect(apiBlobClient('/api/v1/x', { method: 'POST', body: {} })).rejects.toMatchObject({ message: 'boom' });
    });
  });
  ```
- [ ] **Step 2: Run the test — expect FAIL (import error).** From repo root:
  ```bash
  npm run test:run -- frontend/integrations/api/__tests__/apiBlobClient.test.ts
  ```
  Expected: FAIL — `apiBlobClient` is not exported from `@/integrations/api/client`.
- [ ] **Step 3: Implement `apiBlobClient`.** Insert into `frontend/integrations/api/client.ts` immediately after `apiClient` (before the `// === HELPERS` banner at line 220). Note: no `try/finally` is used here because this is a module-level service function (not a component/hook), but for consistency with the existing `apiClient` pattern it keeps the same try/finally — that file is already excluded from component-compiler scope (it is not a `.tsx` hook/component). Code:
  ```ts
  /**
   * Result of {@link apiBlobClient}: a downloaded blob (200) or a queued
   * async job (202).
   */
  export type ApiBlobResult =
    | { kind: "sync"; blob: Blob; filename: string }
    | { kind: "async"; job_id: string };

  /**
   * Typed binary client for endpoints that return either a 200 `.xlsx`
   * blob (inline download) or a 202 JSON `{ job_id }` (queued job).
   *
   * Same auth / base-url / trace-id wiring as {@link apiClient}, but it
   * does NOT JSON-parse a successful binary body. On any error status it
   * throws {@link ApiError} carrying `error.message` from the envelope —
   * never the FastAPI `detail` field. This replaces the raw `fetch` +
   * `import.meta.env.VITE_API_URL` + `supabase.auth` previously inlined
   * in `extractionExportService` (frontend data-access rule).
   */
  export async function apiBlobClient(
    endpoint: string,
    options: ApiRequestOptions = {},
    fallbackFilename = "download.bin",
  ): Promise<ApiBlobResult> {
    const { body, skipAuth = false, headers: customHeaders = {}, ...fetchOptions } = options;

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "X-Trace-Id": createTraceId(),
      ...Object.fromEntries(
        Object.entries(customHeaders).map(([k, v]) => [k, String(v)]),
      ),
    };

    if (!skipAuth) {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (session?.access_token) {
        headers["Authorization"] = `Bearer ${session.access_token}`;
      } else {
        throw new ApiError("AUTH_REQUIRED", t("common", "errors_authRequired"), 401);
      }
    }

    const response = await fetch(`${API_BASE_URL}${endpoint}`, {
      ...fetchOptions,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    const contentType = (response.headers.get("Content-Type") || "").toLowerCase();

    if (response.status === 200) {
      if (contentType.includes("application/json")) {
        const errBody = await response.json().catch(() => ({}));
        const msg =
          errBody?.error?.message ??
          errBody?.message ??
          t("common", "errors_unknownError");
        throw new ApiError(errBody?.error?.code ?? "UNKNOWN_ERROR", msg, 200);
      }
      const blob = await response.blob();
      const disposition = response.headers.get("Content-Disposition");
      let filename = fallbackFilename;
      if (disposition) {
        const match = /filename="?([^";\n]+)"?/.exec(disposition);
        if (match) filename = match[1].trim();
      }
      return { kind: "sync", blob, filename };
    }

    if (response.status === 202) {
      const data = await response.json().catch(() => ({}));
      const payload = data?.data ?? data;
      const jobId = payload?.job_id;
      if (typeof jobId !== "string") {
        throw new ApiError("INVALID_RESPONSE", "Invalid 202 response: missing job_id", 202);
      }
      return { kind: "async", job_id: jobId };
    }

    const errBody = await response.json().catch(() => ({}));
    const msg =
      errBody?.error?.message ??
      errBody?.message ??
      t("common", "errors_unknownError");
    throw new ApiError(errBody?.error?.code ?? "UNKNOWN_ERROR", msg, response.status);
  }
  ```
- [ ] **Step 4: Run the test — expect PASS.**
  ```bash
  npm run test:run -- frontend/integrations/api/__tests__/apiBlobClient.test.ts
  ```
  Expected: 4 passing.
- [ ] **Step 5: Commit.**
  ```bash
  git add frontend/integrations/api/client.ts frontend/integrations/api/__tests__/apiBlobClient.test.ts
  git commit -m "feat(frontend): add typed apiBlobClient for binary download endpoints

  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
  ```

---

### Task 66: Route `extractionExportService.startExport` through `apiBlobClient` (kill the raw-fetch violation)

**Files:**
- Modify: `frontend/services/extractionExportService.ts` (replace `startExport` body @42-101; drop `supabase` import @10 and `API_BASE_URL` @18-19)
- Test: `frontend/services/__tests__/extractionExportService.test.ts` (new)

- [ ] **Step 1: Write the failing test asserting the service delegates to `apiBlobClient` (no raw fetch).** Create `frontend/services/__tests__/extractionExportService.test.ts`:
  ```ts
  import { describe, expect, it, vi, beforeEach } from 'vitest';

  const apiBlobClient = vi.fn();
  vi.mock('@/integrations/api/client', () => ({ apiBlobClient }));

  import { startExport } from '@/services/extractionExportService';
  import type { ExtractionExportRequest } from '@/types/extraction-export';

  const req: ExtractionExportRequest = {
    mode: 'consensus',
    article_scope: 'current_list',
    include_ai_metadata: false,
    anonymize_reviewer_names: false,
  } as ExtractionExportRequest;

  describe('extractionExportService.startExport', () => {
    beforeEach(() => apiBlobClient.mockReset());

    it('maps a sync blob result to {kind:"sync"}', async () => {
      apiBlobClient.mockResolvedValue({ kind: 'sync', blob: new Blob(['x']), filename: 'e.xlsx' });
      const out = await startExport('proj-1', req);
      expect(apiBlobClient).toHaveBeenCalledWith(
        '/api/v1/projects/proj-1/extraction-export',
        expect.objectContaining({ method: 'POST', body: req }),
        'extraction_export.xlsx',
      );
      expect(out).toEqual({ kind: 'sync', blob: expect.any(Blob), filename: 'e.xlsx' });
    });

    it('maps an async result to {kind:"async"}', async () => {
      apiBlobClient.mockResolvedValue({ kind: 'async', job_id: 'job-9' });
      const out = await startExport('proj-1', req);
      expect(out).toEqual({ kind: 'async', job_id: 'job-9' });
    });

    it('forwards the AbortSignal', async () => {
      apiBlobClient.mockResolvedValue({ kind: 'async', job_id: 'j' });
      const ctrl = new AbortController();
      await startExport('proj-1', req, ctrl.signal);
      expect(apiBlobClient).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ signal: ctrl.signal }),
        expect.any(String),
      );
    });
  });
  ```
- [ ] **Step 2: Run — expect FAIL.**
  ```bash
  npm run test:run -- frontend/services/__tests__/extractionExportService.test.ts
  ```
  Expected: FAIL — the current `startExport` calls `fetch`/`supabase.auth`, not the mocked `apiBlobClient` (assertions on `apiBlobClient` never satisfied).
- [ ] **Step 3: Rewrite `startExport` and the file header.** Replace lines 1-101 of `frontend/services/extractionExportService.ts` with:
  ```ts
  /**
   * Extraction export API client.
   *
   * All backend calls go through the typed client
   * (`frontend/integrations/api/client.ts`): `apiBlobClient` for the
   * binary POST start-export (200 blob | 202 job), and `apiClient` for
   * status/cancel. No raw `fetch`, `import.meta.env.VITE_API_URL`, or
   * `supabase.auth` in this service (frontend data-access rule).
   */

  import { apiBlobClient, apiClient } from "@/integrations/api/client";
  import type {
      ExtractionExportCancelResult,
      ExtractionExportRequest,
      ExtractionExportStatus,
      StartExtractionExportResult,
  } from "@/types/extraction-export";

  function endpointBase(projectId: string): string {
      return `/api/v1/projects/${encodeURIComponent(projectId)}/extraction-export`;
  }

  function statusEndpoint(projectId: string, jobId: string): string {
      return `${endpointBase(projectId)}/status/${encodeURIComponent(jobId)}`;
  }

  /**
   * Start an extraction export.
   *
   * Returns:
   *   - {kind:"sync", blob, filename} when the backend chose the sync
   *     path (≤ 50 articles, no AI metadata, mode ∈ {consensus, single_user}).
   *   - {kind:"async", job_id} when the backend queued the job; the caller
   *     should push a BackgroundJob and poll via `getExportStatus`.
   *
   * On error, throws `ApiError` carrying the `error.message` from the API
   * envelope (NEVER the FastAPI `detail` field). Callers surface this in
   * an inline banner.
   */
  export async function startExport(
      projectId: string,
      request: ExtractionExportRequest,
      signal?: AbortSignal,
  ): Promise<StartExtractionExportResult> {
      const result = await apiBlobClient(
          endpointBase(projectId),
          { method: "POST", body: request, signal },
          "extraction_export.xlsx",
      );
      if (result.kind === "sync") {
          return { kind: "sync", blob: result.blob, filename: result.filename };
      }
      return { kind: "async", job_id: result.job_id };
  }
  ```
  Leave `getExportStatus`/`cancelExport` (lines 103-124) unchanged (they already use `apiClient`).
- [ ] **Step 4: Run — expect PASS.**
  ```bash
  npm run test:run -- frontend/services/__tests__/extractionExportService.test.ts
  ```
  Expected: 3 passing.
- [ ] **Step 5: Guard the rule with a grep + commit.**
  ```bash
  grep -nE "import\.meta\.env\.VITE_API_URL|supabase\.auth|fetch\(" frontend/services/extractionExportService.ts || echo "clean"
  ```
  Expected: `clean`. Then:
  ```bash
  git add frontend/services/extractionExportService.ts frontend/services/__tests__/extractionExportService.test.ts
  git commit -m "refactor(frontend): route extraction export through the typed client

  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
  ```

---

### Task 67: Cut the legacy mount in `HeaderMoreMenu.tsx` (import, menu item, Dialog, dead props)

**Files:**
- Modify: `frontend/components/extraction/header/HeaderMoreMenu.tsx` (import @23; `Dialog*` import @20 — keep, still used by shortcuts dialog; props @34-38; `exportOpen` @70; `handleExport` @120-122; menu item @233-236; Export Dialog @250-266)
- Test: `frontend/components/extraction/header/__tests__/HeaderMoreMenu.test.tsx` (new)

- [ ] **Step 1: Write the failing regression test (no "Export Data" item, no `ExtractionExport` import).** Create `frontend/components/extraction/header/__tests__/HeaderMoreMenu.test.tsx`:
  ```tsx
  import { describe, expect, it, vi } from 'vitest';
  import { render, screen } from '@testing-library/react';
  import userEvent from '@testing-library/user-event';
  import { MemoryRouter } from 'react-router-dom';
  import { HeaderMoreMenu } from '@/components/extraction/header/HeaderMoreMenu';

  vi.mock('@/hooks/extraction/useFullAIExtraction', () => ({
    useFullAIExtraction: () => ({ extractFullAI: vi.fn(), loading: false, progress: null }),
  }));
  vi.mock('@/hooks/extraction/ai/useRunAIExtraction', () => ({
    useRunAIExtraction: () => ({ extractForRun: vi.fn(), loading: false }),
  }));
  vi.mock('@/hooks/hitl/useHITLProjectTemplates', () => ({
    useHITLProjectTemplates: () => ({ globalTemplates: [], loading: false }),
  }));

  function renderMenu() {
    return render(
      <MemoryRouter>
        <HeaderMoreMenu projectId="proj-1" articleId="art-1" templateId="tpl-1" />
      </MemoryRouter>,
    );
  }

  describe('HeaderMoreMenu (post legacy-cascade)', () => {
    it('opens without an "Export Data" item', async () => {
      renderMenu();
      await userEvent.click(screen.getByRole('button', { name: /more/i }));
      expect(screen.queryByText(/Export Data/i)).not.toBeInTheDocument();
      // Shortcuts + Help survive.
      expect(screen.getByText(/Keyboard Shortcuts/i)).toBeInTheDocument();
    });
  });
  ```
  Plus an import-graph assertion that the legacy card is gone:
  ```bash
  # (run in Step 4) the source must not import ExtractionExport.
  ```
- [ ] **Step 2: Run — expect FAIL.**
  ```bash
  npm run test:run -- frontend/components/extraction/header/__tests__/HeaderMoreMenu.test.tsx
  ```
  Expected: FAIL — the "Export Data" `DropdownMenuItem` is still rendered, so `queryByText(/Export Data/i)` finds it.
- [ ] **Step 3: Remove the import (line 23).**
  - Delete: `import {ExtractionExport} from '@/components/extraction/ExtractionExport';`
- [ ] **Step 4: Trim the now-dead types import (line 27).** Change
  ```ts
  import type {ExtractionValueDisplay, ExtractionInstance, ProjectExtractionTemplate} from '@/types/extraction';
  ```
  to remove `ExtractionValueDisplay`/`ExtractionInstance`/`ProjectExtractionTemplate` if they become unused after the prop drop. After Step 5/6/7 they are unused, so delete the entire line 27 import.
- [ ] **Step 5: Drop the dead props from the interface (lines 31-38).** Remove the `template`, `instances`, `values` members and their doc-comments, leaving:
  ```ts
  interface HeaderMoreMenuProps {
    /** Project id (kept for symmetry / future scoped actions). */
    projectId: string;
    /** Compact mode (icon only). */
    compact?: boolean;
    /** Article id for AI extraction. */
    articleId?: string;
    /** Template id for AI extraction. */
    templateId?: string;
  ```
  (keep `runId`, `onExtractionComplete`, `onExtractionStateChange` as-is).
- [ ] **Step 6: Drop the params + `exportOpen` state + `handleExport`.** In the destructure (lines 58-69) remove `template`, `instances = []`, `values = []`. Remove `const [exportOpen, setExportOpen] = useState(false);` (line 70) and the `handleExport` function (lines 120-122).
- [ ] **Step 7: Remove the "Export Data" menu item and the Export `Dialog`.**
  - Delete the `<DropdownMenuItem onClick={handleExport}>…{t('extraction', 'moreExportData')}…</DropdownMenuItem>` block (lines 233-236).
  - Delete the `{/* Export Dialog */}` `<Dialog open={exportOpen} …>…<ExtractionExport …/></Dialog>` block (lines 250-266).
  - Remove the now-unused `Download` icon from the `lucide-react` import (line 22) if no other usage remains (verify with grep).
- [ ] **Step 8: Run the component test + the React-Compiler-sensitive build path.**
  ```bash
  npm run test:run -- frontend/components/extraction/header/__tests__/HeaderMoreMenu.test.tsx
  grep -n "ExtractionExport\b" frontend/components/extraction/header/HeaderMoreMenu.tsx || echo "no legacy import"
  ```
  Expected: test passes; grep prints `no legacy import`. (The file has no `try/finally` — compiler-safe.)
- [ ] **Step 9: Commit.**
  ```bash
  git add frontend/components/extraction/header/HeaderMoreMenu.tsx frontend/components/extraction/header/__tests__/HeaderMoreMenu.test.tsx
  git commit -m "refactor(frontend): cut the legacy export mount from HeaderMoreMenu

  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
  ```

---

### Task 68: Drop the dead `template`/`instances`/`values` props in `ExtractionHeader.tsx` + the `ExtractionFullScreen` pass-through

**Files:**
- Modify: `frontend/components/extraction/ExtractionHeader.tsx` (types import @20; props @82-84; destructure @122-124; `HeaderMoreMenu` pass-through @200-202 (mobile) / @270-272 (desktop); `templateId={template?.id}` @205/@275)
- Modify: `frontend/pages/ExtractionFullScreen.tsx` (`template={template}` @1017, `instances={instances}` @1018)
- Test: extend `frontend/components/extraction/header/__tests__/HeaderMoreMenu.test.tsx` is N/A; add `frontend/components/extraction/__tests__/ExtractionHeader.exports.test.tsx` (new, type-level + render smoke)

- [ ] **Step 1: Write a failing render-smoke test asserting the header forwards `templateId` (not `template`) and renders no export item.** Create `frontend/components/extraction/__tests__/ExtractionHeader.exports.test.tsx`:
  ```tsx
  import { describe, expect, it, vi } from 'vitest';
  import { render, screen } from '@testing-library/react';
  import userEvent from '@testing-library/user-event';
  import { MemoryRouter } from 'react-router-dom';
  import { ExtractionHeader } from '@/components/extraction/ExtractionHeader';

  vi.mock('@/hooks/use-mobile', () => ({ useIsMobile: () => false }));
  vi.mock('@/hooks/extraction/useFullAIExtraction', () => ({
    useFullAIExtraction: () => ({ extractFullAI: vi.fn(), loading: false, progress: null }),
  }));
  vi.mock('@/hooks/extraction/ai/useRunAIExtraction', () => ({
    useRunAIExtraction: () => ({ extractForRun: vi.fn(), loading: false }),
  }));
  vi.mock('@/hooks/hitl/useHITLProjectTemplates', () => ({
    useHITLProjectTemplates: () => ({ globalTemplates: [], loading: false }),
  }));

  const base = {
    projectId: 'p', projectName: 'P', articleTitle: 'A', onBack: vi.fn(),
    articles: [{ id: 'art-1', title: 'A' }], currentArticleId: 'art-1', onNavigateToArticle: vi.fn(),
    completedFields: 0, totalFields: 0, completionPercentage: 0,
    showPDF: false, onTogglePDF: vi.fn(), viewMode: 'extract' as const, onViewModeChange: vi.fn(),
    hasOtherExtractions: false, isComplete: false, onFinalize: vi.fn(),
    templateId: 'tpl-1',
  };

  describe('ExtractionHeader (post legacy-cascade)', () => {
    it('renders the More menu without an Export Data item', async () => {
      render(<MemoryRouter><ExtractionHeader {...base} /></MemoryRouter>);
      await userEvent.click(screen.getByRole('button', { name: /more/i }));
      expect(screen.queryByText(/Export Data/i)).not.toBeInTheDocument();
    });
  });
  ```
- [ ] **Step 2: Run — expect FAIL or TYPE error.**
  ```bash
  npm run test:run -- frontend/components/extraction/__tests__/ExtractionHeader.exports.test.tsx
  ```
  Expected: FAIL — before the prop drop, `HeaderMoreMenu` still renders the "Export Data" item (the previous task removed it, so if that task already merged this passes; if running this slice in order it fails because the header still passes `template`/`instances`/`values` which TS now rejects after the `HeaderMoreMenu` interface change). Either way the build/test is red until the header is updated.
- [ ] **Step 3: Update the types import (line 20).** Remove `ExtractionValueDisplay`, `ExtractionInstance`, `ProjectExtractionTemplate` from the `@/types/extraction` import. Keep the line only if another symbol remains (none does in this file → delete line 20 entirely).
- [ ] **Step 4: Drop the three interface members (lines 81-84).** Remove the `// Data for export (Zone 4 - More menu)` comment block and the `template?`, `instances?`, `values?` props.
- [ ] **Step 5: Drop them from the destructure (lines 122-124).** Remove `template,`, `instances = [],`, `values = [],` from the `const {...} = props;` block.
- [ ] **Step 6: Fix both `HeaderMoreMenu` call sites (mobile @198-209, desktop @268-279).** In each, remove `template={template}`, `instances={instances}`, `values={values}` and change `templateId={template?.id}` to `templateId={templateId}` (the header's own prop, line 70). Result per call site:
  ```tsx
  <HeaderMoreMenu
    projectId={projectId}
    compact={true}            /* or false on desktop */
    articleId={currentArticleId}
    templateId={templateId}
    runId={props.runId}
    onExtractionComplete={props.onRefreshInstances}
    onExtractionStateChange={props.onExtractionStateChange}
  />
  ```
- [ ] **Step 7: Remove the dead pass-through at the `ExtractionFullScreen` call site.** In `frontend/pages/ExtractionFullScreen.tsx`, delete `template={template}` (line 1017) and `instances={instances}` (line 1018). Keep `templateId={template?.id}` (line 1007) and `templateName={template?.name}` (line 1008). Verify `template`/`instances` are still used elsewhere in that file (they are — passed to the body views), so no unused-var fallout.
- [ ] **Step 8: Run the test + typecheck the touched files.**
  ```bash
  npm run test:run -- frontend/components/extraction/__tests__/ExtractionHeader.exports.test.tsx
  npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "ExtractionHeader|ExtractionFullScreen|HeaderMoreMenu" || echo "types clean for touched files"
  ```
  Expected: test passes; `types clean for touched files`.
- [ ] **Step 9: Commit.**
  ```bash
  git add frontend/components/extraction/ExtractionHeader.tsx frontend/pages/ExtractionFullScreen.tsx frontend/components/extraction/__tests__/ExtractionHeader.exports.test.tsx
  git commit -m "refactor(frontend): drop dead export props from ExtractionHeader cascade

  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
  ```

---

### Task 69: Delete `ExtractionExport.tsx` and the 32 orphaned copy keys

**Files:**
- Delete: `frontend/components/extraction/ExtractionExport.tsx`
- Modify: `frontend/lib/copy/extraction.ts` (delete @299, @302-303, @569-595, @699-701; KEEP `exportButton` @573? — see Step 2; KEEP `instancesCardTitle` @720)
- Test: reuse the existing copy-key consistency check; add `frontend/lib/copy/__tests__/extraction.legacyKeys.test.ts` (new)

- [ ] **Step 1: Write a failing test asserting the legacy keys are gone and the kept keys survive.** Create `frontend/lib/copy/__tests__/extraction.legacyKeys.test.ts`:
  ```ts
  import { describe, expect, it } from 'vitest';
  import { extraction } from '@/lib/copy/extraction';

  const REMOVED = [
    'exportNoData','exportNoDataHint','exportTitle','exportSubtitle','exportTemplate',
    'exportInstances','exportInstancesCreated','exportValues','exportValuesExtracted',
    'exportCompleteness','exportCompletenessOf','exportSettingsTitle','exportSettingsDesc',
    'exportFormatLabel','exportFormatCsv','exportFormatCsvDesc','exportFormatJson',
    'exportFormatJsonDesc','exportFormatExcel','exportFormatExcelDesc','exportIncludeOptions',
    'exportIncludeEvidence','exportIncludeMetadata','exportOnlyComplete','exportNoTemplate',
    'exportNoTemplateHint','dataPreviewTitle','dataPreviewDesc','valuesLabelShort',
    'moreExportData','moreExportDialogTitle','moreExportDialogDesc',
  ] as const;
  const KEPT = ['exportButton', 'instancesCardTitle'] as const;

  describe('extraction copy — legacy export keys removed', () => {
    it.each(REMOVED)('removed: %s', (k) => {
      expect(k in extraction).toBe(false);
    });
    it.each(KEPT)('kept (still referenced): %s', (k) => {
      expect(k in extraction).toBe(true);
    });
  });
  ```
- [ ] **Step 2: Run — expect FAIL.**
  ```bash
  npm run test:run -- frontend/lib/copy/__tests__/extraction.legacyKeys.test.ts
  ```
  Expected: FAIL — every `REMOVED` key still present, so `expect(... ).toBe(false)` fails.
- [ ] **Step 3: Delete the legacy card.**
  ```bash
  git rm frontend/components/extraction/ExtractionExport.tsx
  ```
- [ ] **Step 4: Delete the orphaned copy keys.** In `frontend/lib/copy/extraction.ts`:
  - Delete `moreExportData` (line 299), `moreExportDialogTitle` (line 302), `moreExportDialogDesc` (line 303).
  - Delete the entire `// ExtractionExport` block lines 568-595 **EXCEPT keep `exportButton`** (still used by `ExtractionInterface.tsx:264` + `NotificationCenter.tsx:165`). Concretely: delete `exportNoData`, `exportNoDataHint`, `exportTitle`, `exportSubtitle`, `exportTemplate`, `exportInstances`, `exportInstancesCreated`, `exportValues`, `exportValuesExtracted`, `exportCompleteness`, `exportCompletenessOf`, `exportSettingsTitle`, `exportSettingsDesc`, `exportFormatLabel`, `exportFormatCsv`, `exportFormatCsvDesc`, `exportFormatJson`, `exportFormatJsonDesc`, `exportFormatExcel`, `exportFormatExcelDesc`, `exportIncludeOptions`, `exportIncludeEvidence`, `exportIncludeMetadata`, `exportOnlyComplete`, `exportNoTemplate`, `exportNoTemplateHint` (and the now-stale `// ExtractionExport` comment).
  - Delete the second `// ExtractionExport` block: `dataPreviewTitle` (699), `dataPreviewDesc` (700), `valuesLabelShort` (701). **KEEP `instancesCardTitle` (line 720)** — used by `InstanceEditor.tsx:120`.
- [ ] **Step 5: Run the new test + the full copy-consistency suite + a usage grep.**
  ```bash
  npm run test:run -- frontend/lib/copy/__tests__/extraction.legacyKeys.test.ts
  grep -rnE "'(exportNoData|exportFormatCsv|dataPreviewTitle|moreExportData)'" frontend --include="*.tsx" --include="*.ts" | grep -v lib/copy/extraction.ts || echo "no dangling refs"
  ```
  Expected: test passes; `no dangling refs`.
- [ ] **Step 6: Typecheck (catches any missed `t('extraction', 'export…')` literal that no longer resolves).**
  ```bash
  npx tsc --noEmit -p tsconfig.json 2>&1 | grep -iE "extraction.ts|export" | head || echo "types clean"
  ```
  Expected: `types clean`.
- [ ] **Step 7: Commit.**
  ```bash
  git add frontend/lib/copy/extraction.ts frontend/components/extraction/ExtractionExport.tsx frontend/lib/copy/__tests__/extraction.legacyKeys.test.ts
  git commit -m "chore(frontend): delete legacy ExtractionExport card and orphaned copy keys

  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
  ```

---

### Task 70: Strip stale `NotImplementedError`/US2/US3 docstrings + dead `else` in `extraction_export_service.py`

**Files:**
- Modify: `backend/app/services/extraction_export_service.py` (module docstring @15-17; `resolve_layout` docstring @268-269; `reviewer_id` noqa comment @264; dead `else` @313-314)
- Test: `backend/tests/unit/test_extraction_export_service_docstrings.py` (new, lightweight static guard) + reuse the existing service unit tests as the behavioural gate

- [ ] **Step 1: Write a failing static-text guard test.** Create `backend/tests/unit/test_extraction_export_service_docstrings.py`:
  ```python
  """Guard: the export service carries no stale US1/US2/US3 / NotImplementedError scaffolding."""

  from __future__ import annotations

  import inspect

  from app.services import extraction_export_service as svc


  def test_no_stale_scaffolding_text() -> None:
      source = inspect.getsource(svc)
      banned = [
          "NotImplementedError",
          "until US2/US3",
          "US1 = consensus",
          "US1 covers the Consensus branch",
          "used in US2",
      ]
      for needle in banned:
          assert needle not in source, f"stale scaffolding text present: {needle!r}"
  ```
- [ ] **Step 2: Run — expect FAIL.** From `backend/`:
  ```bash
  uv run pytest tests/unit/test_extraction_export_service_docstrings.py -q
  ```
  Expected: FAIL — `NotImplementedError` and the US strings are still present.
- [ ] **Step 3: Rewrite the module docstring (lines 1-18).** Replace the `Architectural notes` US-bullet (lines 15-17) so the docstring reads:
  ```python
  """Extraction Export Service.

  Orchestrator for the publication-ready extraction `.xlsx` download.
  Resolves the in-memory ``ExportLayout`` and hands bytes-production off
  to the pure sub-builders in ``app.services.exports.extraction``.

  Architectural notes:
  * Layered per constitution §I: this service only orchestrates; SQL goes
    through repositories and direct ``select()`` statements that respect
    RLS via the injected ``AsyncSession``. No HTTP types cross the
    boundary.
  * Bulk reads only — no per-cell N+1. Every value-map builder issues at
    most a fixed small number of queries regardless of article count.
  * All three value-source modes (Consensus, Single-user, All-users) are
    fully implemented.
  """
  ```
- [ ] **Step 4: Fix the `resolve_layout` docstring + `reviewer_id` comment.**
  - Line 264: change `reviewer_id: UUID | None = None,  # noqa: ARG002 — used in US2` to `reviewer_id: UUID | None = None,` (the arg is now genuinely used by the single-user branch, so the `noqa` is obsolete; if ruff still flags it because the keyword arg is only read in one branch, keep a plain `# noqa: ARG002` with no US reference).
  - Lines 268-269: replace the docstring body with:
    ```python
    """Build the in-memory layout for an export request.

    Dispatches on ``mode`` across the Consensus, Single-user, and
    All-users branches; each resolves its eligible articles and value
    map and returns a fully-populated ``ExportLayout``.
    """
    ```
- [ ] **Step 5: Remove the dead `else` (lines 313-314).** Since `ExportMode` is a `StrEnum` and all three members are handled by the `if/elif/elif`, the trailing `else: raise NotImplementedError(...)` is unreachable. Replace the `elif mode is ExportMode.ALL_USERS:` chain's terminal `else` with nothing — i.e. delete lines 313-314:
  ```python
  #            value_map = await self._build_all_users_value_map(...)
  #        else:
  #            raise NotImplementedError(f"resolve_layout: unknown mode={mode.value}.")
  ```
  Convert the final `elif mode is ExportMode.ALL_USERS:` to remain an `elif` (keep it explicit; do not collapse to `else`, so an unexpected mode raises naturally via the unbound `value_map`/`articles` only if a 4th member is ever added — instead, to stay fail-loud, change the last `elif` to:
  ```python
  else:  # ExportMode.ALL_USERS — the only remaining member
      articles, omitted = await self._resolve_articles_for_all_users(...)
      ...
  ```
  Pick exactly one: keep the explicit `elif ALL_USERS` + add `else: raise AssertionError(f"unhandled export mode: {mode!r}")` (loud, no `NotImplementedError`), OR the `else: # ALL_USERS` form. **Chosen: explicit `elif` + `else: raise AssertionError(...)`** so a future enum member fails loudly in tests rather than silently skipping.) Final shape:
  ```python
  elif mode is ExportMode.ALL_USERS:
      articles, omitted = await self._resolve_articles_for_all_users(...)
      reviewers = await self._list_reviewers_for_runs(...)
      value_map = await self._build_all_users_value_map(...)
  else:  # pragma: no cover — exhaustive over ExportMode
      raise AssertionError(f"unhandled export mode: {mode!r}")
  ```
- [ ] **Step 6: Update the docstring guard test to reflect the chosen `AssertionError`.** In `test_extraction_export_service_docstrings.py`, the `banned` list already excludes `AssertionError`, so no change needed; but add a positive assertion that the exhaustiveness guard text is present:
  ```python
  def test_exhaustive_mode_guard_present() -> None:
      source = inspect.getsource(svc)
      assert "unhandled export mode" in source
  ```
- [ ] **Step 7: Run the guard + the existing service unit tests + lint.** From `backend/`:
  ```bash
  uv run pytest tests/unit/test_extraction_export_service_docstrings.py -q
  uv run pytest tests/unit/test_extraction_export_service.py -q
  uv run ruff check app/services/extraction_export_service.py
  ```
  Expected: guard passes; existing service tests still green; ruff clean.
- [ ] **Step 8: Commit.**
  ```bash
  git add backend/app/services/extraction_export_service.py backend/tests/unit/test_extraction_export_service_docstrings.py
  git commit -m "chore(backend): strip stale US1/US2/US3 scaffolding from export service

  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
  ```

---

### Task 71: Strip US1/US2/US3/T042/SC-003 scaffolding comments in the builder package

**Files:**
- Modify: `backend/app/services/exports/extraction/workbook.py` and `matrix.py` and `ai_metadata.py` (the lifted-verbatim comments from the old `extraction_xlsx_builder.py`: `US1/US2/US3` @106-108/@116, `SC-003` @48, `T042` @305 in the original; their lifted locations in the split package)
- Test: `backend/tests/unit/test_builder_no_scaffolding_comments.py` (new)

- [ ] **Step 1: Write a failing static-text guard across the package.** Create `backend/tests/unit/test_builder_no_scaffolding_comments.py`:
  ```python
  """Guard: the extraction xlsx builder package carries no US/T042/SC scaffolding comments."""

  from __future__ import annotations

  from pathlib import Path

  import app.services.exports.extraction as pkg

  BANNED = ("US1", "US2", "US3", "T042", "SC-003")


  def test_builder_package_has_no_scaffolding_comments() -> None:
      pkg_dir = Path(pkg.__file__).parent
      offenders: list[str] = []
      for py in sorted(pkg_dir.rglob("*.py")):
          text = py.read_text(encoding="utf-8")
          for needle in BANNED:
              if needle in text:
                  offenders.append(f"{py.name}: {needle}")
      assert not offenders, f"scaffolding text present: {offenders}"
  ```
- [ ] **Step 2: Run — expect FAIL.** From `backend/`:
  ```bash
  uv run pytest tests/unit/test_builder_no_scaffolding_comments.py -q
  ```
  Expected: FAIL — `matrix.py`/`workbook.py`/`ai_metadata.py` still carry the lifted `US1`/`US3`/`T042`/`SC-003` comments.
- [ ] **Step 3: Remove the scaffolding comments.**
  - In `workbook.py`: drop any `Sheet order (FR-007)` US references and the `SC-003 only requires the structural skeleton` styling comment (the styling is now a real publication layout, not a skeleton).
  - In `matrix.py`: rewrite the `reviewer_axis is the per-(article, model)…For US1/US2 it's a single sentinel…For US3 it's [None, reviewer_id…]` comment (lifted lines 106-108) to a mode-neutral description:
    ```python
    # ``reviewer_axis`` is the per-(article, model) sub-column list:
    # ``[None]`` for consensus / single-user (one column), or
    # ``[None, reviewer_id, reviewer_id, ...]`` for all-users where
    # ``None`` is the consensus sub-column.
    ```
    and drop `(US3 only)` from the header-row comment (line 116).
  - In `ai_metadata.py`: drop the `(T042 — full implementation lands in US1 AI sub-flow)` section banner (it is fully implemented now).
- [ ] **Step 4: Run the guard + ruff.** From `backend/`:
  ```bash
  uv run pytest tests/unit/test_builder_no_scaffolding_comments.py -q
  uv run ruff check app/services/exports/extraction/
  ```
  Expected: guard passes; ruff clean.
- [ ] **Step 5: Commit.**
  ```bash
  git add backend/app/services/exports/extraction/ backend/tests/unit/test_builder_no_scaffolding_comments.py
  git commit -m "chore(backend): strip US/T042/SC scaffolding comments from xlsx builder

  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
  ```

---

### Task 72: Add the Excel 16,384-column guard (pre-build, fail-loud)

**Files:**
- Modify: `backend/app/services/exports/extraction/workbook.py` (`build_workbook` — guard before any sheet is rendered)
- Modify: `backend/app/services/extraction_export_service.py` (import note: the guard raises `ValidationError` from `app.core.error_handler`, already imported as `AppError`; add `ValidationError` to the existing import @32 if the guard lives in the service — but per §5.5 the guard is in the **builder**, which must stay pure/no-`app.core` HTTP coupling → raise a plain `ValueError` subclass defined in the builder package and let the service/endpoint translate it)
- Test: `backend/tests/unit/test_extraction_export_column_guard.py` (new)

- [ ] **Step 1: Decide the error type (pure-builder constraint).** The builder package is pure (no DB/storage/network) but may import from `app.core.error_handler` since that is not IO. However, to keep the builder framework-agnostic and avoid an HTTP-shaped error leaking into a pure module, define a dedicated exception in the package:
  - In `backend/app/services/exports/extraction/workbook.py` (or `sheet_spec.py`), add:
    ```python
    #: Excel hard limit on worksheet columns (XLSX spec).
    EXCEL_MAX_COLUMNS = 16_384


    class ExportTooWideError(ValueError):
        """Raised pre-build when a sheet would exceed Excel's 16,384-column limit."""
    ```
  The endpoint layer already maps unexpected `ValueError`/`AppError` into the envelope; add an explicit translation in the export endpoint/service so the user sees `error.message` (see Step 5).
- [ ] **Step 2: Write the failing unit test.** Create `backend/tests/unit/test_extraction_export_column_guard.py`:
  ```python
  """§5.5 — pre-build column guard against Excel's 16,384-column hard limit."""

  from __future__ import annotations

  from datetime import UTC, datetime
  from uuid import uuid4

  import pytest

  from app.models.extraction import ExtractionEntityRole, ExtractionFieldType
  from app.services.exports.extraction.workbook import (
      EXCEL_MAX_COLUMNS,
      ExportTooWideError,
      build_workbook,
  )
  from app.services.extraction_export_service import (
      ArticleDescriptor,
      ExportLayout,
      ExportMode,
      ExportNotes,
      FieldDescriptor,
      SectionDescriptor,
  )


  def _wide_layout(*, n_articles: int, n_subcols_each: int) -> ExportLayout:
      """A layout whose matrix would need n_articles * n_subcols_each data
      columns (+2 label columns) — used to drive the guard over the limit."""
      sec_id = uuid4()
      field = FieldDescriptor(
          field_id=uuid4(),
          label="F",
          type=ExtractionFieldType.TEXT,
          allowed_values=(),
          parent_section_id=sec_id,
      )
      section = SectionDescriptor(
          entity_type_id=sec_id,
          label="Sec",
          role=ExtractionEntityRole.STUDY_SECTION,
          parent_entity_type_id=None,
          fields=(field,),
          cardinality=__import__("app.models.extraction", fromlist=["ExtractionCardinality"]).ExtractionCardinality.MANY,
      )
      articles = tuple(
          ArticleDescriptor(
              article_id=uuid4(),
              header_label=f"A{i}",
              run_id=uuid4(),
              run_stage=None,
              version_id=uuid4(),
              model_instances=(),
              section_instances={sec_id: tuple(uuid4() for _ in range(n_subcols_each))},
          )
          for i in range(n_articles)
      )
      return ExportLayout(
          project_name="P",
          template_name="T",
          template_version=1,
          sections=(section,),
          articles=articles,
          reviewers=(),
          mode=ExportMode.CONSENSUS,
          include_ai_metadata=False,
          anonymize_reviewer_names=False,
          notes=ExportNotes(
              omitted_articles_by_stage={},
              template_version_label="T v1",
              export_mode_label="consensus",
              generated_at=datetime(2026, 6, 14, tzinfo=UTC),
          ),
          value_map={},
      )


  def test_guard_raises_when_columns_exceed_excel_limit() -> None:
      # 500 articles × 100 instance sub-columns each = 50,000 data columns > 16,384.
      layout = _wide_layout(n_articles=500, n_subcols_each=100)
      with pytest.raises(ExportTooWideError) as exc:
          build_workbook(layout)
      msg = str(exc.value)
      assert str(EXCEL_MAX_COLUMNS) in msg or "16,384" in msg
      # Actionable hint for the user.
      assert "columns" in msg.lower()


  def test_guard_allows_a_layout_at_the_boundary() -> None:
      # 2 label cols + 16,382 data cols == 16,384 exactly → allowed.
      layout = _wide_layout(n_articles=1, n_subcols_each=16_382)
      # Should not raise the column guard (may be slow but must build).
      data = build_workbook(layout)
      assert data[:2] == b"PK"
  ```
- [ ] **Step 3: Run — expect FAIL.** From `backend/`:
  ```bash
  uv run pytest tests/unit/test_extraction_export_column_guard.py -q
  ```
  Expected: FAIL — `ExportTooWideError`/`EXCEL_MAX_COLUMNS` not importable yet (and `build_workbook` would crash deep in openpyxl rather than raising the guard).
- [ ] **Step 4: Implement the guard in `build_workbook`.** At the top of `build_workbook(layout)` in `workbook.py`, before constructing the `Workbook`, compute the widest sheet's column count and raise:
  ```python
  def _matrix_column_count(layout: ExportLayout) -> int:
      """Total matrix columns = 2 label columns + one data column per
      (article, instance sub-column) at the export grain. Mirrors the
      matrix sub-builder's fan-out (§5.2/§5.4) without building it."""
      label_cols = 2  # section + field
      data_cols = 0
      for article in layout.articles:
          subcols = 0
          for section in layout.sections:
              instances = article.section_instances.get(section.entity_type_id, ())
              # MANY → one sub-column per instance; ONE → a single column.
              subcols = max(subcols, len(instances) if instances else 1)
          # Reviewer-axis fan-out (all-users): × (1 consensus + n reviewers).
          reviewer_factor = (len(layout.reviewers) + 1) if layout.mode is ExportMode.ALL_USERS else 1
          data_cols += max(subcols, 1) * reviewer_factor
      return label_cols + data_cols


  def build_workbook(layout: ExportLayout) -> bytes:
      """Build the publication-ready export workbook bytes for the layout.

      Raises ``ExportTooWideError`` if the widest sheet would exceed
      Excel's hard 16,384-column limit (§5.5) — a clear, pre-build error
      instead of an opaque openpyxl crash mid-write.
      """
      widest = _matrix_column_count(layout)
      if widest > EXCEL_MAX_COLUMNS:
          raise ExportTooWideError(
              f"This export needs {widest:,} columns, which exceeds Excel's "
              f"limit of {EXCEL_MAX_COLUMNS:,} columns. Narrow the article "
              f"scope, switch from all-users to consensus mode, or split the "
              f"export into smaller batches."
          )
      wb = Workbook()
      ...
  ```
  (Keep the rest of the orchestrator — render each `SheetSpec` in spec order — unchanged.)
- [ ] **Step 5: Translate the guard error in the export service/endpoint to the envelope.** In `extraction_export_service.py`, wherever `build_workbook(layout)` is invoked (the bytes-production call), let `ExportTooWideError` propagate and translate it to a `ValidationError` (HTTP 422, envelope `error.message`) at the call boundary. Add to the existing `from app.core.error_handler import (...)` (line 32): `ValidationError`. At the build call site:
  ```python
  from app.services.exports.extraction.workbook import ExportTooWideError, build_workbook
  ...
  try:
      data = build_workbook(layout)
  except ExportTooWideError as exc:
      raise ValidationError(str(exc)) from exc
  ```
  (This `try/except` is in a backend service — no React-Compiler constraint applies; backend may use try/except freely.)
- [ ] **Step 6: Run the guard test + ruff.** From `backend/`:
  ```bash
  uv run pytest tests/unit/test_extraction_export_column_guard.py -q
  uv run ruff check app/services/exports/extraction/workbook.py app/services/extraction_export_service.py
  ```
  Expected: 2 passing; ruff clean. (If the boundary test is too slow at 16,382 columns, mark it `@pytest.mark.slow` and assert the guard math via `_matrix_column_count` directly instead of a full build.)
- [ ] **Step 7: Commit.**
  ```bash
  git add backend/app/services/exports/extraction/workbook.py backend/app/services/extraction_export_service.py backend/tests/unit/test_extraction_export_column_guard.py
  git commit -m "feat(backend): guard extraction export against Excel's 16,384-column limit

  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
  ```

---

### Task 73: Extend the determinism test to the new sheets + a 500×100 column-guard case

**Files:**
- Modify: `backend/tests/unit/test_extraction_export_determinism.py` (retarget the `build_workbook` import to the package; add new-sheet structural-equality assertions; add the 500×100 guard case)
- Test: same file

- [ ] **Step 1: Add the failing extensions.** In `test_extraction_export_determinism.py`:
  - Change the import `from app.services.exports.extraction_xlsx_builder import build_workbook` to `from app.services.exports.extraction.workbook import ExportTooWideError, build_workbook`.
  - Extend `_fixed_layout()` to populate the new resolved projections so the new sheets actually render: `tidy_tables`, `data_dictionary`, `front_matter`, and (None) `appraisal` — using one `TidyTable`/`FieldDictEntry`/`FrontMatter` with hard-coded UUIDs so two builds are structurally identical.
  - Add a new test that asserts structural ZIP-entry equality across two builds **including** the new sheet XML parts (extend the existing "ignore docProps + generated_at line" allow-list to also ignore the `generated_at` cell on the README/Methods front-matter sheet):
    ```python
    def test_new_sheets_are_structurally_deterministic() -> None:
        layout = _fixed_layout()
        a = _structural_entries(build_workbook(layout))
        b = _structural_entries(build_workbook(layout))
        assert a == b
        # The new sheets are present.
        names = _sheet_titles(build_workbook(layout))
        assert "Data dictionary" in names
        assert any(n.startswith("README") or "Methods" in n for n in names)
    ```
    (Reuse/define `_structural_entries` and `_sheet_titles` helpers consistent with the file's existing ZIP-diff approach.)
  - Add the 500×100 guard case:
    ```python
    def test_500x100_all_users_exceeds_column_guard() -> None:
        # 500 articles × 100 reviewer/instance sub-columns each blows past 16,384.
        layout = _wide_all_users_layout(n_articles=500, subcols_each=100)
        with pytest.raises(ExportTooWideError):
            build_workbook(layout)
    ```
    where `_wide_all_users_layout` reuses the `_wide_layout` builder pattern from `test_extraction_export_column_guard.py` (copy the helper locally or import it).
- [ ] **Step 2: Run — expect FAIL.** From `backend/`:
  ```bash
  uv run pytest tests/unit/test_extraction_export_determinism.py -q
  ```
  Expected: FAIL — import path stale and/or the new-sheet assertions/`_wide_all_users_layout` not yet defined.
- [ ] **Step 3: Implement the helpers + layout extensions** (the `_fixed_layout` projection population, `_structural_entries`, `_sheet_titles`, `_wide_all_users_layout`) as complete code in the test file.
- [ ] **Step 4: Run — expect PASS.** From `backend/`:
  ```bash
  uv run pytest tests/unit/test_extraction_export_determinism.py -q
  ```
  Expected: all green (existing + new cases).
- [ ] **Step 5: Commit.**
  ```bash
  git add backend/tests/unit/test_extraction_export_determinism.py
  git commit -m "test(backend): extend export determinism to new sheets + 500x100 column guard

  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
  ```

---

### Task 74: Golden-structure assertions per sheet against the seeded CHARMS project (integration)

**Files:**
- Create: `backend/tests/integration/test_extraction_export_golden_structure.py` (new; uses the autouse `SEED` fixture + `db_session`; scopes by `project_id`)
- Test: same file

- [ ] **Step 1: Write the failing golden-structure integration test.** Create `backend/tests/integration/test_extraction_export_golden_structure.py` mirroring the run/instance/proposal setup pattern in `test_extraction_manual_only_flow.py`, scoping all queries by `project_id`. It resolves a real consensus layout for the seeded CHARMS project, builds the workbook, and asserts the **sheet inventory + per-sheet header structure** (not values):
  ```python
  """Golden-structure assertions for the publication-ready export against
  the seeded CHARMS project. Structure only (sheet set + header rows), so
  the test is stable across seed-value churn. Scopes by project_id."""

  from __future__ import annotations

  import io

  import pytest
  from openpyxl import load_workbook

  from app.services.exports.extraction.workbook import build_workbook
  from app.services.extraction_export_service import ExportMode, ExtractionExportService

  pytestmark = pytest.mark.integration


  async def _charms_layout(db_session, seed):
      svc = ExtractionExportService(db=db_session, storage=...)  # mirror manual-only-flow construction
      return await svc.resolve_layout(
          project_id=seed.project_id,
          template_id=seed.charms_template_id,
          mode=ExportMode.CONSENSUS,
          article_ids=seed.charms_article_ids,
          include_ai_metadata=True,
          anonymize_reviewer_names=False,
      )


  async def test_workbook_has_the_expected_sheet_inventory(db_session, seed):
      layout = await _charms_layout(db_session, seed)
      wb = load_workbook(io.BytesIO(build_workbook(layout)))
      titles = wb.sheetnames
      # README/Methods first, Data dictionary present, AI metadata last (toggle on).
      assert titles[0].startswith("README") or "Methods" in titles[0]
      assert "Summary" in titles
      assert "Data dictionary" in titles
      assert titles[-1] == "AI metadata"
      # At least one tidy table per CHARMS section.
      assert len([t for t in titles if t not in {"Summary", "Data dictionary", "AI metadata"}]) >= 2


  async def test_data_dictionary_header_is_canonical(db_session, seed):
      layout = await _charms_layout(db_session, seed)
      wb = load_workbook(io.BytesIO(build_workbook(layout)))
      ws = wb["Data dictionary"]
      header = [c.value for c in ws[1]]
      assert header[:8] == [
          "Section", "Field", "Type", "Unit",
          "Description", "Allowed values", "Required", "Allow other",
      ]


  async def test_matrix_label_columns_are_section_and_field(db_session, seed):
      layout = await _charms_layout(db_session, seed)
      wb = load_workbook(io.BytesIO(build_workbook(layout)))
      # The matrix sheet is named after the template; find it by exclusion.
      reserved = {"Summary", "Data dictionary", "AI metadata"}
      matrix = next(ws for ws in wb.worksheets if ws.title not in reserved and not ws.title.startswith("README"))
      assert matrix.cell(row=1, column=1).value in {"Section", "Sec"}
      assert matrix.cell(row=1, column=2).value == "Field"
  ```
  (Resolve the exact `ExtractionExportService` constructor + the `seed` fixture's CHARMS accessors from `test_extraction_manual_only_flow.py` when writing — the placeholders `seed.charms_*` map to whatever that file already exposes; reuse its setup helper rather than re-seeding.)
- [ ] **Step 2: Run — expect FAIL.** From `backend/` (needs local Supabase on :54322):
  ```bash
  uv run pytest tests/integration/test_extraction_export_golden_structure.py -q
  ```
  Expected: FAIL — the new sheets (Summary / Data dictionary / tidy tables / README) do not yet exist in the orchestrator output until phases 3-5 land; running this slice last (phase 8) they exist, so the failure is the as-yet-unwritten test asserting the canonical header order (which the test now pins).
- [ ] **Step 3: Align the assertions with the real sub-builder output.** Run the build once, inspect `wb.sheetnames` and `ws[1]` header values, and tighten each `assert` to the actual canonical labels emitted by `data_dictionary.py` / `matrix.py` / `front_matter.py`. (Do not weaken to `in` checks where an exact header is knowable — golden means exact.)
- [ ] **Step 4: Run — expect PASS.** From `backend/`:
  ```bash
  uv run pytest tests/integration/test_extraction_export_golden_structure.py -q
  ```
  Expected: green.
- [ ] **Step 5: Commit.**
  ```bash
  git add backend/tests/integration/test_extraction_export_golden_structure.py
  git commit -m "test(backend): golden per-sheet structure assertions against seeded CHARMS

  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
  ```

---

### Task 75: Update the e2e flow for the single consolidated dialog (legacy-menu regression guard)

**Files:**
- Modify: `frontend/e2e/flows/extraction-export.e2e.ts` (UI-flow section @260-372)
- Test: same file (Playwright)

- [ ] **Step 1: Add a failing regression assertion that the legacy "Export Data" menu item is gone.** In the UI-flow `describe` block of `extraction-export.e2e.ts`, add:
  ```ts
  test("the More menu no longer offers a legacy Export Data item", async ({ page }) => {
    const env = loadE2EEnv();
    await loginViaUi(page);
    await page.goto(`${env.frontendUrl}/projects/${env.projectId}?tab=extraction`);

    // Open the header "More options" menu.
    await page.getByRole("button", { name: /more/i }).click();
    // Legacy entry is gone; the single dialog is reached via the toolbar button.
    await expect(page.getByRole("menuitem", { name: /Export Data/i })).toHaveCount(0);
    // The consolidated entry point still works.
    await page.keyboard.press("Escape");
    await page.getByTestId("extraction-export-button").click();
    await expect(page.getByText(/Export extraction data/i)).toBeVisible();
  });
  ```
- [ ] **Step 2: Run — expect FAIL only if the frontend cascade is not yet applied locally; otherwise PASS.** From repo root (local stack up):
  ```bash
  npm run test:e2e:local -- extraction-export
  ```
  Expected: with the `HeaderMoreMenu` cut already merged in this slice, this test should PASS; if run against an un-cut build it FAILS (the `menuitem` exists). This is the red→green guard for the cascade.
- [ ] **Step 3: Confirm the existing UI-flow tests still pass unchanged.** The tests at lines 276-372 already drive `extraction-export-button` (the kept `ExtractionExportDialog`) and the `Export extraction data` heading — no rewrite needed. Verify none reference `moreExportDialogTitle` / `Export Extracted Data` (the deleted legacy heading):
  ```bash
  grep -n "Export Extracted Data\|moreExport" frontend/e2e/flows/extraction-export.e2e.ts || echo "no legacy heading refs"
  ```
  Expected: `no legacy heading refs`.
- [ ] **Step 4: Run the full export e2e flow.** From repo root:
  ```bash
  npm run test:e2e:local -- extraction-export
  ```
  Expected: all export e2e tests green (API + UI + the new regression guard).
- [ ] **Step 5: Commit.**
  ```bash
  git add frontend/e2e/flows/extraction-export.e2e.ts
  git commit -m "test(e2e): guard against the legacy Export Data menu item

  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
  ```

---

### Task 76: Final slice gate — full quality scan + dead-reference sweep

**Files:**
- Test: repo-wide gates (no new files)

- [ ] **Step 1: Backend lint + the new unit/integration tests.** From `backend/`:
  ```bash
  uv run ruff check app/services/exports/extraction/ app/services/extraction_export_service.py
  uv run pytest tests/unit/test_extraction_export_column_guard.py tests/unit/test_extraction_export_determinism.py tests/unit/test_extraction_export_service_docstrings.py tests/unit/test_builder_no_scaffolding_comments.py -q
  uv run pytest tests/integration/test_extraction_export_golden_structure.py -q
  ```
  Expected: ruff clean; all green.
- [ ] **Step 2: Frontend lint + unit + the deleted-symbol sweep.** From repo root:
  ```bash
  npm run lint
  npm run test:run -- frontend/integrations/api/__tests__/apiBlobClient.test.ts frontend/services/__tests__/extractionExportService.test.ts frontend/components/extraction/header/__tests__/HeaderMoreMenu.test.tsx frontend/components/extraction/__tests__/ExtractionHeader.exports.test.tsx frontend/lib/copy/__tests__/extraction.legacyKeys.test.ts
  grep -rn "ExtractionExport\b" frontend --include="*.ts" --include="*.tsx" | grep -v "ExtractionExportDialog" || echo "no legacy card references"
  ```
  Expected: lint clean; all suites green; `no legacy card references`.
- [ ] **Step 3: Confirm no `generate:api-types` drift was introduced.** Since this slice changes no endpoint path or Pydantic request/response model, the generated contract must be unchanged. From repo root:
  ```bash
  npm run generate:api-types
  git diff --quiet frontend/types/api/openapi.json frontend/types/api/schema.d.ts && echo "api-types unchanged (expected)" || echo "UNEXPECTED api-types drift — investigate before merge"
  ```
  Expected: `api-types unchanged (expected)`. (If the column-guard `ValidationError` surfaced through a new response field, the diff would appear — it should not.)
- [ ] **Step 4: Run the deterministic quality gate.** From repo root:
  ```bash
  make quality-scan
  ```
  Expected: lint + typecheck + tests + architectural fitness all pass (the layered-arch check confirms the builder package stays IO-free and the typed-client rule holds). Note the known false-positive: stale-worktree eslint "No tsconfigRootDir" noise is environmental — ignore if all real checks pass.
- [ ] **Step 5: No commit (gate only).** If any gate fails, fix in the owning task above and re-run; do not introduce baseline-grandfathering. This slice leaves zero legacy export code behind.

---

Slice authored. Key plan-time findings the synthesizer must preserve, surfaced from reading the real code:

- **Copy-key keep list correction:** the spec says "29 legacy + 3 `moreExport*`" keys, but `exportButton` and `instancesCardTitle` are still referenced after `ExtractionExport.tsx` is deleted (`ExtractionInterface.tsx:264`, `NotificationCenter.tsx:165`, `InstanceEditor.tsx:120`) — they must NOT be removed. The 29-key delete list is enumerated in the copy-key task.
- **`templateId` cascade hazard:** `ExtractionHeader` currently derives `templateId={template?.id}` from the `template` prop being dropped; the AI-extraction path needs it. The fix routes the header's existing `templateId?: string` prop (line 70) through to `HeaderMoreMenu` instead, and `ExtractionFullScreen.tsx` already passes `templateId={template?.id}` (line 1007), so only `template=`/`instances=` are removed at the call site.
- **Typed-client gap:** `apiClient` returns parsed JSON (`responseData.data`) and cannot return the sync `.xlsx` blob; a new `apiBlobClient` helper in `frontend/integrations/api/client.ts` is required to honor the typed-client rule while preserving `startExport`'s signature (so `ExtractionExportDialog` is untouched).
- **Pure-builder error type:** the column guard must raise a package-local `ExportTooWideError(ValueError)` (not an `app.core` HTTP error) to keep the builder framework-agnostic; the service translates it to `ValidationError` (422) at the build call boundary.
- **e2e already on the single dialog:** the UI flow drives `extraction-export-button` (kept dialog), not the legacy menu — so the e2e change is an added regression guard that the "Export Data" menuitem is gone, plus a `grep` that no `moreExport*`/"Export Extracted Data" heading remains.
- **No `generate:api-types` run needed** for this slice (no endpoint/schema change); the final gate asserts zero contract drift.
- **Backend gate import path:** once the `extraction/` package replaces `extraction_xlsx_builder.py` (earlier phases), this slice's tests import `build_workbook` from `app.services.exports.extraction.workbook`.


---
