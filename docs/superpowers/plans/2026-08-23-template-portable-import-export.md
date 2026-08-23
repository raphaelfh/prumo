---
status: in_progress
last_reviewed: 2026-08-23
owner: '@raphaelfh'
---

# Portable template import/export — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Spec:** `docs/superpowers/specs/2026-08-23-template-portable-import-export-design.md` (approved 2026-08-23). Read it first; this plan only says *how*.

**Goal:** A manager can export an extraction template's live structure as a `prumo-template@1` JSON file, import such a file as a new active project template, switch between the project's templates, and delete an inactive one — all from the template dialog — with every backend guard proven by tests.

**Architecture:** One Pydantic model is the format (`app/schemas/template_portable.py`); one service holds both directions side by side (`template_portable_service.py`: `to_portable` / `import_portable`); a sibling-deactivation helper promoted out of the clone service is shared by clone, import, and the fixed `set_template_active`; a small `template_delete_service.py` owns the guarded delete. The frontend adds two composable panes to the existing `ImportTemplateDialog` and an Export button to the config command bar; the browser never validates the document.

**Tech Stack:** FastAPI + SQLAlchemy 2.0 async + Pydantic v2 (backend); React 19 + TanStack Query + shadcn (frontend); pytest against local Supabase Postgres; vitest; Playwright.

## Global Constraints

- English only for code, comments, commits, copy keys.
- No SQLAlchemy model changes ⇒ **no Alembic migration** in this slice. Verify at the end: `git diff --stat origin/dev -- backend/app/models/ backend/alembic/` is empty.
- Tests must never `clean_project_clones` the **primary** seed project: other test files create runs there and the `RESTRICT` FKs would fail the wipe. Use `SEED.secondary_project` for clean-slate tests; build on the primary project's live rows (idempotent `clone_charms` + `resolve_or_create_extract_run`) when a run is needed.
- Layering (`scripts/fitness/check_layered_arch.py`): `api → services → repositories → models`; `app/schemas/*` imports nothing from `app.models`.
- Responses use the `ApiResponse` envelope with a typed Pydantic model — never `ApiResponse[dict[str, Any]]`.
- Every project-scoped endpoint is guarded by `require_project_manager` (BOLA).
- Frontend services return `ErrorResult<T>` via `toResult`; they never throw across the boundary and never toast.
- All user-facing text through `frontend/lib/copy/`; the noun "Run" never appears in copy values.
- React Compiler: no `try/finally` or `throw` inside `try` in component/hook bodies.
- After any endpoint or schema change: `npm run generate:api-types` and commit the diff (`api-contract` CI job).
- Icon-only buttons: shadcn `Tooltip` (`TooltipTrigger asChild`) + `aria-label`, text from copy.
- Worktree: `/Users/raphael/PycharmProjects/prumo/.claude/worktrees/portable-template-import-export`, branch `worktree-portable-template-import-export`. Frontend tooling runs from this worktree root (deps resolve from the parent checkout). Backend commands run from `<worktree>/backend` with `uv run`.
- Tests run against the shared local Supabase — **never** `make db-fresh` / `make reset-db` (another session shares it). Never run two backend pytest processes concurrently (advisory-lock hang).
- Conventional commits; commit after every task.

---

## File structure

**Backend — create**

| File | Responsibility |
| --- | --- |
| `backend/app/schemas/template_portable.py` | The `prumo-template@1` format: `PortableField`, `PortableSection`, `PortableTemplate`, structural validators, `PORTABLE_FORMAT_VERSION`. |
| `backend/app/services/template_portable_service.py` | `parse_portable_document`, `to_portable`, `import_portable`; the three typed 422 import errors. |
| `backend/app/services/template_delete_service.py` | `delete_template` with the two typed 409 guards. |
| `backend/tests/unit/test_template_portable_schema.py` | Pure-Pydantic format tests. |
| `backend/tests/integration/test_template_portable_service.py` | Round-trip + import lifecycle + rejection-writes-nothing. |
| `backend/tests/integration/test_template_delete_service.py` | Delete guards + cascade. |
| `backend/tests/integration/test_template_portable_endpoints.py` | HTTP smoke: routing + auth + BOLA through the real ASGI stack. |
| `backend/tests/unit/test_project_templates_portable_endpoints_unit.py` | Direct endpoint-coroutine tests (diff-cover ASGI blind spot). |

**Backend — modify**

| File | Change |
| --- | --- |
| `backend/app/services/project_template_active_service.py` | Add module-level `deactivate_sibling_extraction_templates`; call it on activation. |
| `backend/app/services/template_clone_service.py` | Delete the private `_deactivate_sibling_extraction_templates`; call the shared helper (2 sites). |
| `backend/app/schemas/hitl_session.py` | `TemplateImportRefusalCode`, `TemplateDeleteRefusalCode`, `TemplateDeleteResponse`. |
| `backend/app/api/v1/endpoints/project_templates.py` | `GET …/export`, `POST …/import`, `DELETE …/{template_id}`. |
| `backend/tests/integration/test_project_template_active_service.py` | Sibling-deactivation regression test. |
| `frontend/types/api/openapi.json`, `frontend/types/api/schema.d.ts` | Regenerated. |
| `docs/reference/extraction-hitl-architecture.md` | §4.3 paragraph on file import/export + delete. |

**Frontend — create**

| File | Responsibility |
| --- | --- |
| `frontend/lib/download.ts` | `triggerDownload(blob, filename)` (extracted from `ArticlesExportDialog`). |
| `frontend/components/extraction/dialogs/ProjectTemplatesList.tsx` | "This project's templates": rows, Switch, Delete + confirm. |
| `frontend/components/extraction/dialogs/ImportTemplateFilePane.tsx` | "Add from a file": input, Import, error list, trust copy. |
| `frontend/components/extraction/dialogs/ProjectTemplatesList.test.tsx`, `ImportTemplateFilePane.test.tsx`, `frontend/services/templateImportService.test.ts`, `frontend/components/extraction/TemplateConfigEditor.export.test.tsx` | vitest. |
| `frontend/e2e/flows/template-portable.ui.e2e.ts` | Playwright: export → import → switch → delete. |

**Frontend — modify**

| File | Change |
| --- | --- |
| `frontend/services/templateImportService.ts` | `exportTemplate`, `importTemplateFromFile`, `deleteTemplate`, `templateExportFilename`. |
| `frontend/lib/copy/extraction.ts` | New keys (listed in Task 6). |
| `frontend/components/articles/ArticlesExportDialog.tsx` | Import `triggerDownload` from `@/lib/download` instead of the private copy. |
| `frontend/components/extraction/dialogs/ImportTemplateDialog.tsx` | Compose the two panes; retitle; `onTemplateImported` → `onTemplatesChanged`. |
| `frontend/components/extraction/TemplateConfigEditor.tsx` | Export button + draft confirm; `Download` → `Upload` icon; callback rename. |
| `frontend/components/extraction/ExtractionInterface.tsx` | Callback rename. |

---

### Task 1: The portable format (Pydantic model)

**Files:**
- Create: `backend/app/schemas/template_portable.py`
- Test: `backend/tests/unit/test_template_portable_schema.py`

**Interfaces:**
- Consumes: `FieldName`, `FieldType`, `AllowedValues`, `AllowedUnits`, `SectionName`, `SectionLabel`, `SectionEntryLabel` from `app/schemas/template_structure.py` (they exist today).
- Produces: `PORTABLE_FORMAT_VERSION: Literal[1]`, `PortableField`, `PortableSection`, `PortableTemplate`, `Framework = Literal["CHARMS", "PICOS", "CUSTOM"]`. Attribute names: `PortableField.field_type` (alias `type`), `.is_required` (alias `required`); `PortableSection.is_required` (alias `required`), `.repeats: bool`, `.group: bool`, `.entry_label`, `.fields`, `.sections`; `PortableTemplate.sections`, `.llm_template_instruction`, `.framework`, `.version`, `.kind`, `.prumo_template`. Construct **by alias** (`PortableField(type="text", required=True, ...)`), read by attribute. Serialize with `model_dump(by_alias=True, exclude_defaults=True)`.

- [ ] **Step 1: Write the failing tests**

```python
# backend/tests/unit/test_template_portable_schema.py
"""Pure-Pydantic tests for the prumo-template@1 format (no DB).

The structural rules live in model validators so a file can never express a
role/parent combination the DB would reject; every rule here has a test.
"""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from app.schemas.template_portable import (
    PORTABLE_FORMAT_VERSION,
    PortableField,
    PortableSection,
    PortableTemplate,
)


def _doc(**overrides):
    base = {
        "prumo_template": 1,
        "kind": "extraction",
        "name": "T",
        "sections": [
            {"name": "s1", "label": "S1", "fields": [{"name": "f1", "label": "F1", "type": "text"}]},
        ],
    }
    base.update(overrides)
    return base


def test_format_version_constant() -> None:
    assert PORTABLE_FORMAT_VERSION == 1


def test_minimal_document_parses_with_defaults() -> None:
    doc = PortableTemplate.model_validate(_doc())
    assert doc.framework == "CUSTOM"
    assert doc.version == "1.0.0"
    assert doc.sections[0].group is False
    assert doc.sections[0].repeats is False
    assert doc.sections[0].fields[0].field_type == "text"
    assert doc.sections[0].fields[0].is_required is False


def test_dump_uses_file_keys_and_omits_defaults() -> None:
    doc = PortableTemplate.model_validate(_doc())
    dumped = doc.model_dump(by_alias=True, exclude_defaults=True)
    assert dumped == {
        "prumo_template": 1,
        "kind": "extraction",
        "name": "T",
        "sections": [
            {"name": "s1", "label": "S1", "fields": [{"name": "f1", "label": "F1", "type": "text"}]}
        ],
    }


def test_field_constructed_by_alias_reads_by_attribute() -> None:
    f = PortableField(name="f", label="F", type="select", required=True, allowed_values=["a"])
    assert f.field_type == "select"
    assert f.is_required is True


@pytest.mark.parametrize(
    ("sections", "needle"),
    [
        # nested sections under a non-group
        (
            [{"name": "s", "label": "S", "sections": [{"name": "c", "label": "C"}]}],
            "sections are only allowed inside a group",
        ),
        # two groups
        (
            [
                {"name": "g1", "label": "G1", "group": True},
                {"name": "g2", "label": "G2", "group": True},
            ],
            "at most one group",
        ),
        # nesting deeper than one level
        (
            [
                {
                    "name": "g",
                    "label": "G",
                    "group": True,
                    "sections": [
                        {"name": "c", "label": "C", "sections": [{"name": "d", "label": "D"}]}
                    ],
                }
            ],
            "only one level",
        ),
        # group inside a group
        (
            [
                {
                    "name": "g",
                    "label": "G",
                    "group": True,
                    "sections": [{"name": "c", "label": "C", "group": True}],
                }
            ],
            "group must be a root section",
        ),
        # duplicate field name within a section
        (
            [
                {
                    "name": "s",
                    "label": "S",
                    "fields": [
                        {"name": "f", "label": "A", "type": "text"},
                        {"name": "f", "label": "B", "type": "text"},
                    ],
                }
            ],
            "duplicate field name",
        ),
        # bad field name pattern
        (
            [{"name": "s", "label": "S", "fields": [{"name": "Bad", "label": "B", "type": "text"}]}],
            "String should match pattern",
        ),
        # unknown field type
        (
            [{"name": "s", "label": "S", "fields": [{"name": "f", "label": "B", "type": "blob"}]}],
            "Input should be",
        ),
        # validation_schema is not a format key (spec §4.4)
        (
            [
                {
                    "name": "s",
                    "label": "S",
                    "fields": [
                        {"name": "f", "label": "B", "type": "text", "validation_schema": {"x": 1}}
                    ],
                }
            ],
            "Extra inputs are not permitted",
        ),
    ],
)
def test_structural_rejections(sections, needle) -> None:
    with pytest.raises(ValidationError) as exc:
        PortableTemplate.model_validate(_doc(sections=sections))
    assert needle in str(exc.value)


def test_same_named_sibling_sections_are_legal() -> None:
    doc = PortableTemplate.model_validate(
        _doc(sections=[{"name": "s", "label": "A"}, {"name": "s", "label": "B"}])
    )
    assert [s.label for s in doc.sections] == ["A", "B"]


def test_group_defaults_entry_label_to_model() -> None:
    doc = PortableTemplate.model_validate(
        _doc(sections=[{"name": "g", "label": "G", "group": True}])
    )
    assert doc.sections[0].entry_label == "model"


def test_non_group_entry_label_is_rejected() -> None:
    with pytest.raises(ValidationError) as exc:
        PortableTemplate.model_validate(
            _doc(sections=[{"name": "s", "label": "S", "entry_label": "x"}])
        )
    assert "entry_label is only allowed on a group" in str(exc.value)


def test_wrong_kind_and_version_are_rejected_by_the_model() -> None:
    with pytest.raises(ValidationError):
        PortableTemplate.model_validate(_doc(kind="quality_assessment"))
    with pytest.raises(ValidationError):
        PortableTemplate.model_validate(_doc(prumo_template=2))


def test_size_caps() -> None:
    too_many = [{"name": f"s{i}", "label": "S"} for i in range(101)]
    with pytest.raises(ValidationError):
        PortableTemplate.model_validate(_doc(sections=too_many))
    with pytest.raises(ValidationError):
        PortableTemplate.model_validate(_doc(sections=[]))


def test_section_model_is_importable() -> None:
    s = PortableSection(name="s", label="S")
    assert s.fields == [] and s.sections == []
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd backend && uv run pytest tests/unit/test_template_portable_schema.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.schemas.template_portable'`.

- [ ] **Step 3: Write the model**

```python
# backend/app/schemas/template_portable.py
"""The ``prumo-template@1`` portable template format.

One JSON object, no UUIDs: nesting carries the hierarchy, array order carries
``sort_order``, and defaults are omitted on export (serialize with
``model_dump(by_alias=True, exclude_defaults=True)``). ``role`` is never
written — it is DERIVED from nesting plus the ``group`` flag, so a file cannot
express a role/parent combination the DB CHECK constraints reject.

Validation reuses the aliases from ``template_structure`` verbatim: the import
introduces zero rules of its own, so a file can never express what the manual
editor would refuse.

Layering: imports nothing from ``app.models`` (check_layered_arch).

Design: docs/superpowers/specs/2026-08-23-template-portable-import-export-design.md §4.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.schemas.template_structure import (
    AllowedUnits,
    AllowedValues,
    FieldName,
    FieldType,
    SectionEntryLabel,
    SectionLabel,
    SectionName,
)

PORTABLE_FORMAT_VERSION: Literal[1] = 1

Framework = Literal["CHARMS", "PICOS", "CUSTOM"]

# Spec §5.5: a pathological file becomes a fast 422, never a long transaction.
MAX_SECTIONS_PER_LEVEL = 100
MAX_FIELDS_PER_SECTION = 200


class PortableField(BaseModel):
    """One ``extraction_fields`` row. ``type``/``required`` are the file keys
    (JSON Schema convention); the attributes keep the column names."""

    model_config = ConfigDict(extra="forbid")

    name: FieldName
    label: str = Field(min_length=1, max_length=100)
    field_type: FieldType = Field(alias="type")
    description: str | None = Field(default=None, max_length=500)
    is_required: bool = Field(default=False, alias="required")
    llm_description: str | None = Field(default=None, max_length=1000)
    allowed_values: AllowedValues | None = None
    unit: str | None = Field(default=None, max_length=50)
    allowed_units: AllowedUnits | None = None
    allow_other: bool = False
    other_label: str | None = Field(default=None, max_length=100)
    other_placeholder: str | None = Field(default=None, max_length=200)
    allows_not_applicable: bool = False
    allows_not_evaluated: bool = False


class PortableSection(BaseModel):
    """One ``extraction_entity_types`` row plus its fields and (for a group)
    its child sections. ``group`` ⇒ ``model_container``; nested ⇒
    ``model_section``; otherwise ``study_section``."""

    model_config = ConfigDict(extra="forbid")

    name: SectionName
    label: SectionLabel
    description: str | None = None
    is_required: bool = Field(default=False, alias="required")
    repeats: bool = False
    group: bool = False
    entry_label: SectionEntryLabel | None = None
    fields: list[PortableField] = Field(default_factory=list, max_length=MAX_FIELDS_PER_SECTION)
    sections: list[PortableSection] = Field(
        default_factory=list, max_length=MAX_SECTIONS_PER_LEVEL
    )

    @model_validator(mode="after")
    def _section_rules(self) -> PortableSection:
        if self.sections and not self.group:
            raise ValueError("sections are only allowed inside a group")
        if self.entry_label is not None and not self.group:
            raise ValueError("entry_label is only allowed on a group")
        if self.group and self.entry_label is None:
            self.entry_label = "model"
        for child in self.sections:
            if child.group:
                raise ValueError("a group must be a root section")
            if child.sections:
                raise ValueError("sections nest only one level deep")
        names = [f.name for f in self.fields]
        if len(set(names)) != len(names):
            raise ValueError("duplicate field name within a section")
        return self


# Self-referencing ``sections: list[PortableSection]`` under
# ``from __future__ import annotations`` — resolve the forward ref eagerly.
PortableSection.model_rebuild()


class PortableTemplate(BaseModel):
    """The document. ``prumo_template`` and ``kind`` have NO default so they
    are always emitted even under ``exclude_defaults``."""

    model_config = ConfigDict(extra="forbid")

    prumo_template: Literal[1]
    kind: Literal["extraction"]
    name: str = Field(min_length=1, max_length=200)
    description: str | None = None
    framework: Framework = "CUSTOM"
    version: str = Field(default="1.0.0", max_length=50)
    llm_template_instruction: str | None = Field(default=None, max_length=4000)
    sections: list[PortableSection] = Field(min_length=1, max_length=MAX_SECTIONS_PER_LEVEL)

    @model_validator(mode="after")
    def _at_most_one_group(self) -> PortableTemplate:
        if sum(1 for s in self.sections if s.group) > 1:
            raise ValueError("at most one group per template")
        return self
```

- [ ] **Step 4: Run to verify they pass**

Run: `cd backend && uv run pytest tests/unit/test_template_portable_schema.py -q`
Expected: all PASS. If a `needle` assertion fails only on Pydantic's wording, fix the needle to the actual message — the behavior is what matters.

- [ ] **Step 5: Lint and commit**

Run: `cd backend && uv run ruff check app/schemas/template_portable.py tests/unit/test_template_portable_schema.py && uv run ruff format --check app/schemas/template_portable.py tests/unit/test_template_portable_schema.py`

```bash
git add backend/app/schemas/template_portable.py backend/tests/unit/test_template_portable_schema.py
git commit -m "feat(templates): prumo-template@1 portable format model"
```

---

### Task 2: Shared sibling-deactivation helper + the Switch fix

**Files:**
- Modify: `backend/app/services/project_template_active_service.py`
- Modify: `backend/app/services/template_clone_service.py` (remove `_deactivate_sibling_extraction_templates`, lines ~257-290; replace its two call sites at ~176 and ~205)
- Test: `backend/tests/integration/test_project_template_active_service.py` (append)

**Interfaces:**
- Produces: `async def deactivate_sibling_extraction_templates(db: AsyncSession, *, project_id: UUID, keep_active_id: UUID | None) -> None` (module-level in `project_template_active_service`). Tasks 3 and the clone service call it.

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/integration/test_project_template_active_service.py` (the file already defines `_insert_inactive_extraction_template(db, *, project_id, created_by)` and imports `SEED`, `set_template_active`):

```python
@pytest.mark.asyncio
async def test_activating_extraction_template_deactivates_active_sibling(
    db_session: AsyncSession,
) -> None:
    """Spec §5.6: today this trips `uq_one_active_extraction_template_per_project`
    because the flag is flipped without deactivating the sibling."""
    from tests.integration.conftest import clean_project_clones, clone_charms

    project_id = SEED.secondary_project
    await clean_project_clones(db_session, project_id)
    active = await clone_charms(db_session, project_id, SEED.primary_profile)
    extra = await _insert_inactive_extraction_template(
        db_session, project_id=project_id, created_by=SEED.primary_profile
    )

    result = await set_template_active(
        db_session, project_id=project_id, template_id=extra, is_active=True
    )
    assert result.is_active is True

    rows = await db_session.execute(
        text(
            "SELECT id, is_active FROM public.project_extraction_templates "
            "WHERE project_id = :pid AND kind = 'extraction'"
        ),
        {"pid": str(project_id)},
    )
    state = {str(r.id): r.is_active for r in rows}
    assert state[str(extra)] is True
    assert state[str(active.project_template_id)] is False
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && uv run pytest tests/integration/test_project_template_active_service.py -q -k deactivates_active_sibling`
Expected: FAIL with `IntegrityError … uq_one_active_extraction_template_per_project`.

- [ ] **Step 3: Add the helper and call it on activation**

In `backend/app/services/project_template_active_service.py`, add `update` to the sqlalchemy import and insert the helper above `set_template_active`:

```python
from sqlalchemy import select, update


async def deactivate_sibling_extraction_templates(
    db: AsyncSession,
    *,
    project_id: UUID,
    keep_active_id: UUID | None,
) -> None:
    """Deactivate the project's active EXTRACTION templates.

    ``keep_active_id`` is excluded from the update (idempotent re-import of
    the same clone; activating a template that is already active). ``None``
    deactivates every active extraction template — used right before
    inserting a brand-new one whose id is not known yet.

    Shared by clone, portable import, and ``set_template_active`` so the
    single-active invariant (`uq_one_active_extraction_template_per_project`)
    has exactly one write path. Kind-scoped: QA templates may coexist.
    """
    stmt = (
        update(ProjectExtractionTemplate)
        .where(
            ProjectExtractionTemplate.project_id == project_id,
            ProjectExtractionTemplate.kind == TemplateKind.EXTRACTION.value,
            ProjectExtractionTemplate.is_active.is_(True),
        )
        .values(is_active=False)
    )
    if keep_active_id is not None:
        stmt = stmt.where(ProjectExtractionTemplate.id != keep_active_id)
    await db.execute(stmt)
```

Then in `set_template_active`, immediately before `tpl.is_active = is_active`:

```python
    if tpl.kind == TemplateKind.EXTRACTION.value and is_active and not tpl.is_active:
        # Switch: the partial unique index forbids two active extraction
        # templates, so the sibling goes first (spec §5.6).
        await deactivate_sibling_extraction_templates(
            db, project_id=project_id, keep_active_id=template_id
        )
        await db.flush()
```

Update the module docstring's first line to mention the helper.

- [ ] **Step 4: Point the clone service at the helper**

In `backend/app/services/template_clone_service.py`:
- Add `from app.services.project_template_active_service import deactivate_sibling_extraction_templates` to the imports (top-level — that module imports only models and schemas, so no cycle).
- Replace both `await self._deactivate_sibling_extraction_templates(project_id=..., keep_active_id=...)` calls with `await deactivate_sibling_extraction_templates(self.db, project_id=..., keep_active_id=...)` (same keyword values).
- Delete the `_deactivate_sibling_extraction_templates` method entirely. Remove `update` from the sqlalchemy import if it is now unused (ruff will tell you).

- [ ] **Step 5: Run the affected suites**

Run: `cd backend && uv run pytest tests/integration/test_project_template_active_service.py tests/integration/test_template_clone_service.py tests/integration/test_template_clone_extraction.py tests/integration/test_single_active_extraction_invariant.py -q`
Expected: all PASS (including the new test).

- [ ] **Step 6: Lint and commit**

Run: `cd backend && uv run ruff check app/services/project_template_active_service.py app/services/template_clone_service.py && uv run ruff format --check app/services/`

```bash
git add backend/app/services/project_template_active_service.py backend/app/services/template_clone_service.py backend/tests/integration/test_project_template_active_service.py
git commit -m "fix(templates): activating an extraction template deactivates its sibling; share the helper with clone"
```

---

### Task 3: Portable service — export, parse, import (round-trip)

**Files:**
- Create: `backend/app/services/template_portable_service.py`
- Modify: `backend/app/schemas/hitl_session.py` (append `TemplateImportRefusalCode`)
- Test: `backend/tests/integration/test_template_portable_service.py`

**Interfaces:**
- Consumes: Task 1 models; Task 2 helper; `TemplateClone` + `TemplateNotFoundError` from `template_clone_service`; `TemplateVersionService.republish(project_id=, project_template_id=, user_id=)` returning an object with `.version_id`.
- Produces:
  - `parse_portable_document(raw: dict[str, Any]) -> PortableTemplate` — raises `TemplateImportUnsupportedVersionError` / `TemplateImportWrongKindError` / `TemplateImportInvalidError` (all `AppError`, 422).
  - `async def to_portable(db, *, project_id: UUID, template_id: UUID) -> PortableTemplate` — raises `TemplateNotFoundError` when the template is not in the project.
  - `async def import_portable(db, *, project_id: UUID, doc: PortableTemplate, user_id: UUID) -> TemplateClone`.
  - `TemplateImportRefusalCode(StrEnum)` in `hitl_session.py` with `TEMPLATE_IMPORT_INVALID`, `TEMPLATE_IMPORT_WRONG_KIND`, `TEMPLATE_IMPORT_UNSUPPORTED_VERSION`.

- [ ] **Step 1: Write the failing tests**

```python
# backend/tests/integration/test_template_portable_service.py
"""Round-trip and lifecycle tests for the portable template service.

The round-trip (seeded CHARMS → clone into A → export → import into B →
export) is the one test that proves BOTH directions and every carried column
at once: if either side drops a key the two documents differ.
"""

from __future__ import annotations

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.schemas.template_portable import PortableTemplate
from app.services.template_clone_service import TemplateNotFoundError
from app.services.template_portable_service import (
    TemplateImportInvalidError,
    TemplateImportUnsupportedVersionError,
    TemplateImportWrongKindError,
    import_portable,
    parse_portable_document,
    to_portable,
)
from tests.integration.conftest import SEED, clean_project_clones, clone_charms


def _dump(doc: PortableTemplate) -> dict:
    return doc.model_dump(by_alias=True, exclude_defaults=True)


async def _count(db: AsyncSession, sql: str, **params) -> int:
    return (await db.execute(text(sql), params)).scalar_one()


@pytest.mark.asyncio
async def test_round_trip_charms_is_lossless(db_session: AsyncSession) -> None:
    """One project is enough: the import creates a SECOND template there (and
    deactivates the CHARMS clone), so the two exports come from distinct rows."""
    project_id = SEED.secondary_project
    await clean_project_clones(db_session, project_id)
    clone = await clone_charms(db_session, project_id, SEED.primary_profile)

    exported = await to_portable(
        db_session, project_id=project_id, template_id=clone.project_template_id
    )
    assert exported.prumo_template == 1 and exported.kind == "extraction"
    assert any(s.group for s in exported.sections)  # CHARMS has the model group
    assert exported.llm_template_instruction  # seeded general instruction

    imported = await import_portable(
        db_session, project_id=project_id, doc=exported, user_id=SEED.primary_profile
    )
    assert imported.created is True
    assert imported.project_template_id != clone.project_template_id
    assert imported.entity_type_count == clone.entity_type_count
    assert imported.field_count == clone.field_count

    re_exported = await to_portable(
        db_session, project_id=project_id, template_id=imported.project_template_id
    )
    assert _dump(re_exported) == _dump(exported)


@pytest.mark.asyncio
async def test_import_activates_new_and_deactivates_previous(db_session: AsyncSession) -> None:
    project_id = SEED.secondary_project
    await clean_project_clones(db_session, project_id)
    previous = await clone_charms(db_session, project_id, SEED.primary_profile)

    doc = parse_portable_document(
        {
            "prumo_template": 1,
            "kind": "extraction",
            "name": "Mini",
            "sections": [
                {"name": "s1", "label": "S1", "fields": [{"name": "f1", "label": "F1", "type": "text"}]}
            ],
        }
    )
    result = await import_portable(
        db_session, project_id=project_id, doc=doc, user_id=SEED.primary_profile
    )

    rows = await db_session.execute(
        text(
            "SELECT id, is_active, global_template_id FROM public.project_extraction_templates "
            "WHERE project_id = :pid AND kind = 'extraction'"
        ),
        {"pid": str(project_id)},
    )
    state = {str(r.id): (r.is_active, r.global_template_id) for r in rows}
    assert state[str(result.project_template_id)] == (True, None)
    assert state[str(previous.project_template_id)][0] is False

    # Exactly one active version, and its snapshot is the imported structure.
    active_versions = await _count(
        db_session,
        "SELECT COUNT(*) FROM public.extraction_template_versions "
        "WHERE project_template_id = :tid AND is_active",
        tid=str(result.project_template_id),
    )
    assert active_versions == 1
    snapshot = (
        await db_session.execute(
            text(
                "SELECT schema FROM public.extraction_template_versions "
                "WHERE id = :vid"
            ),
            {"vid": str(result.version_id)},
        )
    ).scalar_one()
    assert [et["name"] for et in snapshot["entity_types"]] == ["s1"]
    assert [f["name"] for f in snapshot["entity_types"][0]["fields"]] == ["f1"]
    assert snapshot["entity_types"][0]["role"] == "study_section"


@pytest.mark.asyncio
async def test_import_derives_roles_from_nesting(db_session: AsyncSession) -> None:
    project_id = SEED.secondary_project
    await clean_project_clones(db_session, project_id)
    doc = parse_portable_document(
        {
            "prumo_template": 1,
            "kind": "extraction",
            "name": "Grouped",
            "sections": [
                {"name": "root", "label": "Root", "repeats": True},
                {
                    "name": "g",
                    "label": "G",
                    "group": True,
                    "fields": [{"name": "k", "label": "K", "type": "text"}],
                    "sections": [{"name": "c", "label": "C", "repeats": True}],
                },
            ],
        }
    )
    result = await import_portable(
        db_session, project_id=project_id, doc=doc, user_id=SEED.primary_profile
    )
    rows = await db_session.execute(
        text(
            "SELECT name, role, cardinality, entry_label, sort_order, "
            "parent_entity_type_id IS NOT NULL AS has_parent "
            "FROM public.extraction_entity_types WHERE project_template_id = :tid "
            "ORDER BY sort_order, name"
        ),
        {"tid": str(result.project_template_id)},
    )
    by_name = {r.name: r for r in rows}
    assert (by_name["root"].role, by_name["root"].cardinality, by_name["root"].has_parent) == (
        "study_section", "many", False,
    )
    assert (by_name["g"].role, by_name["g"].cardinality, by_name["g"].entry_label) == (
        "model_container", "many", "model",
    )
    assert (by_name["c"].role, by_name["c"].cardinality, by_name["c"].has_parent) == (
        "model_section", "many", True,
    )


@pytest.mark.asyncio
async def test_same_named_sections_import(db_session: AsyncSession) -> None:
    project_id = SEED.secondary_project
    await clean_project_clones(db_session, project_id)
    doc = parse_portable_document(
        {
            "prumo_template": 1,
            "kind": "extraction",
            "name": "Dup",
            "sections": [{"name": "s", "label": "A"}, {"name": "s", "label": "B"}],
        }
    )
    result = await import_portable(
        db_session, project_id=project_id, doc=doc, user_id=SEED.primary_profile
    )
    assert result.entity_type_count == 2


@pytest.mark.parametrize(
    ("raw", "exc_type", "code"),
    [
        ({"prumo_template": 2, "kind": "extraction", "name": "x", "sections": []},
         TemplateImportUnsupportedVersionError, "TEMPLATE_IMPORT_UNSUPPORTED_VERSION"),
        ({"prumo_template": 1, "kind": "quality_assessment", "name": "x", "sections": []},
         TemplateImportWrongKindError, "TEMPLATE_IMPORT_WRONG_KIND"),
        ({"prumo_template": 1, "kind": "extraction", "name": "x",
          "sections": [{"name": "s", "label": "S", "fields": [{"name": "Bad", "label": "B", "type": "text"}]}]},
         TemplateImportInvalidError, "TEMPLATE_IMPORT_INVALID"),
        ({}, TemplateImportUnsupportedVersionError, "TEMPLATE_IMPORT_UNSUPPORTED_VERSION"),
    ],
)
def test_parse_rejections_are_typed(raw, exc_type, code) -> None:
    with pytest.raises(exc_type) as exc:
        parse_portable_document(raw)
    assert exc.value.code == code
    assert exc.value.status_code == 422


def test_invalid_document_lists_paths_in_message_and_details() -> None:
    raw = {
        "prumo_template": 1,
        "kind": "extraction",
        "name": "x",
        "sections": [
            {"name": "s", "label": "S", "fields": [{"name": "Bad", "label": "B", "type": "text"}]},
            {"name": "t", "label": "T", "sections": [{"name": "c", "label": "C"}]},
        ],
    }
    with pytest.raises(TemplateImportInvalidError) as exc:
        parse_portable_document(raw)
    paths = [e["path"] for e in exc.value.details["errors"]]
    assert "sections[0].fields[0].name" in paths
    assert any(p.startswith("sections[1]") for p in paths)
    assert "sections[0].fields[0].name" in exc.value.message


def test_invalid_document_message_is_capped_at_20_entries() -> None:
    fields = [{"name": f"Bad{i}", "label": "B", "type": "text"} for i in range(30)]
    raw = {"prumo_template": 1, "kind": "extraction", "name": "x",
           "sections": [{"name": "s", "label": "S", "fields": fields}]}
    with pytest.raises(TemplateImportInvalidError) as exc:
        parse_portable_document(raw)
    assert len(exc.value.details["errors"]) == 20
    assert exc.value.details["error_count"] == 30


@pytest.mark.asyncio
async def test_rejected_import_writes_nothing(db_session: AsyncSession) -> None:
    """A document that passes Pydantic but violates a DB constraint must not
    leave a template row behind. The llm_instruction_len CHECK is reachable
    only by bypassing the model, so this test bypasses it on purpose. The
    savepoint mirrors what the request session does on close (rollback)
    while keeping this session usable for the count afterwards."""
    from sqlalchemy.exc import IntegrityError

    from app.schemas.template_portable import PortableSection

    project_id = SEED.secondary_project
    await clean_project_clones(db_session, project_id)
    before = await _count(
        db_session,
        "SELECT COUNT(*) FROM public.project_extraction_templates WHERE project_id = :pid",
        pid=str(project_id),
    )
    doc = PortableTemplate.model_construct(
        prumo_template=1, kind="extraction", name="x", description=None,
        framework="CUSTOM", version="1.0.0", llm_template_instruction="x" * 4001,
        sections=[PortableSection.model_validate({"name": "s", "label": "S"})],
    )
    with pytest.raises(IntegrityError):
        async with db_session.begin_nested():
            await import_portable(
                db_session, project_id=project_id, doc=doc, user_id=SEED.primary_profile
            )
    after = await _count(
        db_session,
        "SELECT COUNT(*) FROM public.project_extraction_templates WHERE project_id = :pid",
        pid=str(project_id),
    )
    assert after == before


@pytest.mark.asyncio
async def test_export_refuses_template_outside_project(db_session: AsyncSession) -> None:
    """BOLA: a template id from another project 404s. Never wipes the primary
    project (other files' runs live there)."""
    await clean_project_clones(db_session, SEED.secondary_project)
    clone = await clone_charms(db_session, SEED.secondary_project, SEED.primary_profile)
    with pytest.raises(TemplateNotFoundError):
        await to_portable(
            db_session, project_id=SEED.primary_project, template_id=clone.project_template_id
        )
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd backend && uv run pytest tests/integration/test_template_portable_service.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.services.template_portable_service'`.

- [ ] **Step 3: Add the refusal codes**

Append to `backend/app/schemas/hitl_session.py` (next to `TemplatePublishRefusalCode`, same slice-local rationale):

```python
class TemplateImportRefusalCode(StrEnum):
    """Why ``POST .../templates/import`` returned 422 (portable import).

    Slice-local like :class:`TemplatePublishRefusalCode` — one endpoint's
    private outcome, deliberately NOT in ``ApiErrorCode``."""

    TEMPLATE_IMPORT_INVALID = "TEMPLATE_IMPORT_INVALID"
    TEMPLATE_IMPORT_WRONG_KIND = "TEMPLATE_IMPORT_WRONG_KIND"
    TEMPLATE_IMPORT_UNSUPPORTED_VERSION = "TEMPLATE_IMPORT_UNSUPPORTED_VERSION"
```

- [ ] **Step 4: Write the service**

```python
# backend/app/services/template_portable_service.py
"""Portable template import/export (``prumo-template@1``).

Both directions live side by side so the serializer is the exact inverse of
the importer; ``tests/integration/test_template_portable_service.py`` proves
it with one round-trip. Import always creates a NEW project template
(``global_template_id = NULL``), activates it, and publishes v1 through the
one publish path — it never touches an existing template's draft, versions,
or run pins (spec §3.1).

No topological sort: a nested document is parent-first by construction, so
``sort_order`` is the array index. Only the clone service's TAIL (sibling
deactivation, republish) is shared.

Design: docs/superpowers/specs/2026-08-23-template-portable-import-export-design.md §5.
"""

from __future__ import annotations

from typing import Any
from uuid import UUID

from fastapi import status
from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.error_handler import AppError
from app.models.extraction import (
    ExtractionEntityRole,
    ExtractionEntityType,
    ExtractionField,
    ProjectExtractionTemplate,
    TemplateKind,
)
from app.schemas.hitl_session import TemplateImportRefusalCode
from app.schemas.template_portable import (
    PORTABLE_FORMAT_VERSION,
    PortableField,
    PortableSection,
    PortableTemplate,
)
from app.services.project_template_active_service import (
    deactivate_sibling_extraction_templates,
)
from app.services.template_clone_service import TemplateClone, TemplateNotFoundError
from app.services.template_version_service import TemplateVersionService

MAX_REPORTED_ERRORS = 20


class TemplateImportUnsupportedVersionError(AppError):
    def __init__(self, found: Any) -> None:
        super().__init__(
            code=TemplateImportRefusalCode.TEMPLATE_IMPORT_UNSUPPORTED_VERSION,
            message=(
                f"Unsupported template format: expected prumo_template = "
                f"{PORTABLE_FORMAT_VERSION}, found {found!r}."
            ),
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
        )


class TemplateImportWrongKindError(AppError):
    def __init__(self, found: Any) -> None:
        super().__init__(
            code=TemplateImportRefusalCode.TEMPLATE_IMPORT_WRONG_KIND,
            message=f"Only extraction templates can be imported here (file kind: {found!r}).",
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
        )


class TemplateImportInvalidError(AppError):
    """``details.errors`` is the capped ``[{path, message}]`` list; the message
    repeats it as one line per entry so a client that only reads
    ``error.message`` still sees every path (spec §5.4)."""

    def __init__(self, errors: list[dict[str, str]], *, total: int) -> None:
        lines = [f"{e['path']}: {e['message']}" for e in errors]
        suffix = f" (+{total - len(errors)} more)" if total > len(errors) else ""
        super().__init__(
            code=TemplateImportRefusalCode.TEMPLATE_IMPORT_INVALID,
            message="Invalid template file:\n" + "\n".join(lines) + suffix,
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            details={"errors": errors, "error_count": total},
        )


def _loc_to_path(loc: tuple[int | str, ...]) -> str:
    out = ""
    for part in loc:
        out += f"[{part}]" if isinstance(part, int) else (f".{part}" if out else str(part))
    return out


def parse_portable_document(raw: dict[str, Any]) -> PortableTemplate:
    """Validate a raw document into the model with TYPED failures.

    The version and kind pre-checks run first so the two most common
    "wrong file" cases get their own code instead of a generic list."""
    version = raw.get("prumo_template") if isinstance(raw, dict) else None
    if version != PORTABLE_FORMAT_VERSION:
        raise TemplateImportUnsupportedVersionError(version)
    kind = raw.get("kind")
    if kind != TemplateKind.EXTRACTION.value:
        raise TemplateImportWrongKindError(kind)
    try:
        return PortableTemplate.model_validate(raw)
    except ValidationError as exc:
        all_errors = [
            {"path": _loc_to_path(tuple(e["loc"])), "message": e["msg"]} for e in exc.errors()
        ]
        raise TemplateImportInvalidError(
            all_errors[:MAX_REPORTED_ERRORS], total=len(all_errors)
        ) from exc


# ---------------------------------------------------------------- export


async def _owned_template(
    db: AsyncSession, *, project_id: UUID, template_id: UUID
) -> ProjectExtractionTemplate:
    tpl = await db.get(ProjectExtractionTemplate, template_id)
    if tpl is None or tpl.project_id != project_id:
        raise TemplateNotFoundError(f"Project template {template_id} not found")
    return tpl


def _field_to_portable(f: ExtractionField) -> PortableField:
    return PortableField(
        name=f.name,
        label=f.label,
        type=f.field_type,
        description=f.description,
        required=f.is_required,
        llm_description=f.llm_description,
        allowed_values=f.allowed_values,
        unit=f.unit,
        allowed_units=f.allowed_units,
        allow_other=f.allow_other,
        other_label=f.other_label,
        other_placeholder=f.other_placeholder,
        allows_not_applicable=f.allows_not_applicable,
        allows_not_evaluated=f.allows_not_evaluated,
    )


def _section_to_portable(
    et: ExtractionEntityType, children: list[ExtractionEntityType]
) -> PortableSection:
    is_group = et.role == ExtractionEntityRole.MODEL_CONTAINER.value
    return PortableSection(
        name=et.name,
        label=et.label,
        description=et.description,
        required=et.is_required,
        # A group always repeats; ``repeats`` is only meaningful elsewhere.
        repeats=(et.cardinality == "many") and not is_group,
        group=is_group,
        entry_label=et.entry_label if is_group else None,
        fields=[_field_to_portable(f) for f in sorted(et.fields, key=lambda x: x.sort_order)],
        sections=[_section_to_portable(c, []) for c in children],
    )


async def to_portable(
    db: AsyncSession, *, project_id: UUID, template_id: UUID
) -> PortableTemplate:
    """Serialize the LIVE structure (what the grid shows — spec §3.3)."""
    tpl = await _owned_template(db, project_id=project_id, template_id=template_id)
    rows = (
        (
            await db.execute(
                select(ExtractionEntityType)
                .where(ExtractionEntityType.project_template_id == template_id)
                .options(selectinload(ExtractionEntityType.fields))
                .order_by(ExtractionEntityType.sort_order, ExtractionEntityType.name)
            )
        )
        .scalars()
        .all()
    )
    children_of: dict[UUID, list[ExtractionEntityType]] = {}
    for et in rows:
        if et.parent_entity_type_id is not None:
            children_of.setdefault(et.parent_entity_type_id, []).append(et)
    roots = [et for et in rows if et.parent_entity_type_id is None]
    return PortableTemplate(
        prumo_template=PORTABLE_FORMAT_VERSION,
        kind=TemplateKind.EXTRACTION.value,
        name=tpl.name,
        description=tpl.description,
        framework=tpl.framework,
        version=tpl.version,
        llm_template_instruction=tpl.llm_template_instruction or None,
        sections=[_section_to_portable(et, children_of.get(et.id, [])) for et in roots],
    )


# ---------------------------------------------------------------- import


def _entity_type_row(
    section: PortableSection,
    *,
    template_id: UUID,
    parent_id: UUID | None,
    sort_order: int,
) -> ExtractionEntityType:
    if parent_id is not None:
        role, cardinality, entry_label = (
            ExtractionEntityRole.MODEL_SECTION,
            "many" if section.repeats else "one",
            None,
        )
    elif section.group:
        role, cardinality, entry_label = (
            ExtractionEntityRole.MODEL_CONTAINER,
            "many",
            section.entry_label or "model",
        )
    else:
        role, cardinality, entry_label = (
            ExtractionEntityRole.STUDY_SECTION,
            "many" if section.repeats else "one",
            None,
        )
    return ExtractionEntityType(
        project_template_id=template_id,
        template_id=None,
        name=section.name,
        label=section.label,
        description=section.description,
        entry_label=entry_label,
        parent_entity_type_id=parent_id,
        cardinality=cardinality,
        role=role.value,
        sort_order=sort_order,
        is_required=section.is_required,
    )


def _field_row(f: PortableField, *, entity_type_id: UUID, sort_order: int) -> ExtractionField:
    return ExtractionField(
        entity_type_id=entity_type_id,
        name=f.name,
        label=f.label,
        description=f.description,
        field_type=f.field_type,
        is_required=f.is_required,
        # Vestigial column, not part of the format (spec §4.4): same value
        # the create-field path writes.
        validation_schema={},
        allowed_values=f.allowed_values,
        unit=f.unit,
        allowed_units=f.allowed_units,
        sort_order=sort_order,
        llm_description=f.llm_description,
        allow_other=f.allow_other,
        other_label=f.other_label,
        other_placeholder=f.other_placeholder,
        allows_not_applicable=f.allows_not_applicable,
        allows_not_evaluated=f.allows_not_evaluated,
    )


async def import_portable(
    db: AsyncSession, *, project_id: UUID, doc: PortableTemplate, user_id: UUID
) -> TemplateClone:
    """Create a NEW active project template from ``doc`` and publish v1.

    Runs inside the caller's transaction; any failure leaves nothing behind
    because the caller never commits (the request session rolls back on
    close). Walks ``sections`` parent-first in array order — no topological
    sort (spec §5.3)."""
    await deactivate_sibling_extraction_templates(db, project_id=project_id, keep_active_id=None)
    await db.flush()

    tpl = ProjectExtractionTemplate(
        project_id=project_id,
        global_template_id=None,
        name=doc.name,
        description=doc.description,
        framework=doc.framework,
        version=doc.version,
        kind=TemplateKind.EXTRACTION.value,
        schema_={},
        llm_template_instruction=doc.llm_template_instruction,
        is_active=True,
        created_by=user_id,
    )
    db.add(tpl)
    await db.flush()

    entity_type_count = 0
    field_count = 0

    async def _insert(section: PortableSection, parent_id: UUID | None, sort_order: int) -> None:
        nonlocal entity_type_count, field_count
        et = _entity_type_row(
            section, template_id=tpl.id, parent_id=parent_id, sort_order=sort_order
        )
        db.add(et)
        await db.flush()
        entity_type_count += 1
        for i, f in enumerate(section.fields):
            db.add(_field_row(f, entity_type_id=et.id, sort_order=i))
            field_count += 1
        for i, child in enumerate(section.sections):
            await _insert(child, et.id, i)

    for i, section in enumerate(doc.sections):
        await _insert(section, None, i)
    await db.flush()

    # Publish v1 through the one publish path: snapshots under its locks and
    # clears the draft marker the inserts above just stamped.
    republished = await TemplateVersionService(db).republish(
        project_id=project_id,
        project_template_id=tpl.id,
        user_id=user_id,
    )
    return TemplateClone(
        project_template_id=tpl.id,
        version_id=republished.version_id,
        entity_type_count=entity_type_count,
        field_count=field_count,
        created=True,
    )
```

Check the import graph for a cycle: `template_version_service` imports `template_clone_service`; this module imports both; neither imports this module. `ruff` + `python -c "import app.services.template_portable_service"` must succeed.

- [ ] **Step 5: Run to verify they pass**

Run: `cd backend && uv run pytest tests/integration/test_template_portable_service.py tests/unit/test_template_portable_schema.py -q`
Expected: all PASS. If the round-trip differs, print both dumps (`pytest -vv`) — a difference means a column is dropped on one side; fix the serializer/importer, never the test.

- [ ] **Step 6: Lint and commit**

Run: `cd backend && uv run ruff check app/services/template_portable_service.py app/schemas/hitl_session.py tests/integration/test_template_portable_service.py && uv run ruff format --check app/ tests/`

```bash
git add backend/app/services/template_portable_service.py backend/app/schemas/hitl_session.py backend/tests/integration/test_template_portable_service.py
git commit -m "feat(templates): portable export/import service with a lossless round-trip"
```

---

### Task 4: Delete service

**Files:**
- Create: `backend/app/services/template_delete_service.py`
- Modify: `backend/app/schemas/hitl_session.py` (append `TemplateDeleteRefusalCode`, `TemplateDeleteResponse`)
- Test: `backend/tests/integration/test_template_delete_service.py`

**Interfaces:**
- Consumes: `ProjectTemplateNotFoundError` from `project_template_active_service`; `ExtractionRun`, `ExtractionInstance` from `app.models.extraction`; `ExtractionHitlConfig` from `app.models.extraction_versioning`; `RunLifecycleService.create_run(project_id=, article_id=, project_template_id=, user_id=)` (tests only).
- Produces: `async def delete_template(db, *, project_id: UUID, template_id: UUID) -> TemplateDeleteResponse`; `TemplateActiveError`, `TemplateInUseError` (`AppError`, 409); `TemplateDeleteRefusalCode(StrEnum)` with `TEMPLATE_ACTIVE`, `TEMPLATE_IN_USE`; `TemplateDeleteResponse(project_template_id: UUID, deleted: bool)`.

- [ ] **Step 1: Write the failing tests**

```python
# backend/tests/integration/test_template_delete_service.py
"""Guards and cascade for the project-template delete (spec §5.7)."""

from __future__ import annotations

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.project_template_active_service import (
    ProjectTemplateNotFoundError,
    set_template_active,
)
from app.services.template_delete_service import (
    TemplateActiveError,
    TemplateInUseError,
    delete_template,
)
from tests.integration.conftest import SEED, clean_project_clones, clone_charms
from tests.integration.test_project_template_active_service import (
    _insert_inactive_extraction_template,
)


async def _count(db: AsyncSession, sql: str, **params) -> int:
    return (await db.execute(text(sql), params)).scalar_one()


@pytest.mark.asyncio
async def test_delete_refuses_active_template(db_session: AsyncSession) -> None:
    project_id = SEED.secondary_project
    await clean_project_clones(db_session, project_id)
    active = await clone_charms(db_session, project_id, SEED.primary_profile)
    with pytest.raises(TemplateActiveError) as exc:
        await delete_template(
            db_session, project_id=project_id, template_id=active.project_template_id
        )
    assert exc.value.code == "TEMPLATE_ACTIVE" and exc.value.status_code == 409


@pytest.mark.asyncio
async def test_delete_refuses_cross_project(db_session: AsyncSession) -> None:
    await clean_project_clones(db_session, SEED.secondary_project)
    clone = await clone_charms(db_session, SEED.secondary_project, SEED.primary_profile)
    with pytest.raises(ProjectTemplateNotFoundError):
        await delete_template(
            db_session, project_id=SEED.primary_project, template_id=clone.project_template_id
        )


@pytest.mark.asyncio
async def test_delete_refuses_template_with_a_run(db_session: AsyncSession) -> None:
    """Builds on the PRIMARY project's live rows (never wiped: other files'
    runs live there). ``resolve_or_create_extract_run`` reuses a live run if
    one exists (the one-live-run invariant would 23505 a blind create_run).
    Restores the active template at the end so later tests see CHARMS active."""
    from app.services.run_lifecycle_service import RunLifecycleService

    project_id = SEED.primary_project
    used = await clone_charms(db_session, project_id, SEED.primary_profile)
    await RunLifecycleService(db_session).resolve_or_create_extract_run(
        project_id=project_id,
        article_id=SEED.primary_article,
        project_template_id=used.project_template_id,
        user_id=SEED.primary_profile,
    )
    # Make it inactive so the ACTIVE guard is not the one firing.
    extra = await _insert_inactive_extraction_template(
        db_session, project_id=project_id, created_by=SEED.primary_profile
    )
    await set_template_active(db_session, project_id=project_id, template_id=extra, is_active=True)

    with pytest.raises(TemplateInUseError) as exc:
        await delete_template(
            db_session, project_id=project_id, template_id=used.project_template_id
        )
    assert exc.value.code == "TEMPLATE_IN_USE" and exc.value.status_code == 409
    assert exc.value.details["runs"] >= 1

    # Restore: CHARMS active again (deactivates ``extra``), then drop ``extra``.
    await set_template_active(
        db_session, project_id=project_id, template_id=used.project_template_id, is_active=True
    )
    await delete_template(db_session, project_id=project_id, template_id=extra)


@pytest.mark.asyncio
async def test_delete_cascades_structure_versions_and_hitl_config(
    db_session: AsyncSession,
) -> None:
    project_id = SEED.secondary_project
    await clean_project_clones(db_session, project_id)
    doomed = await clone_charms(db_session, project_id, SEED.primary_profile)
    extra = await _insert_inactive_extraction_template(
        db_session, project_id=project_id, created_by=SEED.primary_profile
    )
    await set_template_active(db_session, project_id=project_id, template_id=extra, is_active=True)
    tid = str(doomed.project_template_id)
    await db_session.execute(
        text(
            "INSERT INTO public.extraction_hitl_configs "
            "(id, scope_kind, scope_id, reviewer_count, consensus_rule) "
            "VALUES (gen_random_uuid(), 'template', :tid, 1, 'unanimous')"
        ),
        {"tid": tid},
    )

    result = await delete_template(
        db_session, project_id=project_id, template_id=doomed.project_template_id
    )
    assert result.deleted is True

    for sql in (
        "SELECT COUNT(*) FROM public.project_extraction_templates WHERE id = :tid",
        "SELECT COUNT(*) FROM public.extraction_entity_types WHERE project_template_id = :tid",
        "SELECT COUNT(*) FROM public.extraction_template_versions WHERE project_template_id = :tid",
        "SELECT COUNT(*) FROM public.extraction_hitl_configs "
        "WHERE scope_kind = 'template' AND scope_id = :tid",
    ):
        assert await _count(db_session, sql, tid=tid) == 0
    # Fields hang off entity types (CASCADE): nothing left for the template.
    assert (
        await _count(
            db_session,
            "SELECT COUNT(*) FROM public.extraction_fields f "
            "JOIN public.extraction_entity_types et ON et.id = f.entity_type_id "
            "WHERE et.project_template_id = :tid",
            tid=tid,
        )
        == 0
    )
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd backend && uv run pytest tests/integration/test_template_delete_service.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.services.template_delete_service'`.

- [ ] **Step 3: Add the codes and response schema**

Append to `backend/app/schemas/hitl_session.py`:

```python
class TemplateDeleteRefusalCode(StrEnum):
    """Why ``DELETE .../templates/{id}`` returned 409 (spec §5.7)."""

    TEMPLATE_ACTIVE = "TEMPLATE_ACTIVE"
    TEMPLATE_IN_USE = "TEMPLATE_IN_USE"


class TemplateDeleteResponse(BaseModel):
    project_template_id: UUID
    deleted: bool
```

- [ ] **Step 4: Write the service**

```python
# backend/app/services/template_delete_service.py
"""Delete a project template — guarded, then let the DB cascade.

Two refusals keep it boring (spec §3.6 / §5.7): the ACTIVE template cannot be
deleted (switch first — keeps the at-least-one-active extraction rule intact
by construction), and a template any run or instance references cannot be
deleted (the ``RESTRICT`` FKs remain the hard guarantee; the pre-check turns
a 500 into a message). The delete is a Core statement, not ``session.delete``:
the ORM would try to NULL the children's ``project_template_id`` (breaking
the template XOR CHECK) where the DB ``ON DELETE CASCADE`` just works.
"""

from __future__ import annotations

from uuid import UUID

from fastapi import status
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.error_handler import AppError
from app.models.extraction import (
    ExtractionInstance,
    ExtractionRun,
    ProjectExtractionTemplate,
)
from app.models.extraction_versioning import ExtractionHitlConfig, HitlConfigScopeKind
from app.schemas.hitl_session import TemplateDeleteRefusalCode, TemplateDeleteResponse
from app.services.project_template_active_service import ProjectTemplateNotFoundError


class TemplateActiveError(AppError):
    def __init__(self) -> None:
        super().__init__(
            code=TemplateDeleteRefusalCode.TEMPLATE_ACTIVE,
            message="This template is active. Switch to another template before deleting it.",
            status_code=status.HTTP_409_CONFLICT,
        )


class TemplateInUseError(AppError):
    def __init__(self, *, runs: int, instances: int) -> None:
        super().__init__(
            code=TemplateDeleteRefusalCode.TEMPLATE_IN_USE,
            message=(
                "This template cannot be deleted: extractions already reference it "
                f"({runs} assessment(s), {instances} entry/entries)."
            ),
            status_code=status.HTTP_409_CONFLICT,
            details={"runs": runs, "instances": instances},
        )


async def delete_template(
    db: AsyncSession, *, project_id: UUID, template_id: UUID
) -> TemplateDeleteResponse:
    tpl = await db.get(ProjectExtractionTemplate, template_id)
    if tpl is None or tpl.project_id != project_id:
        raise ProjectTemplateNotFoundError(f"Project template {template_id} not found")
    if tpl.is_active:
        raise TemplateActiveError()

    runs, instances = (
        await db.execute(
            select(
                select(func.count())
                .select_from(ExtractionRun)
                .where(ExtractionRun.template_id == template_id)
                .scalar_subquery(),
                select(func.count())
                .select_from(ExtractionInstance)
                .where(ExtractionInstance.template_id == template_id)
                .scalar_subquery(),
            )
        )
    ).one()
    if runs or instances:
        raise TemplateInUseError(runs=runs, instances=instances)

    # ``scope_id`` has no FK — the template-scoped HITL override would be
    # orphaned by the cascade, so it goes in the same transaction.
    await db.execute(
        delete(ExtractionHitlConfig).where(
            ExtractionHitlConfig.scope_kind == HitlConfigScopeKind.TEMPLATE.value,
            ExtractionHitlConfig.scope_id == template_id,
        )
    )
    await db.execute(
        delete(ProjectExtractionTemplate).where(ProjectExtractionTemplate.id == template_id)
    )
    db.expunge(tpl)
    await db.flush()
    return TemplateDeleteResponse(project_template_id=template_id, deleted=True)
```

Note: `ExtractionRun.template_id` and `ExtractionInstance.template_id` are the column names in `app/models/extraction.py` (lines ~654 and ~483); confirm with `grep -n "template_id" backend/app/models/extraction.py` before relying on them.

- [ ] **Step 5: Run to verify they pass**

Run: `cd backend && uv run pytest tests/integration/test_template_delete_service.py -q`
Expected: all PASS. If `create_run` needs a parsed article or raises on the seeded article, read its docstring in `run_lifecycle_service.py` and satisfy the precondition inside the test (do not weaken the guard).

- [ ] **Step 6: Lint and commit**

```bash
cd backend && uv run ruff check app/services/template_delete_service.py tests/integration/test_template_delete_service.py && uv run ruff format --check app/ tests/
git add backend/app/services/template_delete_service.py backend/app/schemas/hitl_session.py backend/tests/integration/test_template_delete_service.py
git commit -m "feat(templates): guarded project-template delete service"
```

---

### Task 5: The three endpoints, contract types, docs

**Files:**
- Modify: `backend/app/api/v1/endpoints/project_templates.py`
- Test: `backend/tests/unit/test_project_templates_portable_endpoints_unit.py` (direct coroutine — diff-cover blind spot), `backend/tests/integration/test_template_portable_endpoints.py` (HTTP smoke)
- Regenerate: `frontend/types/api/openapi.json`, `frontend/types/api/schema.d.ts`
- Modify: `docs/reference/extraction-hitl-architecture.md` (§4.3)

**Interfaces:**
- Produces routes:
  - `GET /api/v1/projects/{project_id}/templates/{template_id}/export` → `ApiResponse[PortableTemplate]`, `response_model_exclude_defaults=True`, `response_model_by_alias=True`.
  - `POST /api/v1/projects/{project_id}/templates/import` (201) with body `dict[str, Any]` → `ApiResponse[CloneTemplateResponse]`.
  - `DELETE /api/v1/projects/{project_id}/templates/{template_id}` → `ApiResponse[TemplateDeleteResponse]`.
- Endpoint function names: `export_project_template`, `import_project_template`, `delete_project_template`.

- [ ] **Step 1: Write the failing direct-coroutine unit tests**

```python
# backend/tests/unit/test_project_templates_portable_endpoints_unit.py
"""Direct endpoint-coroutine tests for export / import / delete.

The HTTP-layer smoke (tests/integration/test_template_portable_endpoints.py)
runs through ASGITransport, whose handler lines do not register on
diff-cover; these call the coroutines directly (mirrors
test_run_write_endpoints_unit).
"""

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import pytest

from app.api.v1.endpoints.project_templates import (
    delete_project_template,
    export_project_template,
    import_project_template,
)
from app.schemas.hitl_session import TemplateDeleteResponse
from app.schemas.template_portable import PortableTemplate
from app.services.template_clone_service import TemplateClone, TemplateNotFoundError

_EP = "app.api.v1.endpoints.project_templates"

_DOC = PortableTemplate.model_validate(
    {"prumo_template": 1, "kind": "extraction", "name": "T",
     "sections": [{"name": "s", "label": "S"}]}
)


@pytest.mark.asyncio
async def test_export_returns_document_in_envelope() -> None:
    project_id, template_id = uuid4(), uuid4()
    with patch(f"{_EP}.to_portable", AsyncMock(return_value=_DOC)) as svc:
        resp = await export_project_template(
            project_id=project_id, template_id=template_id, request=MagicMock(),
            db=AsyncMock(), _user_sub=uuid4(),
        )
    svc.assert_awaited_once()
    assert svc.await_args.kwargs == {"project_id": project_id, "template_id": template_id}
    assert resp.ok is True and resp.data is _DOC


@pytest.mark.asyncio
async def test_export_not_found_is_404() -> None:
    from fastapi import HTTPException

    with patch(f"{_EP}.to_portable", AsyncMock(side_effect=TemplateNotFoundError("x"))):
        with pytest.raises(HTTPException) as exc:
            await export_project_template(
                project_id=uuid4(), template_id=uuid4(), request=MagicMock(),
                db=AsyncMock(), _user_sub=uuid4(),
            )
    assert exc.value.status_code == 404


@pytest.mark.asyncio
async def test_import_parses_then_imports_then_commits() -> None:
    project_id, caller = uuid4(), uuid4()
    clone = TemplateClone(
        project_template_id=uuid4(), version_id=uuid4(),
        entity_type_count=1, field_count=0, created=True,
    )
    db = AsyncMock()
    with (
        patch(f"{_EP}.parse_portable_document", return_value=_DOC) as parse,
        patch(f"{_EP}.import_portable", AsyncMock(return_value=clone)) as imp,
    ):
        resp = await import_project_template(
            project_id=project_id, body={"prumo_template": 1}, request=MagicMock(),
            db=db, current_user_sub=caller,
        )
    parse.assert_called_once_with({"prumo_template": 1})
    assert imp.await_args.kwargs == {"project_id": project_id, "doc": _DOC, "user_id": caller}
    db.commit.assert_awaited_once()
    assert resp.data.project_template_id == clone.project_template_id
    assert resp.data.created is True


@pytest.mark.asyncio
async def test_delete_returns_service_payload_and_commits() -> None:
    project_id, template_id = uuid4(), uuid4()
    payload = TemplateDeleteResponse(project_template_id=template_id, deleted=True)
    db = AsyncMock()
    with patch(f"{_EP}.delete_template", AsyncMock(return_value=payload)) as svc:
        resp = await delete_project_template(
            project_id=project_id, template_id=template_id, request=MagicMock(),
            db=db, _user_sub=uuid4(),
        )
    assert svc.await_args.kwargs == {"project_id": project_id, "template_id": template_id}
    db.commit.assert_awaited_once()
    assert resp.data == payload


@pytest.mark.asyncio
async def test_delete_not_found_is_404() -> None:
    from fastapi import HTTPException

    from app.services.project_template_active_service import ProjectTemplateNotFoundError

    with patch(f"{_EP}.delete_template", AsyncMock(side_effect=ProjectTemplateNotFoundError("x"))):
        with pytest.raises(HTTPException) as exc:
            await delete_project_template(
                project_id=uuid4(), template_id=uuid4(), request=MagicMock(),
                db=AsyncMock(), _user_sub=uuid4(),
            )
    assert exc.value.status_code == 404
```

- [ ] **Step 2: Write the failing HTTP smoke tests**

```python
# backend/tests/integration/test_template_portable_endpoints.py
"""HTTP-layer smoke for export / import / delete: routing + auth + envelope +
BOLA through the real ASGI stack. Behavior lives in the service tests."""

from __future__ import annotations

from collections.abc import AsyncGenerator
from uuid import UUID, uuid4

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import TokenPayload, get_current_user
from app.main import app
from tests.integration.conftest import SEED, clean_project_clones, clone_charms


@pytest_asyncio.fixture
async def auth_as_profile(db_session: AsyncSession) -> AsyncGenerator[UUID, None]:
    del db_session
    profile_id = SEED.primary_profile

    async def override_get_current_user() -> TokenPayload:
        return TokenPayload(
            sub=str(profile_id), email="test@example.com", role="authenticated", aal="aal1"
        )

    app.dependency_overrides[get_current_user] = override_get_current_user
    yield profile_id


@pytest.mark.asyncio
async def test_export_then_import_over_http(
    db_session: AsyncSession, db_client: AsyncClient, auth_as_profile: UUID
) -> None:
    project_id = SEED.secondary_project
    await clean_project_clones(db_session, project_id)
    clone = await clone_charms(db_session, project_id, auth_as_profile)

    r = await db_client.get(
        f"/api/v1/projects/{project_id}/templates/{clone.project_template_id}/export"
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["ok"] is True
    doc = body["data"]
    assert doc["prumo_template"] == 1 and doc["kind"] == "extraction"
    # File keys, not attribute names; defaults omitted (spec §4) — a field
    # carries "required" only when it is true.
    first_field = doc["sections"][0]["fields"][0]
    assert "type" in first_field and "field_type" not in first_field
    assert first_field.get("required", True) is True
    assert all("allow_other" not in f or f["allow_other"] is True
               for s in doc["sections"] for f in s.get("fields", []))

    r = await db_client.post(f"/api/v1/projects/{project_id}/templates/import", json=doc)
    assert r.status_code == 201, r.text
    assert r.json()["data"]["created"] is True


@pytest.mark.asyncio
async def test_import_wrong_kind_is_typed_422(
    db_client: AsyncClient, auth_as_profile: UUID
) -> None:
    r = await db_client.post(
        f"/api/v1/projects/{SEED.secondary_project}/templates/import",
        json={"prumo_template": 1, "kind": "quality_assessment", "name": "x", "sections": []},
    )
    assert r.status_code == 422
    assert r.json()["error"]["code"] == "TEMPLATE_IMPORT_WRONG_KIND"


@pytest.mark.asyncio
async def test_export_foreign_project_is_404(
    db_session: AsyncSession, db_client: AsyncClient, auth_as_profile: UUID
) -> None:
    await clean_project_clones(db_session, SEED.secondary_project)
    clone = await clone_charms(db_session, SEED.secondary_project, auth_as_profile)
    r = await db_client.get(
        f"/api/v1/projects/{SEED.primary_project}/templates/{clone.project_template_id}/export"
    )
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_delete_active_is_typed_409(
    db_session: AsyncSession, db_client: AsyncClient, auth_as_profile: UUID
) -> None:
    project_id = SEED.secondary_project
    await clean_project_clones(db_session, project_id)
    clone = await clone_charms(db_session, project_id, auth_as_profile)
    r = await db_client.delete(
        f"/api/v1/projects/{project_id}/templates/{clone.project_template_id}"
    )
    assert r.status_code == 409
    assert r.json()["error"]["code"] == "TEMPLATE_ACTIVE"


@pytest.mark.asyncio
async def test_delete_unknown_is_404(db_client: AsyncClient, auth_as_profile: UUID) -> None:
    r = await db_client.delete(f"/api/v1/projects/{SEED.secondary_project}/templates/{uuid4()}")
    assert r.status_code == 404
```

`db_client` (`backend/tests/conftest.py`) overrides `get_db` to yield the SAME `db_session`, so rows the test inserts are visible to the request without a commit; the endpoints' own `await db.commit()` commits that shared session, exactly as `test_template_structure_endpoints.py` already tolerates.

- [ ] **Step 3: Run both files to verify they fail**

Run: `cd backend && uv run pytest tests/unit/test_project_templates_portable_endpoints_unit.py tests/integration/test_template_portable_endpoints.py -q`
Expected: FAIL — `ImportError: cannot import name 'export_project_template'`.

- [ ] **Step 4: Add the endpoints**

In `backend/app/api/v1/endpoints/project_templates.py`:

Imports to add:

```python
from typing import Any

from fastapi import Body

from app.schemas.hitl_session import TemplateDeleteResponse  # add to the existing import list
from app.schemas.template_portable import PortableTemplate
from app.services.template_delete_service import delete_template
from app.services.template_portable_service import (
    import_portable,
    parse_portable_document,
    to_portable,
)
```

Endpoints (append after `update_project_template_active`):

```python
@router.get(
    "/{project_id}/templates/{template_id}/export",
    # The file IS the document: defaults omitted, file keys (``type``,
    # ``required``) not attribute names. ``ok`` is a required envelope field
    # so it survives exclude_defaults; ``error``/``trace_id`` drop when None.
    response_model_exclude_defaults=True,
    response_model_by_alias=True,
)
async def export_project_template(
    project_id: UUID,
    template_id: UUID,
    request: Request,
    db: DbSession,
    _user_sub: UUID = Depends(require_project_manager),
) -> ApiResponse[PortableTemplate]:
    """Export the template's LIVE structure as a ``prumo-template@1`` document.

    Reads no draft state and takes no locks — the pending-draft confirmation
    is the frontend's (it already holds ``config-status``). The frontend
    writes ``data`` to disk, never the envelope.
    """
    try:
        doc = await to_portable(db, project_id=project_id, template_id=template_id)
    except TemplateNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    return ApiResponse.success(doc, trace_id=getattr(request.state, "trace_id", None))


@router.post(
    "/{project_id}/templates/import",
    status_code=status.HTTP_201_CREATED,
)
@limiter.limit("10/minute")
async def import_project_template(
    project_id: UUID,
    request: Request,
    db: DbSession,
    body: dict[str, Any] = Body(...),
    current_user_sub: UUID = Depends(require_project_manager),
) -> ApiResponse[CloneTemplateResponse]:
    """Import a ``prumo-template@1`` document as a NEW active project template.

    The body is deliberately untyped at the HTTP layer: the document's schema
    is published through the export response (same ``PortableTemplate``
    component), and parsing in the service is what turns a bad file into the
    typed 422s (``TemplateImportRefusalCode``) instead of FastAPI's un-enveloped
    request-validation body. Same response shape as the catalogue clone.
    """
    doc = parse_portable_document(body)
    result = await import_portable(
        db, project_id=project_id, doc=doc, user_id=current_user_sub
    )
    await db.commit()
    return ApiResponse.success(
        CloneTemplateResponse(
            project_template_id=result.project_template_id,
            version_id=result.version_id,
            entity_type_count=result.entity_type_count,
            field_count=result.field_count,
            created=result.created,
        ),
        trace_id=getattr(request.state, "trace_id", None),
    )


@router.delete("/{project_id}/templates/{template_id}")
async def delete_project_template(
    project_id: UUID,
    template_id: UUID,
    request: Request,
    db: DbSession,
    _user_sub: UUID = Depends(require_project_manager),
) -> ApiResponse[TemplateDeleteResponse]:
    """Delete an INACTIVE, unreferenced project template (spec §5.7).

    ``TemplateActiveError`` / ``TemplateInUseError`` are ``AppError``s and
    reach ``app_error_handler`` typed (``TemplateDeleteRefusalCode``).
    """
    try:
        result = await delete_template(db, project_id=project_id, template_id=template_id)
    except ProjectTemplateNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    await db.commit()
    return ApiResponse.success(result, trace_id=getattr(request.state, "trace_id", None))
```

Check `limiter.limit` usage on an endpoint whose first positional param is not `request` — the existing `republish_template_version` passes `request: Request` explicitly; keep `request` in the signature (slowapi requires it). If the `Body(...)` default after `request`/`db` trips ruff `B008`, move `body` before `request` in the signature and update the unit test's keyword call (it uses keywords, so order is free).

Update the module docstring at the top of the file with three bullets for the new routes.

- [ ] **Step 5: Run to verify they pass, then the whole template suite**

Run: `cd backend && uv run pytest tests/unit/test_project_templates_portable_endpoints_unit.py tests/integration/test_template_portable_endpoints.py -q`
Expected: PASS.

Run: `cd backend && uv run pytest tests/integration -q -k "template"`
Expected: PASS.

Run from the worktree root: `bash scripts/fitness/run_all.sh`
Expected: every fitness checker OK (layered-arch, query keys, frontend data path, file size).

- [ ] **Step 6: Regenerate the API contract**

Run from the worktree root: `npm run generate:api-types`
Expected: `frontend/types/api/openapi.json` and `schema.d.ts` change; `grep -n "PortableTemplate\|TemplateDeleteResponse" frontend/types/api/schema.d.ts` shows both.

- [ ] **Step 7: Docs**

In `docs/reference/extraction-hitl-architecture.md` §4.3 add, after the clone table:

```markdown
**File import/export (2026-08-23).** The same dialog (now "Switch template")
also lists the project's own templates — active and inactive — with *Switch
to* (`PATCH …/templates/{id}`, which since this slice deactivates the
extraction sibling first) and *Delete* (`DELETE …/templates/{id}`: 409
`TEMPLATE_ACTIVE` / `TEMPLATE_IN_USE`, else DB cascade + the template-scoped
`extraction_hitl_configs` row). `GET …/templates/{id}/export` serializes the
**live** structure as a `prumo-template@1` document (`app/schemas/
template_portable.py`: nested, UUID-free, `role` derived from nesting + a
`group` flag); `POST …/templates/import` creates a **new** active template
from one and publishes v1 through `republish`. Design:
`docs/superpowers/specs/2026-08-23-template-portable-import-export-design.md`.
```

Set `last_reviewed: 2026-08-23` in that file's frontmatter.

- [ ] **Step 8: Lint, frontmatter, commit**

```bash
cd backend && uv run ruff check app/api/v1/endpoints/project_templates.py tests/ && uv run ruff format --check app/ tests/ && cd ..
bash scripts/docs/check-frontmatter.sh
git add backend/app/api/v1/endpoints/project_templates.py backend/tests/unit/test_project_templates_portable_endpoints_unit.py backend/tests/integration/test_template_portable_endpoints.py frontend/types/api/openapi.json frontend/types/api/schema.d.ts docs/reference/extraction-hitl-architecture.md
git commit -m "feat(api): template export, import and delete endpoints + regenerated contract"
```

---

### Task 6: Frontend services, download helper, copy keys

**Files:**
- Create: `frontend/lib/download.ts`
- Modify: `frontend/components/articles/ArticlesExportDialog.tsx` (replace the private `triggerDownload` at ~line 60 with the import)
- Modify: `frontend/services/templateImportService.ts`
- Modify: `frontend/lib/copy/extraction.ts`
- Test: `frontend/services/templateImportService.test.ts`

**Interfaces:**
- Produces:
  - `triggerDownload(blob: Blob, filename: string): void` in `@/lib/download`.
  - In `@/services/templateImportService`: `type PortableTemplateDoc = components['schemas']['PortableTemplate']`; `exportTemplate(projectId, templateId): Promise<ErrorResult<PortableTemplateDoc>>`; `templateExportFilename(name: string): string` (`<slug>.prumo-template.json`); `importTemplateFromFile(projectId, file: File): Promise<ErrorResult<{templateId: string; entityTypesAdded: number; fieldsAdded: number}>>`; `deleteTemplate(projectId, templateId): Promise<ErrorResult<{deleted: boolean}>>`.
  - Copy keys (all in `extraction`): `templateDialogTitle: 'Switch template'`, `templateDialogDesc: 'Switch between this project\'s templates, or add one from the catalogue or a file.'`, `projectTemplatesHeading: "This project's templates"`, `projectTemplatesEmpty: 'No templates yet.'`, `projectTemplateActive: 'Active'`, `projectTemplateCreated: 'Added {{date}}'`, `projectTemplateSwitch: 'Switch to'`, `projectTemplateSwitchTooltip: 'Make this the active template'`, `projectTemplateDelete: 'Delete template'`, `projectTemplateDeleteTitle: 'Delete "{{name}}"?'`, `projectTemplateDeleteBody: 'Its sections and fields are removed. This cannot be undone.'`, `projectTemplateDeleted: 'Template deleted'`, `importFromCatalogueHeading: 'Add from the catalogue'`, `importFromFileHeading: 'Add from a file'`, `importFromFileHint: 'A .prumo-template.json file exported from prumo.'`, `importFromFileTrust: 'Only import templates you trust — a file can carry AI instructions.'`, `importFileChoose: 'Choose file'`, `importFileNone: 'No file selected'`, `importFileSubmit: 'Import file'`, `importFileNotJson: 'This is not a valid JSON file.'`, `importFileErrorsHeading: 'The file was rejected:'`, `exportTemplateButton: 'Export'`, `exportTemplateTooltip: 'Download this template as a JSON file'`, `exportDraftTitle: 'Export unpublished changes?'`, `exportDraftBody: 'This file includes unpublished changes.'`, `exportDraftConfirm: 'Export anyway'`, `exportError: 'Could not export the template'`, `templateSwitched: 'Switched to "{{name}}"'`.

- [ ] **Step 1: Write the failing service tests**

```ts
// frontend/services/templateImportService.test.ts
import {beforeEach, describe, expect, it, vi} from 'vitest';

vi.mock('@/integrations/api/client', () => ({
  apiClient: vi.fn(),
  ApiError: class ApiError extends Error {
    constructor(public code: string, message: string, public status: number, public details?: Record<string, unknown>) {
      super(message);
    }
  },
}));
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {auth: {getUser: vi.fn(async () => ({data: {user: {id: 'u'}}}))}},
}));

import {apiClient} from '@/integrations/api/client';
import {
  deleteTemplate,
  exportTemplate,
  importTemplateFromFile,
  templateExportFilename,
} from '@/services/templateImportService';

const mockedApi = vi.mocked(apiClient);

describe('templateImportService (portable)', () => {
  beforeEach(() => mockedApi.mockReset());

  it('templateExportFilename slugifies the name', () => {
    expect(templateExportFilename('CHARMS (custom) v2')).toBe('charms-custom-v2.prumo-template.json');
    expect(templateExportFilename('   ')).toBe('template.prumo-template.json');
  });

  it('exportTemplate GETs the export route and returns the unwrapped document', async () => {
    const doc = {prumo_template: 1, kind: 'extraction', name: 'T', sections: []};
    mockedApi.mockResolvedValueOnce(doc);
    const result = await exportTemplate('p1', 't1');
    expect(mockedApi).toHaveBeenCalledWith('/api/v1/projects/p1/templates/t1/export', {method: 'GET'});
    expect(result.ok && result.data).toEqual(doc);
  });

  it('importTemplateFromFile rejects a non-JSON file locally, without calling the API', async () => {
    const file = new File(['{not json'], 'x.json', {type: 'application/json'});
    const result = await importTemplateFromFile('p1', file);
    expect(result.ok).toBe(false);
    expect(mockedApi).not.toHaveBeenCalled();
  });

  it('importTemplateFromFile POSTs the parsed object and maps the clone response', async () => {
    mockedApi.mockResolvedValueOnce({
      project_template_id: 'new', version_id: 'v', entity_type_count: 3, field_count: 7, created: true,
    });
    const file = new File([JSON.stringify({prumo_template: 1})], 'x.json');
    const result = await importTemplateFromFile('p1', file);
    expect(mockedApi).toHaveBeenCalledWith(
      '/api/v1/projects/p1/templates/import',
      expect.objectContaining({method: 'POST', body: {prumo_template: 1}, timeout: 120_000}),
    );
    expect(result.ok && result.data).toEqual({templateId: 'new', entityTypesAdded: 3, fieldsAdded: 7});
  });

  it('deleteTemplate DELETEs the template route', async () => {
    mockedApi.mockResolvedValueOnce({project_template_id: 't1', deleted: true});
    const result = await deleteTemplate('p1', 't1');
    expect(mockedApi).toHaveBeenCalledWith('/api/v1/projects/p1/templates/t1', {method: 'DELETE'});
    expect(result.ok && result.data).toEqual({deleted: true});
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm run test:run -- frontend/services/templateImportService.test.ts`
Expected: FAIL — `exportTemplate is not a function` (or import error).

- [ ] **Step 3: Write the download helper and switch ArticlesExportDialog to it**

```ts
// frontend/lib/download.ts
/** Hand the browser a file to save. The object URL is revoked right after
 * the click — the download has already been handed off by then. */
export function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
```

In `frontend/components/articles/ArticlesExportDialog.tsx`: delete the private `function triggerDownload(...)` block and add `import {triggerDownload} from '@/lib/download';`. Run `npm run test:run -- frontend/components/articles` to confirm nothing there regressed.

- [ ] **Step 4: Add the service functions**

Append to `frontend/services/templateImportService.ts` (keep `importGlobalTemplate` untouched):

```ts
import {toResult, type ErrorResult} from '@/lib/error-utils';
import type {components} from '@/types/api/schema';

export type PortableTemplateDoc = components['schemas']['PortableTemplate'];

/** `<slug>.prumo-template.json`; falls back to `template` for an empty slug. */
export function templateExportFilename(name: string): string {
  const slug = name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `${slug || 'template'}.prumo-template.json`;
}

/** The export endpoint returns the document as `data`; the caller writes
 * THAT to disk — never the envelope (the importer is `extra="forbid"`). */
export function exportTemplate(
  projectId: string,
  templateId: string,
): Promise<ErrorResult<PortableTemplateDoc>> {
  return toResult(
    () =>
      apiClient<PortableTemplateDoc>(
        `/api/v1/projects/${projectId}/templates/${templateId}/export`,
        {method: 'GET'},
      ),
    'templateImportService.exportTemplate',
  );
}

export interface FileImportResult {
  templateId: string;
  entityTypesAdded: number;
  fieldsAdded: number;
}

/** Read → JSON.parse (syntax only — the SERVER validates the document) → POST. */
export function importTemplateFromFile(
  projectId: string,
  file: File,
): Promise<ErrorResult<FileImportResult>> {
  return toResult(async () => {
    const text = await file.text();
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error(t('extraction', 'importFileNotJson'));
    }
    const result = await apiClient<CloneTemplateResponse>(
      `/api/v1/projects/${projectId}/templates/import`,
      {method: 'POST', body: parsed as Record<string, unknown>, timeout: 120_000},
    );
    return {
      templateId: result.project_template_id,
      entityTypesAdded: result.entity_type_count,
      fieldsAdded: result.field_count,
    };
  }, 'templateImportService.importTemplateFromFile');
}

export function deleteTemplate(
  projectId: string,
  templateId: string,
): Promise<ErrorResult<{deleted: boolean}>> {
  return toResult(async () => {
    const result = await apiClient<components['schemas']['TemplateDeleteResponse']>(
      `/api/v1/projects/${projectId}/templates/${templateId}`,
      {method: 'DELETE'},
    );
    return {deleted: result.deleted};
  }, 'templateImportService.deleteTemplate');
}
```

Check `toResult`'s actual signature in `frontend/lib/error-utils.ts` (it is used as `toResult(async () => {...}, 'label')` in `qaTemplateService.ts`) and whether `apiClient`'s `body` type accepts `Record<string, unknown>`; adjust the cast, not the contract. If `ErrorResult` is exported under a different name, import that.

- [ ] **Step 5: Add the copy keys**

In `frontend/lib/copy/extraction.ts`, add a `// Switch-template dialog (portable import/export)` block with every key from the Interfaces list above, verbatim values. Run `npm run test:run -- frontend/test/copy-run-vocabulary.test.ts` — must stay green (no "Runs" noun).

- [ ] **Step 6: Run to verify they pass**

Run: `npm run test:run -- frontend/services/templateImportService.test.ts frontend/components/articles`
Expected: PASS.

- [ ] **Step 7: Typecheck, lint, commit**

```bash
npx tsc -p tsconfig.app.json --noEmit && npm run lint -- frontend/services/templateImportService.ts frontend/lib/download.ts frontend/lib/copy/extraction.ts frontend/components/articles/ArticlesExportDialog.tsx
git add frontend/lib/download.ts frontend/components/articles/ArticlesExportDialog.tsx frontend/services/templateImportService.ts frontend/services/templateImportService.test.ts frontend/lib/copy/extraction.ts
git commit -m "feat(frontend): portable template services, download helper, dialog copy"
```

---

### Task 7: `ProjectTemplatesList` (Switch + Delete)

**Files:**
- Create: `frontend/components/extraction/dialogs/ProjectTemplatesList.tsx`
- Test: `frontend/components/extraction/dialogs/ProjectTemplatesList.test.tsx`

**Interfaces:**
- Consumes: `useHITLProjectTemplates({projectId, kind: 'extraction', includeInactive: true})` → `{templates, loading, refresh, setTemplateActive}` (`ProjectTemplate` has `id, name, framework, is_active, created_at`); `deleteTemplate` from Task 6; copy keys from Task 6; shadcn `Button`, `Badge`, `Tooltip*`, `AlertDialog*` from `@/components/ui/alert-dialog`.
- Produces: `export function ProjectTemplatesList({projectId, onSwitched, onDeleted}: {projectId: string; onSwitched: (templateId: string) => void; onDeleted: () => void})`. Test ids: `project-template-row-{id}`, `project-template-switch-{id}`, `project-template-delete-{id}`, `project-template-delete-confirm`, `project-template-delete-error`.

- [ ] **Step 1: Write the failing test**

```tsx
// frontend/components/extraction/dialogs/ProjectTemplatesList.test.tsx
import {fireEvent, render, screen, waitFor} from '@testing-library/react';
import {beforeEach, describe, expect, it, vi} from 'vitest';

const setTemplateActive = vi.fn(async () => true);
const refresh = vi.fn(async () => []);
const templatesState = {
  templates: [
    {id: 'a', name: 'Active one', framework: 'CHARMS', is_active: true, created_at: '2026-08-01T00:00:00Z'},
    {id: 'b', name: 'Imported', framework: 'CUSTOM', is_active: false, created_at: '2026-08-20T00:00:00Z'},
  ],
  loading: false,
  refresh,
  setTemplateActive,
};
vi.mock('@/hooks/hitl/useHITLProjectTemplates', () => ({
  useHITLProjectTemplates: () => templatesState,
}));
const deleteTemplate = vi.fn();
vi.mock('@/services/templateImportService', () => ({deleteTemplate: (...a: unknown[]) => deleteTemplate(...a)}));
vi.mock('sonner', () => ({toast: {success: vi.fn(), error: vi.fn()}}));

import {ProjectTemplatesList} from './ProjectTemplatesList';

describe('ProjectTemplatesList', () => {
  beforeEach(() => {
    setTemplateActive.mockClear();
    refresh.mockClear();
    deleteTemplate.mockReset();
  });

  it('marks the active row and offers Switch/Delete only on inactive rows', () => {
    render(<ProjectTemplatesList projectId="p" onSwitched={vi.fn()} onDeleted={vi.fn()} />);
    expect(screen.getByTestId('project-template-row-a')).toHaveTextContent('Active');
    expect(screen.queryByTestId('project-template-switch-a')).toBeNull();
    expect(screen.queryByTestId('project-template-delete-a')).toBeNull();
    expect(screen.getByTestId('project-template-switch-b')).toBeInTheDocument();
    expect(screen.getByTestId('project-template-delete-b')).toBeInTheDocument();
  });

  it('Switch activates the template and reports the id', async () => {
    const onSwitched = vi.fn();
    render(<ProjectTemplatesList projectId="p" onSwitched={onSwitched} onDeleted={vi.fn()} />);
    fireEvent.click(screen.getByTestId('project-template-switch-b'));
    await waitFor(() => expect(setTemplateActive).toHaveBeenCalledWith('b', true));
    expect(onSwitched).toHaveBeenCalledWith('b');
  });

  it('Delete asks for confirmation, then deletes, refreshes and reports', async () => {
    deleteTemplate.mockResolvedValueOnce({ok: true, data: {deleted: true}});
    const onDeleted = vi.fn();
    render(<ProjectTemplatesList projectId="p" onSwitched={vi.fn()} onDeleted={onDeleted} />);
    fireEvent.click(screen.getByTestId('project-template-delete-b'));
    expect(deleteTemplate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('project-template-delete-confirm'));
    await waitFor(() => expect(deleteTemplate).toHaveBeenCalledWith('p', 'b'));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(onDeleted).toHaveBeenCalled();
  });

  it('renders a 409 message inline', async () => {
    deleteTemplate.mockResolvedValueOnce({
      ok: false,
      error: {code: 'TEMPLATE_IN_USE', message: 'extractions already reference it'},
    });
    render(<ProjectTemplatesList projectId="p" onSwitched={vi.fn()} onDeleted={vi.fn()} />);
    fireEvent.click(screen.getByTestId('project-template-delete-b'));
    fireEvent.click(screen.getByTestId('project-template-delete-confirm'));
    expect(await screen.findByTestId('project-template-delete-error')).toHaveTextContent(
      'extractions already reference it',
    );
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test:run -- frontend/components/extraction/dialogs/ProjectTemplatesList.test.tsx`
Expected: FAIL — cannot resolve `./ProjectTemplatesList`.

- [ ] **Step 3: Write the component**

```tsx
// frontend/components/extraction/dialogs/ProjectTemplatesList.tsx
/**
 * "This project's templates" — every extraction template of the project,
 * active AND inactive (spec §3.5: a file-imported template has no catalogue
 * row, so this list is the only place it stays reachable once deactivated).
 * Inactive rows carry Switch (PATCH is_active) and Delete (confirm → DELETE);
 * the active row carries neither.
 */

import {useState} from 'react';
import {Loader2, Trash2} from 'lucide-react';
import {toast} from 'sonner';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {Badge} from '@/components/ui/badge';
import {Button} from '@/components/ui/button';
import {Tooltip, TooltipContent, TooltipTrigger} from '@/components/ui/tooltip';
import {useHITLProjectTemplates, type ProjectTemplate} from '@/hooks/hitl/useHITLProjectTemplates';
import {t} from '@/lib/copy';
import {deleteTemplate} from '@/services/templateImportService';

interface ProjectTemplatesListProps {
  projectId: string;
  onSwitched: (templateId: string) => void;
  onDeleted: () => void;
}

export function ProjectTemplatesList({projectId, onSwitched, onDeleted}: ProjectTemplatesListProps) {
  const {templates, loading, refresh, setTemplateActive} = useHITLProjectTemplates({
    projectId,
    kind: 'extraction',
    includeInactive: true,
  });
  const [pendingDelete, setPendingDelete] = useState<ProjectTemplate | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const handleSwitch = async (tpl: ProjectTemplate) => {
    setBusyId(tpl.id);
    const ok = await setTemplateActive(tpl.id, true);
    setBusyId(null);
    if (ok) onSwitched(tpl.id);
  };

  const handleDeleteConfirmed = async () => {
    if (!pendingDelete) return;
    const target = pendingDelete;
    setPendingDelete(null);
    setDeleteError(null);
    setBusyId(target.id);
    const result = await deleteTemplate(projectId, target.id);
    setBusyId(null);
    if (!result.ok) {
      setDeleteError(result.error.message);
      return;
    }
    toast.success(t('extraction', 'projectTemplateDeleted'));
    await refresh().catch(() => undefined);
    onDeleted();
  };

  return (
    <section aria-labelledby="project-templates-heading" className="space-y-2">
      <h3 id="project-templates-heading" className="text-[13px] font-medium text-foreground">
        {t('extraction', 'projectTemplatesHeading')}
      </h3>
      {loading ? (
        <div className="flex items-center gap-2 py-3 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          {t('extraction', 'importLoadingTemplates')}
        </div>
      ) : templates.length === 0 ? (
        <p className="py-3 text-sm text-muted-foreground">{t('extraction', 'projectTemplatesEmpty')}</p>
      ) : (
        <ul className="divide-y divide-border/40 rounded-md border border-border/40">
          {templates.map((tpl) => (
            <li
              key={tpl.id}
              data-testid={`project-template-row-${tpl.id}`}
              className="flex items-center gap-3 px-3 py-2 text-[13px]"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate font-medium text-foreground">{tpl.name}</span>
                  <Badge variant="outline" className="text-[11px] uppercase">{tpl.framework}</Badge>
                  {tpl.is_active && <Badge className="text-[11px]">{t('extraction', 'projectTemplateActive')}</Badge>}
                </div>
                <div className="text-xs text-muted-foreground">
                  {t('extraction', 'projectTemplateCreated').replace(
                    '{{date}}',
                    new Date(tpl.created_at).toLocaleDateString(),
                  )}
                </div>
              </div>
              {!tpl.is_active && (
                <>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        size="sm"
                        variant="outline"
                        data-testid={`project-template-switch-${tpl.id}`}
                        disabled={busyId !== null}
                        onClick={() => void handleSwitch(tpl)}
                      >
                        {busyId === tpl.id ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
                        {t('extraction', 'projectTemplateSwitch')}
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>{t('extraction', 'projectTemplateSwitchTooltip')}</TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8 text-muted-foreground hover:text-destructive"
                        aria-label={t('extraction', 'projectTemplateDelete')}
                        data-testid={`project-template-delete-${tpl.id}`}
                        disabled={busyId !== null}
                        onClick={() => setPendingDelete(tpl)}
                      >
                        <Trash2 className="h-4 w-4" aria-hidden />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>{t('extraction', 'projectTemplateDelete')}</TooltipContent>
                  </Tooltip>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      {deleteError && (
        <p role="alert" data-testid="project-template-delete-error" className="text-xs text-destructive">
          {deleteError}
        </p>
      )}

      <AlertDialog open={pendingDelete !== null} onOpenChange={(open) => !open && setPendingDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t('extraction', 'projectTemplateDeleteTitle').replace('{{name}}', pendingDelete?.name ?? '')}
            </AlertDialogTitle>
            <AlertDialogDescription>{t('extraction', 'projectTemplateDeleteBody')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common', 'cancel')}</AlertDialogCancel>
            <AlertDialogAction
              data-testid="project-template-delete-confirm"
              onClick={() => void handleDeleteConfirmed()}
            >
              {t('extraction', 'projectTemplateDelete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
```

If `ProjectTemplate` is not exported from the hook, export it (it is declared there). `Tooltip` needs a `TooltipProvider` ancestor — check how other tests render tooltip-bearing components (`frontend/test/` has examples wrapping in `TooltipProvider`); wrap the render in the test if required.

- [ ] **Step 4: Run to verify it passes**

Run: `npm run test:run -- frontend/components/extraction/dialogs/ProjectTemplatesList.test.tsx`
Expected: PASS.

- [ ] **Step 5: Typecheck, lint, commit**

```bash
npx tsc -p tsconfig.app.json --noEmit && npm run lint -- frontend/components/extraction/dialogs/ProjectTemplatesList.tsx frontend/components/extraction/dialogs/ProjectTemplatesList.test.tsx
git add frontend/components/extraction/dialogs/ProjectTemplatesList.tsx frontend/components/extraction/dialogs/ProjectTemplatesList.test.tsx
git commit -m "feat(frontend): project templates list with switch and guarded delete"
```

---

### Task 8: `ImportTemplateFilePane`

**Files:**
- Create: `frontend/components/extraction/dialogs/ImportTemplateFilePane.tsx`
- Test: `frontend/components/extraction/dialogs/ImportTemplateFilePane.test.tsx`

**Interfaces:**
- Consumes: `importTemplateFromFile` (Task 6); copy keys (Task 6).
- Produces: `export function ImportTemplateFilePane({projectId, onImported}: {projectId: string; onImported: (templateId: string) => void})`. Test ids: `import-template-file-input`, `import-template-file-submit`, `import-template-file-errors`.

- [ ] **Step 1: Write the failing test**

```tsx
// frontend/components/extraction/dialogs/ImportTemplateFilePane.test.tsx
import {fireEvent, render, screen, waitFor} from '@testing-library/react';
import {beforeEach, describe, expect, it, vi} from 'vitest';

const importTemplateFromFile = vi.fn();
vi.mock('@/services/templateImportService', () => ({
  importTemplateFromFile: (...a: unknown[]) => importTemplateFromFile(...a),
}));
vi.mock('sonner', () => ({toast: {success: vi.fn(), error: vi.fn()}}));

import {ImportTemplateFilePane} from './ImportTemplateFilePane';

function pickFile() {
  const input = screen.getByTestId('import-template-file-input') as HTMLInputElement;
  const file = new File(['{}'], 'x.prumo-template.json', {type: 'application/json'});
  fireEvent.change(input, {target: {files: [file]}});
  return file;
}

describe('ImportTemplateFilePane', () => {
  beforeEach(() => importTemplateFromFile.mockReset());

  it('submit is disabled until a file is chosen', () => {
    render(<ImportTemplateFilePane projectId="p" onImported={vi.fn()} />);
    expect(screen.getByTestId('import-template-file-submit')).toBeDisabled();
    pickFile();
    expect(screen.getByTestId('import-template-file-submit')).toBeEnabled();
  });

  it('posts the file and reports the new template id', async () => {
    importTemplateFromFile.mockResolvedValueOnce({
      ok: true, data: {templateId: 'new', entityTypesAdded: 2, fieldsAdded: 5},
    });
    const onImported = vi.fn();
    render(<ImportTemplateFilePane projectId="p" onImported={onImported} />);
    const file = pickFile();
    fireEvent.click(screen.getByTestId('import-template-file-submit'));
    await waitFor(() => expect(importTemplateFromFile).toHaveBeenCalledWith('p', file));
    expect(onImported).toHaveBeenCalledWith('new');
  });

  it('renders the server rejection list', async () => {
    importTemplateFromFile.mockResolvedValueOnce({
      ok: false,
      error: {
        code: 'TEMPLATE_IMPORT_INVALID',
        message: 'Invalid template file:\nsections[0].fields[1].name: String should match pattern',
      },
    });
    render(<ImportTemplateFilePane projectId="p" onImported={vi.fn()} />);
    pickFile();
    fireEvent.click(screen.getByTestId('import-template-file-submit'));
    const errors = await screen.findByTestId('import-template-file-errors');
    expect(errors).toHaveTextContent('sections[0].fields[1].name');
  });

  it('shows the trust notice', () => {
    render(<ImportTemplateFilePane projectId="p" onImported={vi.fn()} />);
    expect(screen.getByText(/Only import templates you trust/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test:run -- frontend/components/extraction/dialogs/ImportTemplateFilePane.test.tsx`
Expected: FAIL — cannot resolve `./ImportTemplateFilePane`.

- [ ] **Step 3: Write the component**

```tsx
// frontend/components/extraction/dialogs/ImportTemplateFilePane.tsx
/**
 * "Add from a file" — a prumo-template@1 JSON file becomes a NEW active
 * template. The browser parses JSON syntax only; the SERVER validates the
 * document and its rejection list renders here verbatim (spec §6.2).
 */

import {useId, useState} from 'react';
import {Loader2, Upload} from 'lucide-react';
import {toast} from 'sonner';

import {Button} from '@/components/ui/button';
import {t} from '@/lib/copy';
import {importTemplateFromFile} from '@/services/templateImportService';

interface ImportTemplateFilePaneProps {
  projectId: string;
  onImported: (templateId: string) => void;
}

export function ImportTemplateFilePane({projectId, onImported}: ImportTemplateFilePaneProps) {
  const inputId = useId();
  const [file, setFile] = useState<File | null>(null);
  const [importing, setImporting] = useState(false);
  const [errorLines, setErrorLines] = useState<string[] | null>(null);

  const handleImport = async () => {
    if (!file) return;
    setImporting(true);
    setErrorLines(null);
    const result = await importTemplateFromFile(projectId, file);
    setImporting(false);
    if (!result.ok) {
      // The server message is "heading\npath: msg\n…" — one line per entry.
      setErrorLines(result.error.message.split('\n').filter(Boolean));
      return;
    }
    toast.success(
      `${t('extraction', 'importSuccess')}: "${file.name}". ${result.data.entityTypesAdded} ${t('extraction', 'importSections')}, ${result.data.fieldsAdded} fields.`,
    );
    setFile(null);
    onImported(result.data.templateId);
  };

  return (
    <section aria-labelledby={`${inputId}-heading`} className="space-y-2">
      <h3 id={`${inputId}-heading`} className="text-[13px] font-medium text-foreground">
        {t('extraction', 'importFromFileHeading')}
      </h3>
      <p className="text-xs text-muted-foreground">{t('extraction', 'importFromFileHint')}</p>
      <div className="flex items-center gap-2">
        <label
          htmlFor={inputId}
          // `relative`: the sr-only input inside is absolutely positioned — without
          // a positioned ancestor it adds phantom page scroll.
          className="relative inline-flex h-8 cursor-pointer items-center rounded-md border border-border/60 px-3 text-xs font-medium hover:bg-muted/50"
        >
          {t('extraction', 'importFileChoose')}
          <input
            id={inputId}
            type="file"
            accept="application/json,.json"
            className="sr-only"
            data-testid="import-template-file-input"
            onChange={(event) => {
              setFile(event.target.files?.[0] ?? null);
              setErrorLines(null);
            }}
          />
        </label>
        <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
          {file?.name ?? t('extraction', 'importFileNone')}
        </span>
        <Button
          size="sm"
          data-testid="import-template-file-submit"
          disabled={!file || importing}
          onClick={() => void handleImport()}
        >
          {importing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> : <Upload className="mr-2 h-4 w-4" aria-hidden />}
          {t('extraction', 'importFileSubmit')}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">{t('extraction', 'importFromFileTrust')}</p>
      {errorLines && (
        <div
          role="alert"
          data-testid="import-template-file-errors"
          className="rounded-md border border-destructive/40 bg-destructive/5 p-2 text-xs text-destructive"
        >
          <div className="font-medium">{t('extraction', 'importFileErrorsHeading')}</div>
          <ul className="mt-1 list-disc space-y-0.5 pl-4 font-mono">
            {errorLines.map((line, i) => (
              <li key={i}>{line}</li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm run test:run -- frontend/components/extraction/dialogs/ImportTemplateFilePane.test.tsx`
Expected: PASS.

- [ ] **Step 5: Typecheck, lint, commit**

```bash
npx tsc -p tsconfig.app.json --noEmit && npm run lint -- frontend/components/extraction/dialogs/ImportTemplateFilePane.tsx frontend/components/extraction/dialogs/ImportTemplateFilePane.test.tsx
git add frontend/components/extraction/dialogs/ImportTemplateFilePane.tsx frontend/components/extraction/dialogs/ImportTemplateFilePane.test.tsx
git commit -m "feat(frontend): import-from-file pane for the template dialog"
```

---

### Task 9: Compose the dialog; rename the host callback

**Files:**
- Modify: `frontend/components/extraction/dialogs/ImportTemplateDialog.tsx`
- Modify: `frontend/components/extraction/TemplateConfigEditor.tsx` (~line 383: `onTemplateImported` prop)
- Modify: `frontend/components/extraction/ExtractionInterface.tsx` (~line 593: `onTemplateImported` prop)
- Test: `frontend/components/extraction/dialogs/ImportTemplateDialog.test.tsx` (create)

**Interfaces:**
- Produces: `ImportTemplateDialog` props — `projectId`, `open`, `onOpenChange`, `onTemplatesChanged: (activeTemplateId?: string) => void` (replaces `onTemplateImported`), `initialTemplateId?`. The dialog closes after an import or a switch and calls `onTemplatesChanged(id)`; after a delete it stays open and calls `onTemplatesChanged()` with no id.

- [ ] **Step 1: Write the failing test**

```tsx
// frontend/components/extraction/dialogs/ImportTemplateDialog.test.tsx
import {render, screen} from '@testing-library/react';
import {describe, expect, it, vi} from 'vitest';

vi.mock('@/hooks/extraction/useGlobalTemplates', () => ({
  useGlobalTemplates: () => ({templates: [], loading: false, error: null, refresh: vi.fn()}),
}));
vi.mock('./ProjectTemplatesList', () => ({
  ProjectTemplatesList: () => <div data-testid="stub-project-list" />,
}));
vi.mock('./ImportTemplateFilePane', () => ({
  ImportTemplateFilePane: () => <div data-testid="stub-file-pane" />,
}));
vi.mock('@/services/templateImportService', () => ({importGlobalTemplate: vi.fn()}));
vi.mock('sonner', () => ({toast: {success: vi.fn(), error: vi.fn()}}));

import {ImportTemplateDialog} from './ImportTemplateDialog';

describe('ImportTemplateDialog (switch template)', () => {
  it('composes the project list, the catalogue and the file pane under the new title', () => {
    render(
      <ImportTemplateDialog projectId="p" open onOpenChange={vi.fn()} onTemplatesChanged={vi.fn()} />,
    );
    expect(screen.getByTestId('import-template-dialog')).toHaveTextContent('Switch template');
    expect(screen.getByTestId('stub-project-list')).toBeInTheDocument();
    expect(screen.getByText('Add from the catalogue')).toBeInTheDocument();
    expect(screen.getByTestId('stub-file-pane')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test:run -- frontend/components/extraction/dialogs/ImportTemplateDialog.test.tsx`
Expected: FAIL — TypeScript/prop error on `onTemplatesChanged`, or the stubs are not rendered.

- [ ] **Step 3: Recompose the dialog**

In `ImportTemplateDialog.tsx`:

1. Update the header comment to: "Switch template — the project's own templates (switch/delete), the catalogue, and a file import. Hosted by TemplateConfigEditor and ExtractionInterface."
2. Rename the prop: `onTemplateImported: (templateId?: string) => void` → `onTemplatesChanged: (activeTemplateId?: string) => void`; update the destructuring and the two call sites inside `handleImport` (`onTemplatesChanged(result.templateId)`).
3. Add imports: `import {ProjectTemplatesList} from './ProjectTemplatesList'; import {ImportTemplateFilePane} from './ImportTemplateFilePane';` and swap the `Download` icon import for `Upload`.
4. Title/description: `t('extraction', 'templateDialogTitle')` / `t('extraction', 'templateDialogDesc')`, icon `<Upload …/>`.
5. Body — inside `<DialogContent>` after the header, render in order:

```tsx
        <ProjectTemplatesList
          projectId={projectId}
          onSwitched={(id) => {
            onOpenChange(false);
            onTemplatesChanged(id);
          }}
          onDeleted={() => onTemplatesChanged()}
        />

        <section aria-labelledby="catalogue-heading" className="space-y-2">
          <h3 id="catalogue-heading" className="text-[13px] font-medium text-foreground">
            {t('extraction', 'importFromCatalogueHeading')}
          </h3>
          {/* existing loading / empty / RadioGroup list + selected-preview block, unchanged */}
        </section>

        <ImportTemplateFilePane
          projectId={projectId}
          onImported={(id) => {
            onOpenChange(false);
            onTemplatesChanged(id);
          }}
        />
```

   Keep the existing footer (Cancel + the catalogue Import button) — it imports the *selected catalogue* template; rename its label to stay `importImportButton` and keep `data-testid="import-template-submit"` (the existing E2E depends on it).
6. `DialogContent` className: widen to `sm:max-w-[680px]`.

In `TemplateConfigEditor.tsx` and `ExtractionInterface.tsx`: rename the prop at the call sites to `onTemplatesChanged` (handler bodies unchanged — both already refresh and re-select by id; `ExtractionInterface`'s handler receives `undefined` after a delete and falls through to "select the most recent active", which is correct).

- [ ] **Step 4: Run the dialog tests and the existing editor tests**

Run: `npm run test:run -- frontend/components/extraction/dialogs frontend/components/extraction/TemplateConfigEditor.test.tsx frontend/components/extraction/TemplateConfigEditor.discardMount.test.tsx`
Expected: PASS. Existing `TemplateConfigEditor` tests stub the dialog or don't open it; if one renders it for real and now pulls `useHITLProjectTemplates` (→ supabase client) into the graph, add `vi.mock('./dialogs/ProjectTemplatesList', …)` in that test rather than env.

- [ ] **Step 5: Env-less CI repro, typecheck, lint, commit**

Run: `mv .env .env.bak && npm run test:run -- frontend/components/extraction; mv .env.bak .env` — must be green without `VITE_SUPABASE_URL` (the import-graph trap from memory).

```bash
npx tsc -p tsconfig.app.json --noEmit && npm run lint -- frontend/components/extraction/dialogs/ImportTemplateDialog.tsx frontend/components/extraction/TemplateConfigEditor.tsx frontend/components/extraction/ExtractionInterface.tsx
git add frontend/components/extraction/dialogs/ImportTemplateDialog.tsx frontend/components/extraction/dialogs/ImportTemplateDialog.test.tsx frontend/components/extraction/TemplateConfigEditor.tsx frontend/components/extraction/ExtractionInterface.tsx
git commit -m "feat(frontend): switch-template dialog composes project list, catalogue and file import"
```

---

### Task 10: Export button with the pending-draft confirmation

**Files:**
- Modify: `frontend/components/extraction/TemplateConfigEditor.tsx` (command bar, ~lines 251-283)
- Test: `frontend/components/extraction/TemplateConfigEditor.export.test.tsx`

**Interfaces:**
- Consumes: `exportTemplate`, `templateExportFilename` (Task 6); `triggerDownload` (Task 6); `useTemplateConfigStatus(projectId, templateId)` → `{data?: {has_pending_changes: boolean}}`; shadcn `AlertDialog*`, `Tooltip*`.
- Produces: test ids `template-config-export`, `template-config-export-confirm`.

- [ ] **Step 1: Write the failing test**

```tsx
// frontend/components/extraction/TemplateConfigEditor.export.test.tsx
import {fireEvent, render, screen, waitFor} from '@testing-library/react';
import {beforeEach, describe, expect, it, vi} from 'vitest';

// Keep the editor's heavy children out: the command bar is what we test.
vi.mock('@/components/extraction/template-config/TemplateConfigGridPanel', () => ({
  TemplateConfigGridPanel: () => null,
}));
vi.mock('@/components/extraction/template-config/TemplateConfigPublishControls', () => ({
  TemplateConfigPublishControls: () => null,
}));
vi.mock('@/components/extraction/TemplateInstructionRow', () => ({TemplateInstructionRow: () => null}));
vi.mock('@/components/extraction/dialogs/ImportTemplateDialog', () => ({ImportTemplateDialog: () => null}));
vi.mock('@/components/extraction/dialogs/AddSectionDialog', () => ({AddSectionDialog: () => null}));
vi.mock('@/hooks/extraction/useTemplateEntityTypes', () => ({
  useTemplateEntityTypes: () => ({
    entityTypes: [{id: 'et', name: 's', label: 'S', role: 'study_section', fields: []}],
    isPending: false,
    isError: false,
  }),
}));
vi.mock('@/hooks/extraction/useDeleteTemplateField', () => ({useDeleteTemplateField: () => ({mutateAsync: vi.fn()})}));
vi.mock('@/hooks/extraction/useTemplateRepublish', () => ({
  useTemplateConfigCaches: () => ({invalidateStructure: vi.fn(), invalidateAfterImport: vi.fn()}),
}));
const statusState = {data: {has_pending_changes: false}};
vi.mock('@/hooks/extraction/useTemplateConfigStatus', () => ({useTemplateConfigStatus: () => statusState}));
// The REAL service runs (filename + unwrap are what we test); only the two
// integration clients are stubbed — the supabase one because the service
// module loads it, and CI's Frontend Tests job has no VITE_SUPABASE_URL.
const apiClient = vi.fn();
vi.mock('@/integrations/api/client', () => ({
  apiClient: (...a: unknown[]) => apiClient(...a),
  ApiError: class ApiError extends Error {},
}));
vi.mock('@/integrations/supabase/client', () => ({supabase: {auth: {getUser: vi.fn()}}}));
vi.mock('sonner', () => ({toast: {success: vi.fn(), error: vi.fn(), info: vi.fn()}}));

import {TemplateConfigEditor} from '@/components/extraction/TemplateConfigEditor';

const DOC = {prumo_template: 1, kind: 'extraction', name: 'My CHARMS', sections: [{name: 's', label: 'S'}]};

describe('TemplateConfigEditor export', () => {
  let captured: {blob: Blob; filename: string} | null;
  beforeEach(() => {
    captured = null;
    apiClient.mockReset();
    statusState.data = {has_pending_changes: false};
    URL.createObjectURL = vi.fn(() => 'blob:x');
    URL.revokeObjectURL = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      captured = {blob: (URL.createObjectURL as ReturnType<typeof vi.fn>).mock.calls[0][0] as Blob, filename: this.download};
    });
  });

  it('downloads the UNWRAPPED document under the slug filename', async () => {
    apiClient.mockResolvedValueOnce(DOC);
    render(<TemplateConfigEditor projectId="p" templateId="t" />);
    fireEvent.click(screen.getByTestId('template-config-export'));
    await waitFor(() => expect(captured).not.toBeNull());
    expect(captured!.filename).toBe('my-charms.prumo-template.json');
    const parsed = JSON.parse(await captured!.blob.text());
    expect(parsed).toEqual(DOC);
    expect(parsed).not.toHaveProperty('data');
    expect(parsed).not.toHaveProperty('ok');
  });

  it('confirms first when a draft is pending', async () => {
    statusState.data = {has_pending_changes: true};
    apiClient.mockResolvedValueOnce(DOC);
    render(<TemplateConfigEditor projectId="p" templateId="t" />);
    fireEvent.click(screen.getByTestId('template-config-export'));
    expect(apiClient).not.toHaveBeenCalled();
    expect(await screen.findByText('This file includes unpublished changes.')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('template-config-export-confirm'));
    await waitFor(() =>
      expect(apiClient).toHaveBeenCalledWith('/api/v1/projects/p/templates/t/export', {method: 'GET'}),
    );
  });
});
```

Adapt the mocked module paths to the editor's real imports (read its import block first); every stub must match an actual import specifier or vitest ignores it.

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test:run -- frontend/components/extraction/TemplateConfigEditor.export.test.tsx`
Expected: FAIL — no element with test id `template-config-export`.

- [ ] **Step 3: Add the button, the confirm, and the icon swap**

In `TemplateConfigEditor.tsx`:

Imports: add `FileDown, Upload` to the lucide import (drop `Download` if no longer used), `AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle` from `@/components/ui/alert-dialog`, `Tooltip, TooltipContent, TooltipTrigger` from `@/components/ui/tooltip`, `useTemplateConfigStatus` from `@/hooks/extraction/useTemplateConfigStatus`, `exportTemplate, templateExportFilename` from `@/services/templateImportService`, `triggerDownload` from `@/lib/download`.

State + handlers (next to the other `useState`s):

```tsx
  const {data: configStatus} = useTemplateConfigStatus(projectId, templateId);
  const [exportConfirmOpen, setExportConfirmOpen] = useState(false);

  const exportNow = async () => {
    const result = await exportTemplate(projectId, templateId);
    if (!result.ok) {
      toast.error(`${t('extraction', 'exportError')}: ${result.error.message}`);
      return;
    }
    // The file is the unwrapped document (spec §5.1) — never the envelope.
    triggerDownload(
      new Blob([JSON.stringify(result.data, null, 2)], {type: 'application/json'}),
      templateExportFilename(result.data.name),
    );
  };

  const handleExportClick = () => {
    if (configStatus?.has_pending_changes) {
      setExportConfirmOpen(true);
      return;
    }
    void exportNow();
  };
```

Command bar — before the existing import button:

```tsx
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                data-testid="template-config-export"
                onClick={handleExportClick}
                className="h-8 text-muted-foreground hover:text-foreground"
              >
                <FileDown className="h-4 w-4 mr-2" />
                {t('extraction', 'exportTemplateButton')}
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t('extraction', 'exportTemplateTooltip')}</TooltipContent>
          </Tooltip>
```

Swap the import button's icon (both the command bar and the empty-state card) from `<Download …/>` to `<Upload …/>`.

Confirm dialog — next to the other dialogs at the bottom:

```tsx
      <AlertDialog open={exportConfirmOpen} onOpenChange={setExportConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('extraction', 'exportDraftTitle')}</AlertDialogTitle>
            <AlertDialogDescription>{t('extraction', 'exportDraftBody')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common', 'cancel')}</AlertDialogCancel>
            <AlertDialogAction
              data-testid="template-config-export-confirm"
              onClick={() => {
                setExportConfirmOpen(false);
                void exportNow();
              }}
            >
              {t('extraction', 'exportDraftConfirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
```

If the editor is near the file-size ratchet (check `wc -l`; the baseline is in `scripts/fitness/check_file_size.baseline`), move the export state/handlers + confirm dialog into `frontend/components/extraction/template-config/TemplateExportButton.tsx` (props: `projectId`, `templateId`) and render `<TemplateExportButton …/>` in the bar instead — same test ids, same test.

- [ ] **Step 4: Run to verify it passes**

Run: `npm run test:run -- frontend/components/extraction/TemplateConfigEditor.export.test.tsx frontend/components/extraction/TemplateConfigEditor.test.tsx`
Expected: PASS.

- [ ] **Step 5: Typecheck, lint, commit**

```bash
npx tsc -p tsconfig.app.json --noEmit && npm run lint -- frontend/components/extraction/TemplateConfigEditor.tsx frontend/components/extraction/TemplateConfigEditor.export.test.tsx
git add frontend/components/extraction/TemplateConfigEditor.tsx frontend/components/extraction/TemplateConfigEditor.export.test.tsx
git commit -m "feat(frontend): export template from the config command bar, confirming on a pending draft"
```

---

### Task 11: Playwright E2E + design review + spec status

**Files:**
- Create: `frontend/e2e/flows/template-portable.ui.e2e.ts`
- Modify: `docs/superpowers/specs/2026-08-23-template-portable-import-export-design.md` (frontmatter `status: shipped`), `.markdownlintignore` (add this plan)

- [ ] **Step 1: Write the E2E**

```ts
// frontend/e2e/flows/template-portable.ui.e2e.ts
import {expect, test} from '@playwright/test';

import {loginViaUi} from '../_fixtures/auth';
import {loadE2EEnv, missingEnvKeys} from '../_fixtures/env';

/**
 * Export → import → switch → delete, on E2E_IMPORT_PROJECT_ID (a manager
 * project). The imported template is the project's own export, so the grid
 * must show the same sections afterwards.
 */
test.describe('Portable template import/export', () => {
  test('round-trips a template through a file and cleans up', async ({page}) => {
    test.setTimeout(180_000);
    const required = missingEnvKeys(['E2E_USER_EMAIL', 'E2E_USER_PASSWORD']);
    test.skip(required.length > 0, `Missing required env: ${required.join(', ')}`);

    const env = loadE2EEnv();
    await loginViaUi(page);
    await page.goto(
      `${env.frontendUrl}/projects/${env.importProjectId}?tab=extraction&extractionTab=configuration`,
      {waitUntil: 'domcontentloaded'},
    );

    // The project may start template-less: import CHARMS from the catalogue first.
    const exportButton = page.getByTestId('template-config-export');
    if ((await exportButton.count()) === 0) {
      await page.getByTestId('template-config-open-import').first().click();
      await page.getByTestId('import-template-dialog').locator('label').filter({hasText: /^CHARMS$/}).first().click();
      await page.getByTestId('import-template-submit').click();
    }
    await expect(exportButton).toBeVisible({timeout: 60_000});

    // Export → capture the file.
    const downloadPromise = page.waitForEvent('download');
    await exportButton.click();
    const maybeConfirm = page.getByTestId('template-config-export-confirm');
    if (await maybeConfirm.isVisible().catch(() => false)) await maybeConfirm.click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/\.prumo-template\.json$/);
    const path = await download.path();
    const {readFile} = await import('node:fs/promises');
    const doc = JSON.parse(await readFile(path!, 'utf8'));
    expect(doc.prumo_template).toBe(1);
    expect(doc).not.toHaveProperty('data');

    // Import it back under a new name.
    const renamed = {...doc, name: `E2E import ${Date.now()}`};
    await page.getByTestId('template-config-open-import').first().click();
    await page.getByTestId('import-template-file-input').setInputFiles({
      name: 'x.prumo-template.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(renamed)),
    });
    await page.getByTestId('import-template-file-submit').click();
    await expect(page.getByTestId('import-template-dialog')).toBeHidden({timeout: 60_000});

    // The grid now renders the imported structure (same first section label).
    const firstLabel: string = doc.sections[0].label;
    await expect(page.getByText(firstLabel).first()).toBeVisible({timeout: 60_000});

    // Switch back to the previous template, then delete the import.
    await page.getByTestId('template-config-open-import').first().click();
    const importedRow = page.locator('[data-testid^="project-template-row-"]').filter({hasText: renamed.name});
    await expect(importedRow).toContainText('Active');
    const previousRow = page.locator('[data-testid^="project-template-row-"]').filter({hasNotText: renamed.name}).first();
    await previousRow.locator('[data-testid^="project-template-switch-"]').click();
    await expect(page.getByTestId('import-template-dialog')).toBeHidden({timeout: 30_000});

    await page.getByTestId('template-config-open-import').first().click();
    await importedRow.locator('[data-testid^="project-template-delete-"]').click();
    await page.getByTestId('project-template-delete-confirm').click();
    await expect(importedRow).toHaveCount(0, {timeout: 30_000});
  });
});
```

- [ ] **Step 2: Run it against the worktree stack (backend :8000 + Vite :8080 from THIS worktree)**

Start the backend: `cd backend && uv run uvicorn app.main:app --port 8000` (background, from the worktree). Start the frontend with the preview tool (`.claude/launch.json`) or `npm run dev`; assert the serving process's cwd is the worktree: `pid=$(lsof -ti:8080 | head -1); lsof -a -p "$pid" -d cwd -Fn | grep '^n'`.

Run: `npx playwright test frontend/e2e/flows/template-portable.ui.e2e.ts --project=<the local ui project name from playwright.config.ts>`
Expected: 1 passed. Also re-run the existing `frontend/e2e/flows/template-import.ui.e2e.ts` (it shares test ids).

- [ ] **Step 3: Design review of the dialog and the command bar**

Run `/design-review` on the configuration route with the dialog open; fix density/spacing findings; re-screenshot.

- [ ] **Step 4: Spec status, plan ignore entry, commit**

- Spec frontmatter: `status: shipped`.
- Append `docs/superpowers/plans/2026-08-23-template-portable-import-export.md` to `.markdownlintignore` (the plans list near line 90).
- `bash scripts/docs/check-frontmatter.sh`.

```bash
git add frontend/e2e/flows/template-portable.ui.e2e.ts docs/superpowers/specs/2026-08-23-template-portable-import-export-design.md docs/superpowers/plans/2026-08-23-template-portable-import-export.md .markdownlintignore
git commit -m "test(e2e): portable template export → import → switch → delete; mark spec shipped"
```

---

## Self-review against the spec

| Spec section | Task |
| --- | --- |
| §3.1 import creates new, activates, publishes v1 | 3 |
| §3.3 live export + draft confirm | 3 (live rows), 10 (confirm) |
| §3.4 extraction only | 1 (`kind` literal), 3 (typed wrong-kind) |
| §3.5 reachable imports (list + switch) | 2 (PATCH fix), 7, 9 |
| §3.6 delete | 4, 5, 7 |
| §4.1–4.3 keys, derived role, renames, caps | 1 |
| §4.2 same-named sections legal | 1, 3 |
| §4.4 vestigial columns excluded, unknown key rejected | 1, 3 (`validation_schema={}` on import) |
| §5.1 three endpoints, unwrapped file | 5, 6, 10 |
| §5.2 modules, shared helper | 2, 3, 4 |
| §5.3 no topological sort, rollback | 3 |
| §5.4 typed errors + capped list | 3, 4, 5 |
| §5.5 caps | 1 |
| §5.6 switch deactivates sibling | 2 |
| §5.7 delete guards + cascade + hitl config | 4 |
| §6.1 command bar Export + Upload icon | 10 |
| §6.2 dialog composition, browser doesn't validate | 8, 9 |
| §6.3 services + copy | 6 |
| §7 accepted costs | — (no code) |
| §8 trust copy | 6, 8 |
| §9 verification list | 1, 3, 4, 5, 7, 8, 10, 11 |
| §4.3 docs paragraph | 5 |
