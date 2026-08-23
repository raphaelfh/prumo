---
status: in_progress
last_reviewed: 2026-08-23
owner: '@raphaelfh'
---

# Portable template import/export — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Spec:** `docs/superpowers/specs/2026-08-23-template-portable-import-export-design.md` (approved 2026-08-23, amended after the panel review — see the last section of this plan). Read it first; this plan only says *how*.

**Goal:** A manager can export an extraction template's live structure as a `prumo-template@1` JSON file, import such a file as a new active project template, switch between the project's templates, and delete an inactive one — all from the template dialog — with every backend guard proven by tests.

**Architecture:** One Pydantic model is the format (`app/schemas/template_portable.py`); one service holds both directions side by side (`template_portable_service.py`: `to_portable` / `import_portable`); a sibling-deactivation helper promoted out of the clone service is shared by clone, import, and the fixed `set_template_active`; a small `template_delete_service.py` owns the guarded delete under a row lock. The frontend adds two composable panes to the existing `ImportTemplateDialog`, a `TemplateExportButton` to the config command bar, and forwards the active-template change from the editor host to `ExtractionInterface`; the browser never validates the document.

**Tech Stack:** FastAPI + SQLAlchemy 2.0 async + Pydantic v2 (backend); React 19 + TanStack Query + shadcn (frontend); pytest against local Supabase Postgres; vitest; Playwright.

## Global Constraints

- English only for code, comments, commits, copy keys.
- No SQLAlchemy model changes ⇒ **no Alembic migration** in this slice. Verify at the end: `git diff --stat origin/dev -- backend/app/models/ backend/alembic/` is empty.
- Layering (`scripts/fitness/check_layered_arch.py`): `api → services → repositories → models`; `app/schemas/*` imports nothing from `app.models`.
- **mypy strict ratchet** (`scripts/mypy_baseline.py`, CI `Backend Lint`): a new file gets no grandfathering. `TemplateKind` must be imported from `app.models.extraction_versioning` (not re-exported by `app.models.extraction`); DB→format conversion goes through `model_validate(..., from_attributes=True)` so no `str`→`Literal` / `dict`→`list` casts are needed. Run `cd backend && uv run python ../scripts/mypy_baseline.py` (or whatever `ci.yml` runs) before every backend commit.
- Responses use the `ApiResponse` envelope with a typed Pydantic model — never `ApiResponse[dict[str, Any]]`. Refusal bodies are DECLARED on the route (`responses={...}`) so the codes reach `schema.d.ts`.
- Every project-scoped endpoint is guarded by `require_project_manager` (BOLA); every write endpoint carries `@limiter.limit`.
- Frontend services return `ErrorResult<T>` via `toResult`; they never throw across the boundary and never toast.
- **All new copy goes in the `templateConfig` namespace** (`frontend/lib/copy/templateConfig.ts`): `frontend/lib/copy/extraction.ts` sits at its file-size ratchet ceiling (905/905 lines, `scripts/fitness/check_file_size.baseline`) and must not grow; changing an existing value there in place is fine.
- The noun "Run" never appears in copy values.
- React Compiler: no `try/finally` or `throw` inside `try` in component/hook bodies.
- After any endpoint or schema change: `npm run generate:api-types` and commit the diff (`api-contract` CI job).
- Icon-only buttons: shadcn `Tooltip` (`TooltipTrigger asChild`) + `aria-label`, text from copy. Every vitest that renders a `Tooltip` wraps the render in `<TooltipProvider>` (Radix throws otherwise).
- **Section and field names are ≥ 2 chars** (`SectionName`/`FieldName` `min_length=2`). Test fixtures use `sec`, `grp`, `child`, `fld`, `f1`… never single letters.
- Direct endpoint-coroutine tests pass a REAL `starlette.requests.Request` (the `_request()` helper from `backend/tests/unit/test_template_clone_endpoint.py:36-58`): slowapi rejects mocks, and `ApiResponse.success(trace_id=MagicMock)` fails validation.
- Worktree: `/Users/raphael/PycharmProjects/prumo/.claude/worktrees/portable-template-import-export`, branch `worktree-portable-template-import-export`. Frontend tooling runs from this worktree root (deps resolve from the parent checkout). Backend commands run from `<worktree>/backend` with `uv run`.
- Tests run against the shared local Supabase — `make db-fresh` ONLY after messaging peer sessions (`ListAgents`); never run two backend pytest processes concurrently (advisory-lock hang).
- Tests must never `clean_project_clones` the **primary** seed project (its seed `extraction_instances` row is a `RESTRICT` FK target and the wipe fails). Clean-slate tests use `SEED.secondary_project`; a test that needs a run inserts an ad-hoc article into the secondary project (pattern: `backend/tests/integration/test_template_version_republish.py:395-430`).
- `db_session` is SAVEPOINT-isolated: every `commit()` inside a service only releases a savepoint and teardown rolls the outer transaction back — tests leave no residue, and deferred triggers fire only in the Playwright flow.
- The worktree's dev server cannot use port 8080 (the main checkout's Vite owns it; `preview_start` reads `.claude/launch.json` from the MAIN checkout). Start it with `npx vite --port 8090` from the worktree and point `E2E_FRONTEND_URL` at it; assert the serving process's cwd (`pid=$(lsof -ti:8090 | head -1); lsof -a -p "$pid" -d cwd -Fn | grep '^n'`).
- Conventional commits; commit after every task.

---

## File structure

**Backend — create**

| File | Responsibility |
| --- | --- |
| `backend/app/schemas/template_portable.py` | The `prumo-template@1` format: `PortableField`, `PortableSection`, `PortableTemplate`, structural validators, `PORTABLE_FORMAT_VERSION`. |
| `backend/app/services/template_portable_service.py` | `parse_portable_document`, `to_portable`, `import_portable`; the typed 422 errors. |
| `backend/app/services/template_delete_service.py` | `delete_template` under `FOR UPDATE` with the two typed 409 guards. |
| `backend/tests/unit/test_template_portable_schema.py` | Pure-Pydantic format tests. |
| `backend/tests/integration/test_template_portable_service.py` | Round-trip over both seeded extraction templates + import lifecycle + rejections. |
| `backend/tests/integration/test_template_delete_service.py` | Delete guards + cascade + writes-nothing. |
| `backend/tests/integration/test_template_portable_endpoints.py` | HTTP smoke: routing + auth + BOLA through the real ASGI stack. |
| `backend/tests/unit/test_project_templates_portable_endpoints_unit.py` | Direct endpoint-coroutine tests (diff-cover ASGI blind spot). |

**Backend — modify**

| File | Change |
| --- | --- |
| `backend/app/services/project_template_active_service.py` | Add module-level `deactivate_sibling_extraction_templates`; call it on activation. |
| `backend/app/services/template_clone_service.py` | Delete the private `_deactivate_sibling_extraction_templates`; call the shared helper (2 sites). |
| `backend/app/schemas/hitl_session.py` | `TemplatePortableRefusalCode`, `TemplatePortableRefusalDetails/Response`, `TemplateDeleteRefusalCode`, `TemplateDeleteRefusalDetails/Response`, `TemplateDeleteResponse`. |
| `backend/app/api/v1/endpoints/project_templates.py` | `GET …/export`, `POST …/import`, `DELETE …/{template_id}`. |
| `backend/tests/integration/test_project_template_active_service.py` | Sibling-deactivation regression + QA-activation-deactivates-nothing. |
| `frontend/types/api/openapi.json`, `frontend/types/api/schema.d.ts` | Regenerated. |
| `docs/reference/extraction-hitl-architecture.md` | §4.3 paragraph on file import/export + delete. |

**Frontend — create**

| File | Responsibility |
| --- | --- |
| `frontend/lib/download.ts` | `triggerDownload(blob, filename)` for the new caller (the three pre-existing private copies are a spawned follow-up, not this slice). |
| `frontend/components/extraction/dialogs/ProjectTemplatesList.tsx` | "This project's templates": rows, Switch, Delete + confirm. |
| `frontend/components/extraction/dialogs/ImportTemplateFilePane.tsx` | "Add from a file": input, Import, typed error list, trust copy. |
| `frontend/components/extraction/template-config/TemplateExportButton.tsx` | Export button + pending-draft confirm (sibling of `TemplateConfigPublishControls`). |
| `frontend/components/extraction/dialogs/ProjectTemplatesList.test.tsx`, `ImportTemplateFilePane.test.tsx`, `ImportTemplateDialog.test.tsx`, `frontend/components/extraction/template-config/TemplateExportButton.test.tsx`, `frontend/services/templateImportService.test.ts` | vitest. |
| `frontend/e2e/flows/template-portable.ui.e2e.ts` | Playwright: export → import → switch → delete on a dedicated fixture project. |

**Frontend — modify**

| File | Change |
| --- | --- |
| `frontend/services/templateImportService.ts` | `exportTemplate`, `importTemplateFromFile`, `deleteTemplate`, `templateExportFilename`; generated types. |
| `frontend/lib/copy/templateConfig.ts` | New keys (Task 6). `frontend/lib/copy/extraction.ts`: `importTitle`/`importDesc` values changed in place only. |
| `frontend/components/extraction/dialogs/ImportTemplateDialog.tsx` | Compose the two panes; retitle; `onTemplateImported` → `onActiveTemplateChanged`. |
| `frontend/components/extraction/TemplateConfigEditor.tsx` | Render `TemplateExportButton`; `Download` → `Upload` icon; forward `onActiveTemplateChanged` to its host. |
| `frontend/components/extraction/ExtractionInterface.tsx` | Pass its active-template handler to `TemplateConfigEditor`; callback rename. |
| `frontend/components/extraction/TemplateConfigEditor.test.tsx` | Mock `useTemplateConfigStatus` (the export button now reads it). |
| `frontend/e2e/_fixtures/fixture-ids.ts`, `frontend/e2e/_fixtures/ensure-fixtures.ts` | A dedicated `PORTABLE_PROJECT_ID` provisioned WITH CHARMS. |

---

### Task 1: The portable format (Pydantic model)

**Files:**
- Create: `backend/app/schemas/template_portable.py`
- Test: `backend/tests/unit/test_template_portable_schema.py`

**Interfaces:**
- Consumes: `FieldName`, `FieldType`, `AllowedValues`, `AllowedUnits`, `SectionName`, `SectionLabel`, `SectionEntryLabel` from `app/schemas/template_structure.py`.
- Produces: `PORTABLE_FORMAT_VERSION: Literal[1]`, `Framework = Literal["CHARMS", "PICOS", "CUSTOM"]`, `MAX_TOTAL_FIELDS = 2000`, `PortableField`, `PortableSection`, `PortableTemplate`. Attribute names: `PortableField.field_type` (alias `type`), `.is_required` (alias `required`); `PortableSection.is_required` (alias `required`), `.repeats`, `.group`, `.entry_label`, `.fields`, `.sections`; `PortableTemplate.sections`, `.llm_template_instruction`, `.framework`, `.version`, `.kind`, `.prumo_template`. Validate from dicts by alias; validate from ORM rows with `model_validate(row, from_attributes=True, by_name=True)`; serialize with `model_dump(by_alias=True, exclude_defaults=True)`; `model_dump()` (no alias) yields column names.

- [ ] **Step 1: Write the failing tests**

```python
# backend/tests/unit/test_template_portable_schema.py
"""Pure-Pydantic tests for the prumo-template@1 format (no DB).

The structural rules live in model validators so a file can never express a
role/parent combination the DB would reject; every rule here has a test.
Names are >= 2 chars everywhere: the shared aliases enforce min_length=2 and
Pydantic skips `mode="after"` validators when a field already failed.
"""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from app.schemas.template_portable import (
    MAX_TOTAL_FIELDS,
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
            {"name": "sec", "label": "S", "fields": [{"name": "f1", "label": "F1", "type": "text"}]},
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
    assert doc.sections[0].entry_label is None
    assert doc.sections[0].fields[0].field_type == "text"
    assert doc.sections[0].fields[0].is_required is False


def test_dump_uses_file_keys_and_omits_defaults() -> None:
    doc = PortableTemplate.model_validate(_doc())
    assert doc.model_dump(by_alias=True, exclude_defaults=True) == {
        "prumo_template": 1,
        "kind": "extraction",
        "name": "T",
        "sections": [
            {"name": "sec", "label": "S", "fields": [{"name": "f1", "label": "F1", "type": "text"}]}
        ],
    }


def test_field_constructed_by_alias_reads_by_attribute_and_dumps_column_names() -> None:
    fld = PortableField(name="fld", label="F", type="select", required=True, allowed_values=["a"])
    assert fld.field_type == "select" and fld.is_required is True
    dumped = fld.model_dump()
    assert dumped["field_type"] == "select" and dumped["is_required"] is True


def test_from_attributes_by_name_reads_orm_like_objects() -> None:
    class Row:
        name, label, field_type, description = "fld", "F", "number", None
        is_required, llm_description, allowed_values, unit = True, None, None, "kg"
        allowed_units, allow_other, other_label, other_placeholder = None, False, None, None
        allows_not_applicable, allows_not_evaluated = False, True

    fld = PortableField.model_validate(Row(), from_attributes=True, by_name=True)
    assert (fld.field_type, fld.is_required, fld.unit, fld.allows_not_evaluated) == (
        "number", True, "kg", True,
    )


def test_dict_input_rejects_attribute_names() -> None:
    """A file must use the file keys; `field_type` is not a spelling we accept."""
    with pytest.raises(ValidationError) as exc:
        PortableField.model_validate({"name": "fld", "label": "F", "field_type": "text"})
    assert "type" in str(exc.value)


@pytest.mark.parametrize(
    ("sections", "needle"),
    [
        (
            [{"name": "sec", "label": "S", "sections": [{"name": "child", "label": "C"}]}],
            "sections are only allowed inside a group",
        ),
        (
            [
                {"name": "grp1", "label": "G1", "group": True},
                {"name": "grp2", "label": "G2", "group": True},
            ],
            "at most one group",
        ),
        # Deeper nesting: the grandchild's parent is a non-group carrying
        # sections, so it fails its OWN rule first — same needle.
        (
            [
                {
                    "name": "grp",
                    "label": "G",
                    "group": True,
                    "sections": [
                        {"name": "child", "label": "C", "sections": [{"name": "deep", "label": "D"}]}
                    ],
                }
            ],
            "sections are only allowed inside a group",
        ),
        (
            [
                {
                    "name": "grp",
                    "label": "G",
                    "group": True,
                    "sections": [{"name": "child", "label": "C", "group": True}],
                }
            ],
            "a group must be a root section",
        ),
        (
            [
                {
                    "name": "sec",
                    "label": "S",
                    "fields": [
                        {"name": "fld", "label": "A", "type": "text"},
                        {"name": "fld", "label": "B", "type": "text"},
                    ],
                }
            ],
            "duplicate field name",
        ),
        (
            [{"name": "sec", "label": "S", "fields": [{"name": "Bad", "label": "B", "type": "text"}]}],
            "String should match pattern",
        ),
        (
            [{"name": "sec", "label": "S", "fields": [{"name": "fld", "label": "B", "type": "blob"}]}],
            "Input should be",
        ),
        # validation_schema is not a format key (spec §4.4)
        (
            [
                {
                    "name": "sec",
                    "label": "S",
                    "fields": [
                        {"name": "fld", "label": "B", "type": "text", "validation_schema": {"x": 1}}
                    ],
                }
            ],
            "Extra inputs are not permitted",
        ),
        (
            [{"name": "sec", "label": "S", "entry_label": "thing"}],
            "entry_label is only allowed on a group",
        ),
    ],
)
def test_structural_rejections(sections, needle) -> None:
    with pytest.raises(ValidationError) as exc:
        PortableTemplate.model_validate(_doc(sections=sections))
    assert needle in str(exc.value)


def test_same_named_sibling_sections_are_legal() -> None:
    doc = PortableTemplate.model_validate(
        _doc(sections=[{"name": "sec", "label": "A"}, {"name": "sec", "label": "B"}])
    )
    assert [s.label for s in doc.sections] == ["A", "B"]


def test_wrong_kind_and_version_are_rejected_by_the_model() -> None:
    with pytest.raises(ValidationError):
        PortableTemplate.model_validate(_doc(kind="quality_assessment"))
    with pytest.raises(ValidationError):
        PortableTemplate.model_validate(_doc(prumo_template=2))


def test_size_caps() -> None:
    with pytest.raises(ValidationError):
        PortableTemplate.model_validate(
            _doc(sections=[{"name": f"sec{i}", "label": "S"} for i in range(101)])
        )
    with pytest.raises(ValidationError):
        PortableTemplate.model_validate(_doc(sections=[]))
    # Per-level caps multiply; the total-fields cap bounds the transaction.
    big = [
        {"name": f"sec{i}", "label": "S",
         "fields": [{"name": f"f{j}", "label": "F", "type": "text"} for j in range(200)]}
        for i in range(11)
    ]
    with pytest.raises(ValidationError) as exc:
        PortableTemplate.model_validate(_doc(sections=big))
    assert f"at most {MAX_TOTAL_FIELDS} fields" in str(exc.value)


def test_long_llm_description_is_legal_up_to_4000() -> None:
    """The seeded CHARMS+Multimodal carries ~1.4k-char llm_descriptions; the
    editor's 1000 cap is a UX guard the seed itself exceeds (spec §4.3)."""
    fld = PortableField(name="fld", label="F", type="text", llm_description="x" * 4000)
    assert len(fld.llm_description or "") == 4000
    with pytest.raises(ValidationError):
        PortableField(name="fld", label="F", type="text", llm_description="x" * 4001)


def test_description_caps() -> None:
    with pytest.raises(ValidationError):
        PortableSection(name="sec", label="S", description="x" * 501)
    with pytest.raises(ValidationError):
        PortableTemplate.model_validate(_doc(description="x" * 2001))


def test_section_model_is_importable() -> None:
    sec = PortableSection(name="sec", label="S")
    assert sec.fields == [] and sec.sections == []
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

Validation reuses the aliases from ``template_structure`` verbatim, with ONE
deliberate relaxation: ``llm_description`` allows 4000 chars (the editor caps
at 1000, but the seeded CHARMS+Multimodal ships ~1.4k-char descriptions and the
DB has no CHECK — spec §4.3). Section/template ``description`` are capped here
(500 / 2000) because they reach prompts.

Aliases (``type``/``required``) are a deliberate deviation from the
``common.py`` "no aliases" guidance: the file is hand/LLM-authored and these
are the JSON-Schema spellings (spec §4.3). ``populate_by_name`` stays OFF so a
file cannot spell them as ``field_type``/``is_required``; ORM rows are read
with ``model_validate(row, from_attributes=True, by_name=True)`` instead.

Layering: imports nothing from ``app.models`` (check_layered_arch).
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
# The per-level caps multiply (100 × 200 × 2 levels), so a total bounds them.
MAX_SECTIONS_PER_LEVEL = 100
MAX_FIELDS_PER_SECTION = 200
MAX_TOTAL_FIELDS = 2000


class PortableField(BaseModel):
    """One ``extraction_fields`` row. ``type``/``required`` are the file keys
    (JSON Schema convention); the attributes keep the column names."""

    model_config = ConfigDict(extra="forbid")

    name: FieldName
    label: str = Field(min_length=1, max_length=100)
    field_type: FieldType = Field(alias="type")
    description: str | None = Field(default=None, max_length=500)
    is_required: bool = Field(default=False, alias="required")
    llm_description: str | None = Field(default=None, max_length=4000)
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
    ``model_section``; otherwise ``study_section``. ``entry_label`` is only
    legal on a group; the import defaults it to ``"model"`` there."""

    model_config = ConfigDict(extra="forbid")

    name: SectionName
    label: SectionLabel
    description: str | None = Field(default=None, max_length=500)
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
        # A child carrying its own ``sections`` already failed the rule above
        # on itself (it is never a group), so depth > 1 needs no extra branch.
        for child in self.sections:
            if child.group:
                raise ValueError("a group must be a root section")
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
    description: str | None = Field(default=None, max_length=2000)
    framework: Framework = "CUSTOM"
    version: str = Field(default="1.0.0", max_length=50)
    llm_template_instruction: str | None = Field(default=None, max_length=4000)
    sections: list[PortableSection] = Field(min_length=1, max_length=MAX_SECTIONS_PER_LEVEL)

    @model_validator(mode="after")
    def _document_rules(self) -> PortableTemplate:
        if sum(1 for s in self.sections if s.group) > 1:
            raise ValueError("at most one group per template")
        total = sum(len(s.fields) + sum(len(c.fields) for c in s.sections) for s in self.sections)
        if total > MAX_TOTAL_FIELDS:
            raise ValueError(f"at most {MAX_TOTAL_FIELDS} fields per template (found {total})")
        return self
```

- [ ] **Step 4: Run to verify they pass**

Run: `cd backend && uv run pytest tests/unit/test_template_portable_schema.py -q`
Expected: all PASS. If a `needle` assertion fails only on Pydantic's wording, fix the needle to the actual message — the behavior is what matters. If `by_name=True` is rejected by the installed Pydantic, the panel verified it on 2.13.4 — check `uv run python -c "import pydantic; print(pydantic.VERSION)"`.

- [ ] **Step 5: Lint, mypy ratchet, commit**

Run: `cd backend && uv run ruff format app/schemas/template_portable.py tests/unit/test_template_portable_schema.py && uv run ruff check app/schemas/template_portable.py tests/unit/test_template_portable_schema.py && uv run mypy app/schemas/template_portable.py`

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
- Produces: `async def deactivate_sibling_extraction_templates(db: AsyncSession, *, project_id: UUID, keep_active_id: UUID | None) -> None` (module-level in `project_template_active_service`). Task 3 and the clone service call it.

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/integration/test_project_template_active_service.py` (the file already defines `_insert_inactive_extraction_template(db, *, project_id, created_by)` and imports `SEED`, `set_template_active`, `text`, `AsyncSession`, `pytest`):

```python
from app.models.extraction_versioning import TemplateKind
from app.services.template_clone_service import TemplateCloneService
from tests.integration.conftest import clean_project_clones, clone_charms

PROBAST_GLOBAL_ID = "00b00000-0000-0000-0000-000000000001"
QUADAS2_GLOBAL_ID = "00d00000-0000-0000-0000-000000000001"


async def _active_state(db: AsyncSession, project_id) -> dict[str, bool]:
    rows = await db.execute(
        text(
            "SELECT id, is_active FROM public.project_extraction_templates "
            "WHERE project_id = :pid"
        ),
        {"pid": str(project_id)},
    )
    return {str(r.id): r.is_active for r in rows}


@pytest.mark.asyncio
async def test_activating_extraction_template_deactivates_active_sibling(
    db_session: AsyncSession,
) -> None:
    """Spec §5.6: today this trips `uq_one_active_extraction_template_per_project`
    because the flag is flipped without deactivating the sibling."""
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
    state = await _active_state(db_session, project_id)
    assert state[str(extra)] is True
    assert state[str(active.project_template_id)] is False


@pytest.mark.asyncio
async def test_activating_qa_template_deactivates_nothing(db_session: AsyncSession) -> None:
    """QA tools coexist (PROBAST + QUADAS-2) and never touch the extraction template."""
    import uuid

    project_id = SEED.secondary_project
    await clean_project_clones(db_session, project_id)
    charms = await clone_charms(db_session, project_id, SEED.primary_profile)
    cloner = TemplateCloneService(db_session)
    probast = await cloner.clone(
        project_id=project_id,
        global_template_id=uuid.UUID(PROBAST_GLOBAL_ID),
        user_id=SEED.primary_profile,
        kind=TemplateKind.QUALITY_ASSESSMENT,
    )
    quadas = await cloner.clone(
        project_id=project_id,
        global_template_id=uuid.UUID(QUADAS2_GLOBAL_ID),
        user_id=SEED.primary_profile,
        kind=TemplateKind.QUALITY_ASSESSMENT,
    )
    await set_template_active(
        db_session, project_id=project_id, template_id=probast.project_template_id, is_active=False
    )
    await set_template_active(
        db_session, project_id=project_id, template_id=probast.project_template_id, is_active=True
    )
    state = await _active_state(db_session, project_id)
    assert state[str(charms.project_template_id)] is True
    assert state[str(quadas.project_template_id)] is True
    assert state[str(probast.project_template_id)] is True
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd backend && uv run pytest tests/integration/test_project_template_active_service.py -q -k "deactivates"`
Expected: the extraction test FAILS with `IntegrityError … uq_one_active_extraction_template_per_project`; the QA test passes already (it guards against a regression of the fix).

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
    if tpl.kind == TemplateKind.EXTRACTION.value and is_active:
        # Switch: the partial unique index forbids two active extraction
        # templates, so the sibling goes first (spec §5.6). keep_active_id
        # makes this a no-op when the template is already active.
        await deactivate_sibling_extraction_templates(
            db, project_id=project_id, keep_active_id=template_id
        )
        await db.flush()
```

Update the module docstring's first line to mention the helper. (The service's in-function `commit()` is pre-existing drift from the endpoint-commits rule; leave it — surgical.)

- [ ] **Step 4: Point the clone service at the helper**

In `backend/app/services/template_clone_service.py`:
- Add `from app.services.project_template_active_service import deactivate_sibling_extraction_templates` (top-level — that module imports only models and schemas, so no cycle).
- Replace both `await self._deactivate_sibling_extraction_templates(project_id=..., keep_active_id=...)` calls with `await deactivate_sibling_extraction_templates(self.db, project_id=..., keep_active_id=...)` (same keyword values).
- Delete the `_deactivate_sibling_extraction_templates` method. Remove `update` from the sqlalchemy import if now unused (ruff will tell you).

- [ ] **Step 5: Run the affected suites**

Run: `cd backend && uv run pytest tests/integration/test_project_template_active_service.py tests/integration/test_template_clone_service.py tests/integration/test_template_clone_extraction.py tests/integration/test_single_active_extraction_invariant.py -q`
Expected: all PASS.

- [ ] **Step 6: Lint, mypy, commit**

Run: `cd backend && uv run ruff format app/services/project_template_active_service.py app/services/template_clone_service.py tests/integration/test_project_template_active_service.py && uv run ruff check app/services/ tests/integration/test_project_template_active_service.py && uv run python ../scripts/mypy_baseline.py` (use the exact mypy command `ci.yml` runs if it differs).

```bash
git add backend/app/services/project_template_active_service.py backend/app/services/template_clone_service.py backend/tests/integration/test_project_template_active_service.py
git commit -m "fix(templates): activating an extraction template deactivates its sibling; share the helper with clone"
```

---

### Task 3: Portable service — export, parse, import (round-trip)

**Files:**
- Create: `backend/app/services/template_portable_service.py`
- Modify: `backend/app/schemas/hitl_session.py` (append the refusal code + response models)
- Test: `backend/tests/integration/test_template_portable_service.py`

**Interfaces:**
- Consumes: Task 1 models; Task 2 helper; `ProjectTemplateNotFoundError` from `project_template_active_service`; `CloneTemplateResponse` from `hitl_session`; `TemplateVersionService.republish(project_id=, project_template_id=, user_id=)` → object with `.version_id`; `ConflictError` from `app.core.error_handler`.
- Produces:
  - `parse_portable_document(raw: dict[str, Any]) -> PortableTemplate` — raises `TemplateImportUnsupportedVersionError` / `TemplateImportWrongKindError` / `TemplateImportInvalidError` (`AppError`, 422).
  - `async def to_portable(db, *, project_id: UUID, template_id: UUID) -> PortableTemplate` — `ProjectTemplateNotFoundError` when the template is not an extraction template of the project; `TemplateExportInvalidError` (422) when live rows cannot be represented.
  - `async def import_portable(db, *, project_id: UUID, doc: PortableTemplate, user_id: UUID) -> CloneTemplateResponse` — `ConflictError` (409) when the single-active index fires (concurrent activation).
  - In `hitl_session.py`: `TemplatePortableRefusalCode(StrEnum)` {`TEMPLATE_IMPORT_INVALID`, `TEMPLATE_IMPORT_WRONG_KIND`, `TEMPLATE_IMPORT_UNSUPPORTED_VERSION`, `TEMPLATE_EXPORT_INVALID`}, `TemplatePortableIssue(path: str, message: str)`, `TemplatePortableRefusalDetails(errors: list[TemplatePortableIssue], error_count: int)`, `TemplatePortableRefusalResponse` (the declared 422 body, mirroring `TemplatePublishRefusalResponse` at `hitl_session.py:395`).

- [ ] **Step 1: Write the failing tests**

```python
# backend/tests/integration/test_template_portable_service.py
"""Round-trip and lifecycle tests for the portable template service.

The round-trip (seeded template → clone → export → import → export) is the one
test that proves BOTH directions and every carried column at once; it runs
over both seeded extraction globals because CHARMS+Multimodal carries
~1.4k-char llm_descriptions the editor's cap would have rejected.
"""

from __future__ import annotations

from uuid import UUID

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.error_handler import AppError
from app.models.extraction_versioning import TemplateKind
from app.schemas.template_portable import PortableSection, PortableTemplate
from app.services.project_template_active_service import ProjectTemplateNotFoundError
from app.services.template_clone_service import TemplateCloneService
from app.services.template_portable_service import (
    TemplateExportInvalidError,
    TemplateImportInvalidError,
    TemplateImportUnsupportedVersionError,
    TemplateImportWrongKindError,
    import_portable,
    parse_portable_document,
    to_portable,
)
from tests.integration.conftest import SEED, clean_project_clones, clone_charms

CHARMS_GLOBAL_ID = UUID("000c0000-0000-0000-0000-000000000001")
CHARMS_MM_GLOBAL_ID = UUID("000e0000-0000-0000-0000-000000000001")
PROBAST_GLOBAL_ID = UUID("00b00000-0000-0000-0000-000000000001")


def _dump(doc: PortableTemplate) -> dict:
    return doc.model_dump(by_alias=True, exclude_defaults=True)


async def _count(db: AsyncSession, sql: str, **params) -> int:
    return (await db.execute(text(sql), params)).scalar_one()


async def _clone(db: AsyncSession, project_id: UUID, global_id: UUID, kind: TemplateKind):
    return await TemplateCloneService(db).clone(
        project_id=project_id, global_template_id=global_id,
        user_id=SEED.primary_profile, kind=kind,
    )


@pytest.mark.asyncio
@pytest.mark.parametrize("global_id", [CHARMS_GLOBAL_ID, CHARMS_MM_GLOBAL_ID])
async def test_round_trip_is_lossless(db_session: AsyncSession, global_id: UUID) -> None:
    """One project suffices: the import creates a SECOND template there (and
    deactivates the clone), so the two exports come from distinct rows. The
    instruction is set explicitly — the seed backfill does not run in CI."""
    project_id = SEED.secondary_project
    await clean_project_clones(db_session, project_id)
    clone = await _clone(db_session, project_id, global_id, TemplateKind.EXTRACTION)
    await db_session.execute(
        text(
            "UPDATE public.project_extraction_templates "
            "SET llm_template_instruction = 'Extract only what the article states.' "
            "WHERE id = :tid"
        ),
        {"tid": str(clone.project_template_id)},
    )

    exported = await to_portable(
        db_session, project_id=project_id, template_id=clone.project_template_id
    )
    assert exported.prumo_template == 1 and exported.kind == "extraction"
    assert any(s.group for s in exported.sections)  # both CHARMS lineages have the model group
    assert exported.llm_template_instruction == "Extract only what the article states."

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
            "prumo_template": 1, "kind": "extraction", "name": "Mini",
            "sections": [
                {"name": "sec1", "label": "S1",
                 "fields": [{"name": "f1", "label": "F1", "type": "text"}]}
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

    assert await _count(
        db_session,
        "SELECT COUNT(*) FROM public.extraction_template_versions "
        "WHERE project_template_id = :tid AND is_active",
        tid=str(result.project_template_id),
    ) == 1
    snapshot = (
        await db_session.execute(
            text("SELECT schema FROM public.extraction_template_versions WHERE id = :vid"),
            {"vid": str(result.version_id)},
        )
    ).scalar_one()
    assert [et["name"] for et in snapshot["entity_types"]] == ["sec1"]
    assert [f["name"] for f in snapshot["entity_types"][0]["fields"]] == ["f1"]
    assert snapshot["entity_types"][0]["role"] == "study_section"
    assert snapshot["entity_types"][0]["fields"][0]["validation_schema"] == {}


@pytest.mark.asyncio
async def test_import_derives_roles_and_template_wide_sort_order(
    db_session: AsyncSession,
) -> None:
    project_id = SEED.secondary_project
    await clean_project_clones(db_session, project_id)
    doc = parse_portable_document(
        {
            "prumo_template": 1, "kind": "extraction", "name": "Grouped",
            "sections": [
                {"name": "root", "label": "Root", "repeats": True},
                {
                    "name": "grp", "label": "G", "group": True,
                    "fields": [{"name": "key", "label": "K", "type": "text"}],
                    "sections": [{"name": "child", "label": "C", "repeats": True}],
                },
                {"name": "tail", "label": "T"},
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
            "FROM public.extraction_entity_types WHERE project_template_id = :tid"
        ),
        {"tid": str(result.project_template_id)},
    )
    by_name = {r.name: r for r in rows}
    assert (by_name["root"].role, by_name["root"].cardinality, by_name["root"].has_parent) == (
        "study_section", "many", False,
    )
    assert (by_name["grp"].role, by_name["grp"].cardinality, by_name["grp"].entry_label) == (
        "model_container", "many", "model",
    )
    assert (by_name["child"].role, by_name["child"].cardinality, by_name["child"].has_parent) == (
        "model_section", "many", True,
    )
    # Template-wide pre-order: no ties (SNAPSHOT_SQL sorts by bare sort_order).
    orders = [by_name[n].sort_order for n in ("root", "grp", "child", "tail")]
    assert orders == [0, 1, 2, 3]


@pytest.mark.asyncio
async def test_same_named_sections_import(db_session: AsyncSession) -> None:
    project_id = SEED.secondary_project
    await clean_project_clones(db_session, project_id)
    doc = parse_portable_document(
        {"prumo_template": 1, "kind": "extraction", "name": "Dup",
         "sections": [{"name": "sec", "label": "A"}, {"name": "sec", "label": "B"}]}
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
          "sections": [{"name": "sec", "label": "S",
                        "fields": [{"name": "Bad", "label": "B", "type": "text"}]}]},
         TemplateImportInvalidError, "TEMPLATE_IMPORT_INVALID"),
        ({}, TemplateImportUnsupportedVersionError, "TEMPLATE_IMPORT_UNSUPPORTED_VERSION"),
    ],
)
def test_parse_rejections_are_typed(raw, exc_type, code) -> None:
    with pytest.raises(exc_type) as exc:
        parse_portable_document(raw)
    assert exc.value.code == code and exc.value.status_code == 422


def test_reflected_values_are_truncated() -> None:
    with pytest.raises(TemplateImportUnsupportedVersionError) as exc:
        parse_portable_document({"prumo_template": "v" * 5000})
    assert len(exc.value.message) < 200


def test_invalid_document_lists_paths_in_message_and_details() -> None:
    raw = {
        "prumo_template": 1, "kind": "extraction", "name": "x",
        "sections": [
            {"name": "sec", "label": "S",
             "fields": [{"name": "Bad", "label": "B", "type": "text"}]},
            {"name": "two", "label": "T", "sections": [{"name": "child", "label": "C"}]},
        ],
    }
    with pytest.raises(TemplateImportInvalidError) as exc:
        parse_portable_document(raw)
    paths = [e["path"] for e in exc.value.details["errors"]]
    assert "sections[0].fields[0].name" in paths
    assert any(p.startswith("sections[1]") for p in paths)
    assert "sections[0].fields[0].name" in exc.value.message


def test_invalid_document_details_are_capped_at_20_entries() -> None:
    fields = [{"name": f"Bad{i}", "label": "B", "type": "text"} for i in range(30)]
    raw = {"prumo_template": 1, "kind": "extraction", "name": "x",
           "sections": [{"name": "sec", "label": "S", "fields": fields}]}
    with pytest.raises(TemplateImportInvalidError) as exc:
        parse_portable_document(raw)
    assert len(exc.value.details["errors"]) == 20
    assert exc.value.details["error_count"] == 30
    assert "+10 more" in exc.value.message


@pytest.mark.asyncio
async def test_rejected_import_writes_nothing(db_session: AsyncSession) -> None:
    """A document that passes Pydantic but violates a DB constraint must not
    leave a template row behind. Only reachable by bypassing the model (the
    llm_instruction_len CHECK mirrors the 4000 cap), so this test does."""
    from sqlalchemy.exc import IntegrityError

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
        sections=[PortableSection.model_validate({"name": "sec", "label": "S"})],
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
    """BOLA: a template id from another project 404s."""
    await clean_project_clones(db_session, SEED.secondary_project)
    clone = await clone_charms(db_session, SEED.secondary_project, SEED.primary_profile)
    with pytest.raises(ProjectTemplateNotFoundError):
        await to_portable(
            db_session, project_id=SEED.primary_project, template_id=clone.project_template_id
        )


@pytest.mark.asyncio
async def test_export_refuses_qa_template(db_session: AsyncSession) -> None:
    """v1 is extraction-only: a QA id must not leave as `kind: extraction`."""
    project_id = SEED.secondary_project
    await clean_project_clones(db_session, project_id)
    probast = await _clone(db_session, project_id, PROBAST_GLOBAL_ID, TemplateKind.QUALITY_ASSESSMENT)
    with pytest.raises(ProjectTemplateNotFoundError):
        await to_portable(db_session, project_id=project_id, template_id=probast.project_template_id)


@pytest.mark.asyncio
async def test_export_of_unrepresentable_rows_is_typed(db_session: AsyncSession) -> None:
    """A legacy row the format cannot carry (here: empty allowed_values) is a
    typed 422 naming the path, never a 500."""
    project_id = SEED.secondary_project
    await clean_project_clones(db_session, project_id)
    clone = await clone_charms(db_session, project_id, SEED.primary_profile)
    await db_session.execute(
        text(
            "UPDATE public.extraction_fields SET allowed_values = '[]'::jsonb "
            "WHERE entity_type_id IN (SELECT id FROM public.extraction_entity_types "
            "WHERE project_template_id = :tid) AND name = 'model_name'"
        ),
        {"tid": str(clone.project_template_id)},
    )
    with pytest.raises(TemplateExportInvalidError) as exc:
        await to_portable(db_session, project_id=project_id, template_id=clone.project_template_id)
    assert isinstance(exc.value, AppError) and exc.value.status_code == 422
    assert exc.value.code == "TEMPLATE_EXPORT_INVALID"
    assert any("allowed_values" in e["path"] for e in exc.value.details["errors"])
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd backend && uv run pytest tests/integration/test_template_portable_service.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.services.template_portable_service'`.

- [ ] **Step 3: Add the refusal code + declared body**

Append to `backend/app/schemas/hitl_session.py` (next to `TemplatePublishRefusalCode`; same slice-local rationale, same "declared so the body reaches schema.d.ts typed" rationale as `TemplatePublishRefusalResponse`):

```python
class TemplatePortableRefusalCode(StrEnum):
    """Why ``POST …/templates/import`` / ``GET …/export`` returned 422."""

    TEMPLATE_IMPORT_INVALID = "TEMPLATE_IMPORT_INVALID"
    TEMPLATE_IMPORT_WRONG_KIND = "TEMPLATE_IMPORT_WRONG_KIND"
    TEMPLATE_IMPORT_UNSUPPORTED_VERSION = "TEMPLATE_IMPORT_UNSUPPORTED_VERSION"
    TEMPLATE_EXPORT_INVALID = "TEMPLATE_EXPORT_INVALID"


class TemplatePortableIssue(BaseModel):
    path: str
    message: str


class TemplatePortableRefusalDetails(BaseModel):
    errors: list[TemplatePortableIssue]
    error_count: int


class TemplatePortableRefusalError(BaseModel):
    code: TemplatePortableRefusalCode
    message: str
    details: TemplatePortableRefusalDetails | None = None


class TemplatePortableRefusalResponse(BaseModel):
    """The 422 body — ``details`` under ``error``, never a ``data`` slot."""

    ok: bool = False
    error: TemplatePortableRefusalError
    trace_id: str | None = None
```

(Mirror the exact field layout of `TemplatePublishRefusalResponse` / its `*Error` / `*Details` siblings at `hitl_session.py:338-406` — copy their shape, including any `model_config`.)

- [ ] **Step 4: Write the service**

```python
# backend/app/services/template_portable_service.py
"""Portable template import/export (``prumo-template@1``).

Both directions live side by side so the serializer is the exact inverse of
the importer; ``tests/integration/test_template_portable_service.py`` proves
it with one round-trip per seeded extraction template. Import always creates
a NEW project template (``global_template_id = NULL``), activates it, and
publishes v1 through the one publish path — never touching an existing
template's draft, versions, or run pins (spec §3.1).

No topological sort: a nested document is parent-first by construction, and
one template-wide pre-order counter gives entity types the tie-free
``sort_order`` every other writer produces (SNAPSHOT_SQL sorts by it bare).
Only the clone service's TAIL (sibling deactivation, republish) is shared.

Design: docs/superpowers/specs/2026-08-23-template-portable-import-export-design.md §5.
"""

from __future__ import annotations

from typing import Any
from uuid import UUID, uuid4

from fastapi import status
from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.error_handler import AppError, ConflictError
from app.models.extraction import (
    ExtractionEntityRole,
    ExtractionEntityType,
    ExtractionField,
    ProjectExtractionTemplate,
)
from app.models.extraction_versioning import TemplateKind
from app.schemas.hitl_session import CloneTemplateResponse, TemplatePortableRefusalCode
from app.schemas.template_portable import (
    PORTABLE_FORMAT_VERSION,
    PortableField,
    PortableSection,
    PortableTemplate,
)
from app.services.project_template_active_service import (
    ProjectTemplateNotFoundError,
    deactivate_sibling_extraction_templates,
)
from app.services.template_version_service import TemplateVersionService

MAX_REPORTED_ERRORS = 20
_SINGLE_ACTIVE_INDEX = "uq_one_active_extraction_template_per_project"


def _issues(exc: ValidationError) -> tuple[list[dict[str, str]], int]:
    """``[{path, message}]`` capped at MAX_REPORTED_ERRORS, plus the total."""
    found = [{"path": _loc_to_path(tuple(e["loc"])), "message": e["msg"]} for e in exc.errors()]
    return found[:MAX_REPORTED_ERRORS], len(found)


def _loc_to_path(loc: tuple[int | str, ...]) -> str:
    out = ""
    for part in loc:
        out += f"[{part}]" if isinstance(part, int) else (f".{part}" if out else str(part))
    return out


class _PortableRefusal(AppError):
    """422 with the capped issue list in BOTH ``details`` (typed, what the UI
    renders) and ``message`` (one line per issue, for clients that only read
    the message — spec §5.4)."""

    def __init__(
        self, code: TemplatePortableRefusalCode, heading: str, issues: list[dict[str, str]], total: int
    ) -> None:
        lines = [f"{i['path']}: {i['message']}" for i in issues]
        suffix = f"\n(+{total - len(issues)} more)" if total > len(issues) else ""
        super().__init__(
            code=code,
            message=f"{heading} ({total} issue(s)):\n" + "\n".join(lines) + suffix,
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            details={"errors": issues, "error_count": total},
        )


class TemplateImportInvalidError(_PortableRefusal):
    def __init__(self, issues: list[dict[str, str]], *, total: int) -> None:
        super().__init__(
            TemplatePortableRefusalCode.TEMPLATE_IMPORT_INVALID, "Invalid template file", issues, total
        )


class TemplateExportInvalidError(_PortableRefusal):
    def __init__(self, issues: list[dict[str, str]], *, total: int) -> None:
        super().__init__(
            TemplatePortableRefusalCode.TEMPLATE_EXPORT_INVALID,
            "This template cannot be exported",
            issues,
            total,
        )


class TemplateImportUnsupportedVersionError(AppError):
    def __init__(self, found: Any) -> None:
        super().__init__(
            code=TemplatePortableRefusalCode.TEMPLATE_IMPORT_UNSUPPORTED_VERSION,
            message=(
                f"Unsupported template format: expected prumo_template = "
                f"{PORTABLE_FORMAT_VERSION}, found {repr(found)[:80]}."
            ),
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
        )


class TemplateImportWrongKindError(AppError):
    def __init__(self, found: Any) -> None:
        super().__init__(
            code=TemplatePortableRefusalCode.TEMPLATE_IMPORT_WRONG_KIND,
            message=f"Only extraction templates can be imported here (file kind: {repr(found)[:80]}).",
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
        )


def parse_portable_document(raw: dict[str, Any]) -> PortableTemplate:
    """Validate a raw document into the model with TYPED failures. The version
    and kind pre-checks run first so the two most common "wrong file" cases get
    their own code instead of a generic list."""
    version = raw.get("prumo_template")
    if version != PORTABLE_FORMAT_VERSION:
        raise TemplateImportUnsupportedVersionError(version)
    kind = raw.get("kind")
    if kind != TemplateKind.EXTRACTION.value:
        raise TemplateImportWrongKindError(kind)
    try:
        return PortableTemplate.model_validate(raw)
    except ValidationError as exc:
        issues, total = _issues(exc)
        raise TemplateImportInvalidError(issues, total=total) from exc


# ---------------------------------------------------------------- export


async def _owned_extraction_template(
    db: AsyncSession, *, project_id: UUID, template_id: UUID
) -> ProjectExtractionTemplate:
    tpl = await db.get(ProjectExtractionTemplate, template_id)
    if (
        tpl is None
        or tpl.project_id != project_id
        or tpl.kind != TemplateKind.EXTRACTION.value
    ):
        raise ProjectTemplateNotFoundError(f"Project template {template_id} not found")
    return tpl


def _section_dict(et: ExtractionEntityType, children: list[ExtractionEntityType]) -> dict[str, Any]:
    is_group = et.role == ExtractionEntityRole.MODEL_CONTAINER.value
    return {
        "name": et.name,
        "label": et.label,
        "description": et.description,
        "required": et.is_required,
        # A group always repeats; ``repeats`` is only meaningful elsewhere.
        "repeats": (et.cardinality == "many") and not is_group,
        "group": is_group,
        "entry_label": et.entry_label if is_group else None,
        "fields": [
            PortableField.model_validate(f, from_attributes=True, by_name=True)
            for f in sorted(et.fields, key=lambda x: x.sort_order)
        ],
        "sections": [_section_dict(c, []) for c in children],
    }


async def to_portable(
    db: AsyncSession, *, project_id: UUID, template_id: UUID
) -> PortableTemplate:
    """Serialize the LIVE structure (what the grid shows — spec §3.3)."""
    tpl = await _owned_extraction_template(db, project_id=project_id, template_id=template_id)
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
    try:
        return PortableTemplate.model_validate(
            {
                "prumo_template": PORTABLE_FORMAT_VERSION,
                "kind": TemplateKind.EXTRACTION.value,
                "name": tpl.name,
                "description": tpl.description,
                "framework": tpl.framework,
                "version": tpl.version,
                "llm_template_instruction": tpl.llm_template_instruction or None,
                "sections": [_section_dict(et, children_of.get(et.id, [])) for et in roots],
            }
        )
    except ValidationError as exc:
        # Legacy rows the format cannot carry (e.g. an empty allowed_values
        # list) are a typed 422 naming the path, never a 500.
        issues, total = _issues(exc)
        raise TemplateExportInvalidError(issues, total=total) from exc


# ---------------------------------------------------------------- import


def _entity_type_row(
    section: PortableSection, *, template_id: UUID, parent_id: UUID | None, sort_order: int
) -> ExtractionEntityType:
    is_group = section.group
    role = (
        ExtractionEntityRole.MODEL_SECTION
        if parent_id is not None
        else ExtractionEntityRole.MODEL_CONTAINER
        if is_group
        else ExtractionEntityRole.STUDY_SECTION
    )
    return ExtractionEntityType(
        id=uuid4(),
        project_template_id=template_id,
        template_id=None,
        name=section.name,
        label=section.label,
        description=section.description,
        entry_label=(section.entry_label or "model") if is_group else None,
        parent_entity_type_id=parent_id,
        cardinality="many" if (is_group or section.repeats) else "one",
        role=role.value,
        sort_order=sort_order,
        is_required=section.is_required,
    )


def _field_row(f: PortableField, *, entity_type_id: UUID, sort_order: int) -> ExtractionField:
    # ``model_dump()`` (no alias) yields the column names 1:1.
    # validation_schema is vestigial (spec §4.4): same value the create path writes.
    return ExtractionField(
        entity_type_id=entity_type_id, sort_order=sort_order, validation_schema={}, **f.model_dump()
    )


async def import_portable(
    db: AsyncSession, *, project_id: UUID, doc: PortableTemplate, user_id: UUID
) -> CloneTemplateResponse:
    """Create a NEW active project template from ``doc`` and publish v1.

    Runs inside the caller's transaction; the caller commits. ids are
    pre-assigned so the whole tree lands in ONE flush (the clone service's
    shape); the deferred model_section-parent trigger fires at commit."""
    await deactivate_sibling_extraction_templates(db, project_id=project_id, keep_active_id=None)
    await db.flush()

    tpl = ProjectExtractionTemplate(
        id=uuid4(),
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
    rows: list[ExtractionEntityType | ExtractionField] = []
    order = 0

    def add_section(section: PortableSection, parent_id: UUID | None) -> ExtractionEntityType:
        nonlocal order
        et = _entity_type_row(section, template_id=tpl.id, parent_id=parent_id, sort_order=order)
        order += 1
        rows.append(et)
        rows.extend(
            _field_row(f, entity_type_id=et.id, sort_order=i) for i, f in enumerate(section.fields)
        )
        return et

    for section in doc.sections:
        parent = add_section(section, None)
        for child in section.sections:
            add_section(child, parent.id)

    db.add(tpl)
    db.add_all(rows)
    try:
        await db.flush()
    except IntegrityError as exc:
        if _SINGLE_ACTIVE_INDEX in str(getattr(exc, "orig", exc)):
            # Two imports/switches raced on the single-active index: the
            # sibling UPDATE above ran on a snapshot that never saw the
            # winner. Nothing is written (caller never commits).
            raise ConflictError(
                "Another template was activated at the same time; retry the import."
            ) from exc
        raise

    # Publish v1 through the one publish path: snapshots under its locks and
    # clears the draft marker the inserts above just stamped.
    republished = await TemplateVersionService(db).republish(
        project_id=project_id, project_template_id=tpl.id, user_id=user_id
    )
    return CloneTemplateResponse(
        project_template_id=tpl.id,
        version_id=republished.version_id,
        entity_type_count=sum(isinstance(r, ExtractionEntityType) for r in rows),
        field_count=sum(isinstance(r, ExtractionField) for r in rows),
        created=True,
    )
```

Check `ConflictError.__init__`'s signature in `app/core/error_handler.py:98-112` (it may take `message` plus `resource`); call it accordingly. Check the import graph: `template_version_service` imports `template_clone_service`; this module imports neither's private parts; `python -c "import app.services.template_portable_service"` must succeed.

- [ ] **Step 5: Run to verify they pass**

Run: `cd backend && uv run pytest tests/integration/test_template_portable_service.py tests/unit/test_template_portable_schema.py -q`
Expected: all PASS. If the round-trip differs, print both dumps (`pytest -vv`) — a difference means a column is dropped on one side; fix the serializer/importer, never the test. If `test_export_of_unrepresentable_rows_is_typed` cannot find `model_name` (field names differ per seed), pick any field of the clone by a subquery `LIMIT 1`.

- [ ] **Step 6: Lint, mypy, commit**

Run: `cd backend && uv run ruff format app/services/template_portable_service.py app/schemas/hitl_session.py tests/integration/test_template_portable_service.py && uv run ruff check app/ tests/integration/test_template_portable_service.py && uv run python ../scripts/mypy_baseline.py`

```bash
git add backend/app/services/template_portable_service.py backend/app/schemas/hitl_session.py backend/tests/integration/test_template_portable_service.py
git commit -m "feat(templates): portable export/import service with a lossless round-trip"
```

---

### Task 4: Delete service (under a row lock)

**Files:**
- Create: `backend/app/services/template_delete_service.py`
- Modify: `backend/app/schemas/hitl_session.py` (append `TemplateDeleteRefusalCode`, `TemplateDeleteRefusalDetails/Error/Response`, `TemplateDeleteResponse`)
- Test: `backend/tests/integration/test_template_delete_service.py`

**Interfaces:**
- Consumes: `ProjectTemplateNotFoundError` from `project_template_active_service`; `ExtractionRun`, `ExtractionInstance`, `ProjectExtractionTemplate` from `app.models.extraction`; `ExtractionHitlConfig`, `HitlConfigScopeKind` from `app.models.extraction_versioning`; `RunLifecycleService.create_run(project_id=, article_id=, project_template_id=, user_id=)` (tests).
- Produces: `async def delete_template(db, *, project_id: UUID, template_id: UUID) -> TemplateDeleteResponse`; `TemplateActiveError`, `TemplateInUseError` (`AppError`, 409); `TemplateDeleteRefusalCode(StrEnum)` {`TEMPLATE_ACTIVE`, `TEMPLATE_IN_USE`}; `TemplateDeleteRefusalDetails(runs: int, instances: int)`; `TemplateDeleteRefusalResponse` (declared 409 body); `TemplateDeleteResponse(project_template_id: UUID, deleted: bool)`.

Why a lock (spec §5.7, amended): `extraction_runs` carries TWO FKs to the template — `extraction_runs_template_id_fkey` (RESTRICT) and the composite `fk_extraction_runs_template_kind_coherence` (CASCADE). Postgres fires RI triggers in name order, so "RESTRICT wins" is an accident of creation order on both local and prod. The pre-check under `SELECT … FOR UPDATE` is therefore load-bearing: it serializes against `create_run`'s `FOR SHARE`, the instance-insert `KEY SHARE`, `set_template_active`'s UPDATE and `republish`'s `FOR UPDATE` — no advisory locks are taken, so no ABBA.

- [ ] **Step 1: Write the failing tests**

```python
# backend/tests/integration/test_template_delete_service.py
"""Guards and cascade for the project-template delete (spec §5.7)."""

from __future__ import annotations

from uuid import uuid4

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


async def _template_count(db: AsyncSession, project_id) -> int:
    return await _count(
        db,
        "SELECT COUNT(*) FROM public.project_extraction_templates WHERE project_id = :pid",
        pid=str(project_id),
    )


async def _insert_article(db: AsyncSession, project_id) -> str:
    aid = uuid4()
    await db.execute(
        text(
            "INSERT INTO public.articles (id, project_id, title, row_version) "
            "VALUES (:id, :pid, 'delete-guard article', 1)"
        ),
        {"id": str(aid), "pid": str(project_id)},
    )
    await db.flush()
    return str(aid)


@pytest.mark.asyncio
async def test_delete_refuses_active_template_and_writes_nothing(
    db_session: AsyncSession,
) -> None:
    project_id = SEED.secondary_project
    await clean_project_clones(db_session, project_id)
    active = await clone_charms(db_session, project_id, SEED.primary_profile)
    with pytest.raises(TemplateActiveError) as exc:
        await delete_template(
            db_session, project_id=project_id, template_id=active.project_template_id
        )
    assert exc.value.code == "TEMPLATE_ACTIVE" and exc.value.status_code == 409
    assert await _template_count(db_session, project_id) == 1


@pytest.mark.asyncio
async def test_delete_refuses_cross_project(db_session: AsyncSession) -> None:
    await clean_project_clones(db_session, SEED.secondary_project)
    clone = await clone_charms(db_session, SEED.secondary_project, SEED.primary_profile)
    with pytest.raises(ProjectTemplateNotFoundError):
        await delete_template(
            db_session, project_id=SEED.primary_project, template_id=clone.project_template_id
        )


@pytest.mark.asyncio
async def test_delete_refuses_template_with_a_run_and_writes_nothing(
    db_session: AsyncSession,
) -> None:
    from app.services.run_lifecycle_service import RunLifecycleService

    project_id = SEED.secondary_project
    await clean_project_clones(db_session, project_id)
    used = await clone_charms(db_session, project_id, SEED.primary_profile)
    article_id = await _insert_article(db_session, project_id)
    await RunLifecycleService(db_session).create_run(
        project_id=project_id,
        article_id=article_id,
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
    assert await _template_count(db_session, project_id) == 2


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
        "SELECT COUNT(*) FROM public.extraction_fields f "
        "JOIN public.extraction_entity_types et ON et.id = f.entity_type_id "
        "WHERE et.project_template_id = :tid",
    ):
        assert await _count(db_session, sql, tid=tid) == 0
    assert await _template_count(db_session, project_id) == 1
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd backend && uv run pytest tests/integration/test_template_delete_service.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.services.template_delete_service'`.

- [ ] **Step 3: Add the codes, declared body, and response**

Append to `backend/app/schemas/hitl_session.py` (same layout as the portable ones in Task 3):

```python
class TemplateDeleteRefusalCode(StrEnum):
    """Why ``DELETE …/templates/{id}`` returned 409 (spec §5.7)."""

    TEMPLATE_ACTIVE = "TEMPLATE_ACTIVE"
    TEMPLATE_IN_USE = "TEMPLATE_IN_USE"


class TemplateDeleteRefusalDetails(BaseModel):
    runs: int
    instances: int


class TemplateDeleteRefusalError(BaseModel):
    code: TemplateDeleteRefusalCode
    message: str
    details: TemplateDeleteRefusalDetails | None = None


class TemplateDeleteRefusalResponse(BaseModel):
    ok: bool = False
    error: TemplateDeleteRefusalError
    trace_id: str | None = None


class TemplateDeleteResponse(BaseModel):
    project_template_id: UUID
    deleted: bool
```

- [ ] **Step 4: Write the service**

```python
# backend/app/services/template_delete_service.py
"""Delete a project template — guarded under a row lock, then let the DB cascade.

Two refusals keep it boring (spec §3.6 / §5.7): the ACTIVE template cannot be
deleted (switch first — keeps the at-least-one-active extraction rule intact),
and a template any run or instance references cannot be deleted.

The guards run under ``SELECT … FOR UPDATE`` on the template row, and the
DELETE is conditional on ``is_active = false``: ``extraction_runs`` has a
second, composite FK to the template that is ON DELETE CASCADE, so "RESTRICT
refuses first" is only an accident of RI-trigger creation order — the locked
pre-check is what guarantees no run is ever cascaded away, and the
conditional DELETE is what stops a concurrent Switch from leaving the
project with zero active templates. The delete is a Core statement, not
``session.delete``: the ORM would try to NULL the children's
``project_template_id`` (breaking the template XOR CHECK) where the DB
``ON DELETE CASCADE`` just works.
"""

from __future__ import annotations

from uuid import UUID

from fastapi import status
from sqlalchemy import delete, func, select
from sqlalchemy.exc import IntegrityError
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

# The two RESTRICT FKs the pre-check mirrors; mapped if a race still trips them.
_IN_USE_CONSTRAINTS = ("extraction_runs_template_id_fkey", "extraction_instances_template_id_fkey")


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
    tpl = (
        await db.execute(
            select(ProjectExtractionTemplate)
            .where(ProjectExtractionTemplate.id == template_id)
            .with_for_update()
        )
    ).scalar_one_or_none()
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
    try:
        result = await db.execute(
            delete(ProjectExtractionTemplate).where(
                ProjectExtractionTemplate.id == template_id,
                ProjectExtractionTemplate.is_active.is_(False),
            )
        )
    except IntegrityError as exc:
        if any(name in str(getattr(exc, "orig", exc)) for name in _IN_USE_CONSTRAINTS):
            raise TemplateInUseError(runs=runs, instances=instances) from exc
        raise
    if result.rowcount != 1:
        # A concurrent Switch activated it between our read and the DELETE.
        raise TemplateActiveError()
    db.expunge(tpl)
    return TemplateDeleteResponse(project_template_id=template_id, deleted=True)
```

If `result.rowcount` is unavailable on the async result, use `result.rowcount` via `CursorResult` (it is — `db.execute(delete(...))` returns a `CursorResult`). Confirm the column names `ExtractionRun.template_id` / `ExtractionInstance.template_id` with `grep -n "template_id" backend/app/models/extraction.py`.

- [ ] **Step 5: Run to verify they pass**

Run: `cd backend && uv run pytest tests/integration/test_template_delete_service.py -q`
Expected: all PASS. If `create_run` raises on the ad-hoc article, read its docstring in `run_lifecycle_service.py` and satisfy the precondition inside the test — never weaken the guard.

- [ ] **Step 6: Lint, mypy, commit**

```bash
cd backend && uv run ruff format app/services/template_delete_service.py app/schemas/hitl_session.py tests/integration/test_template_delete_service.py && uv run ruff check app/ tests/integration/test_template_delete_service.py && uv run python ../scripts/mypy_baseline.py
git add backend/app/services/template_delete_service.py backend/app/schemas/hitl_session.py backend/tests/integration/test_template_delete_service.py
git commit -m "feat(templates): guarded project-template delete under a row lock"
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
  - `GET /api/v1/projects/{project_id}/templates/{template_id}/export` → `ApiResponse[PortableTemplate]`, `response_model_exclude_defaults=True`, `responses={422: {"model": TemplatePortableRefusalResponse}}`, `@limiter.limit("30/minute")`.
  - `POST /api/v1/projects/{project_id}/templates/import` (201), body `dict[str, Any]` → `ApiResponse[CloneTemplateResponse]`, `responses={422: …Portable…}`, `@limiter.limit("10/minute")`.
  - `DELETE /api/v1/projects/{project_id}/templates/{template_id}` → `ApiResponse[TemplateDeleteResponse]`, `responses={409: {"model": TemplateDeleteRefusalResponse}}`, `@limiter.limit("10/minute")`.
- Endpoint function names: `export_project_template`, `import_project_template`, `delete_project_template`.

- [ ] **Step 1: Write the failing direct-coroutine unit tests**

```python
# backend/tests/unit/test_project_templates_portable_endpoints_unit.py
"""Direct endpoint-coroutine tests for export / import / delete.

The HTTP-layer smoke (tests/integration/test_template_portable_endpoints.py)
runs through ASGITransport, whose handler lines do not register on
diff-cover; these call the coroutines directly. All three endpoints carry
``@limiter.limit``, so the request is a REAL starlette Request (slowapi
rejects mocks; a MagicMock trace_id also fails ApiResponse validation).
"""

from unittest.mock import AsyncMock, patch
from uuid import uuid4

import pytest
from fastapi import HTTPException
from starlette.requests import Request

from app.api.v1.endpoints.project_templates import (
    delete_project_template,
    export_project_template,
    import_project_template,
)
from app.main import app
from app.schemas.hitl_session import CloneTemplateResponse, TemplateDeleteResponse
from app.schemas.template_portable import PortableTemplate
from app.services.project_template_active_service import ProjectTemplateNotFoundError

_EP = "app.api.v1.endpoints.project_templates"

_DOC = PortableTemplate.model_validate(
    {"prumo_template": 1, "kind": "extraction", "name": "T",
     "sections": [{"name": "sec", "label": "S"}]}
)


def _request(method: str = "POST") -> Request:
    request = Request(
        {
            "type": "http",
            "method": method,
            "path": "/",
            "headers": [],
            "query_string": b"",
            "client": ("test-client", 1),
            "app": app,
        }
    )
    request.state.trace_id = "trace-1"
    return request


@pytest.mark.asyncio
async def test_export_returns_document_in_envelope() -> None:
    project_id, template_id = uuid4(), uuid4()
    with patch(f"{_EP}.to_portable", AsyncMock(return_value=_DOC)) as svc:
        resp = await export_project_template(
            project_id=project_id, template_id=template_id, request=_request("GET"),
            db=AsyncMock(), _user_sub=uuid4(),
        )
    assert svc.await_args.kwargs == {"project_id": project_id, "template_id": template_id}
    assert resp.ok is True and resp.data is _DOC and resp.trace_id == "trace-1"


@pytest.mark.asyncio
async def test_export_not_found_is_404() -> None:
    with patch(f"{_EP}.to_portable", AsyncMock(side_effect=ProjectTemplateNotFoundError("x"))):
        with pytest.raises(HTTPException) as exc:
            await export_project_template(
                project_id=uuid4(), template_id=uuid4(), request=_request("GET"),
                db=AsyncMock(), _user_sub=uuid4(),
            )
    assert exc.value.status_code == 404


@pytest.mark.asyncio
async def test_import_parses_then_imports_then_commits() -> None:
    project_id, caller = uuid4(), uuid4()
    result = CloneTemplateResponse(
        project_template_id=uuid4(), version_id=uuid4(),
        entity_type_count=1, field_count=0, created=True,
    )
    db = AsyncMock()
    with (
        patch(f"{_EP}.parse_portable_document", return_value=_DOC) as parse,
        patch(f"{_EP}.import_portable", AsyncMock(return_value=result)) as imp,
    ):
        resp = await import_project_template(
            project_id=project_id, request=_request(), db=db,
            body={"prumo_template": 1}, current_user_sub=caller,
        )
    parse.assert_called_once_with({"prumo_template": 1})
    assert imp.await_args.kwargs == {"project_id": project_id, "doc": _DOC, "user_id": caller}
    db.commit.assert_awaited_once()
    assert resp.data == result


@pytest.mark.asyncio
async def test_delete_returns_service_payload_and_commits() -> None:
    project_id, template_id = uuid4(), uuid4()
    payload = TemplateDeleteResponse(project_template_id=template_id, deleted=True)
    db = AsyncMock()
    with patch(f"{_EP}.delete_template", AsyncMock(return_value=payload)) as svc:
        resp = await delete_project_template(
            project_id=project_id, template_id=template_id, request=_request("DELETE"),
            db=db, _user_sub=uuid4(),
        )
    assert svc.await_args.kwargs == {"project_id": project_id, "template_id": template_id}
    db.commit.assert_awaited_once()
    assert resp.data == payload


@pytest.mark.asyncio
async def test_delete_not_found_is_404() -> None:
    with patch(f"{_EP}.delete_template", AsyncMock(side_effect=ProjectTemplateNotFoundError("x"))):
        with pytest.raises(HTTPException) as exc:
            await delete_project_template(
                project_id=uuid4(), template_id=uuid4(), request=_request("DELETE"),
                db=AsyncMock(), _user_sub=uuid4(),
            )
    assert exc.value.status_code == 404
```

- [ ] **Step 2: Write the failing HTTP smoke tests**

```python
# backend/tests/integration/test_template_portable_endpoints.py
"""HTTP-layer smoke for export / import / delete: routing + auth + envelope +
BOLA through the real ASGI stack. Behavior lives in the service tests.
``db_client`` shares ``db_session`` (no commits needed for visibility)."""

from __future__ import annotations

from uuid import UUID, uuid4

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from tests.integration.conftest import SEED, clean_project_clones, clone_charms
from tests.integration.helpers.template_fixtures import auth_as_manager  # noqa: F401 - fixture

TEMPLATES = "/api/v1/projects/{pid}/templates"


@pytest.mark.asyncio
async def test_export_then_import_over_http(
    db_session: AsyncSession, db_client: AsyncClient, auth_as_manager: UUID
) -> None:
    project_id = SEED.secondary_project
    await clean_project_clones(db_session, project_id)
    clone = await clone_charms(db_session, project_id, auth_as_manager)

    r = await db_client.get(f"{TEMPLATES.format(pid=project_id)}/{clone.project_template_id}/export")
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
    assert all(
        "allow_other" not in f or f["allow_other"] is True
        for s in doc["sections"] for f in s.get("fields", [])
    )

    r = await db_client.post(f"{TEMPLATES.format(pid=project_id)}/import", json=doc)
    assert r.status_code == 201, r.text
    assert r.json()["data"]["created"] is True


@pytest.mark.asyncio
async def test_import_wrong_kind_is_typed_422(db_client: AsyncClient, auth_as_manager: UUID) -> None:
    r = await db_client.post(
        f"{TEMPLATES.format(pid=SEED.secondary_project)}/import",
        json={"prumo_template": 1, "kind": "quality_assessment", "name": "x", "sections": []},
    )
    assert r.status_code == 422
    assert r.json()["error"]["code"] == "TEMPLATE_IMPORT_WRONG_KIND"


@pytest.mark.asyncio
async def test_import_invalid_carries_typed_details(
    db_client: AsyncClient, auth_as_manager: UUID
) -> None:
    r = await db_client.post(
        f"{TEMPLATES.format(pid=SEED.secondary_project)}/import",
        json={"prumo_template": 1, "kind": "extraction", "name": "x",
              "sections": [{"name": "sec", "label": "S",
                            "fields": [{"name": "Bad", "label": "B", "type": "text"}]}]},
    )
    assert r.status_code == 422
    err = r.json()["error"]
    assert err["code"] == "TEMPLATE_IMPORT_INVALID"
    assert err["details"]["errors"][0]["path"] == "sections[0].fields[0].name"


@pytest.mark.asyncio
async def test_export_foreign_project_is_404(
    db_session: AsyncSession, db_client: AsyncClient, auth_as_manager: UUID
) -> None:
    await clean_project_clones(db_session, SEED.secondary_project)
    clone = await clone_charms(db_session, SEED.secondary_project, auth_as_manager)
    r = await db_client.get(
        f"{TEMPLATES.format(pid=SEED.primary_project)}/{clone.project_template_id}/export"
    )
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_delete_active_is_typed_409_and_writes_nothing(
    db_session: AsyncSession, db_client: AsyncClient, auth_as_manager: UUID
) -> None:
    project_id = SEED.secondary_project
    await clean_project_clones(db_session, project_id)
    clone = await clone_charms(db_session, project_id, auth_as_manager)
    r = await db_client.delete(f"{TEMPLATES.format(pid=project_id)}/{clone.project_template_id}")
    assert r.status_code == 409
    assert r.json()["error"]["code"] == "TEMPLATE_ACTIVE"
    r = await db_client.get(f"{TEMPLATES.format(pid=project_id)}/{clone.project_template_id}/export")
    assert r.status_code == 200


@pytest.mark.asyncio
async def test_delete_unknown_is_404(db_client: AsyncClient, auth_as_manager: UUID) -> None:
    r = await db_client.delete(f"{TEMPLATES.format(pid=SEED.secondary_project)}/{uuid4()}")
    assert r.status_code == 404
```

`auth_as_manager` lives in `backend/tests/integration/helpers/template_fixtures.py:60` and is "imported by name into the suites that need it"; confirm the `noqa` import is how its other consumers register it (grep `auth_as_manager` under `tests/integration/`).

- [ ] **Step 3: Run both files to verify they fail**

Run: `cd backend && uv run pytest tests/unit/test_project_templates_portable_endpoints_unit.py tests/integration/test_template_portable_endpoints.py -q`
Expected: FAIL — `ImportError: cannot import name 'export_project_template'`.

- [ ] **Step 4: Add the endpoints**

In `backend/app/api/v1/endpoints/project_templates.py`, add to the imports:

```python
from typing import Any

from fastapi import Body

# add to the existing app.schemas.hitl_session import list:
#   TemplateDeleteRefusalResponse, TemplateDeleteResponse, TemplatePortableRefusalResponse
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
    responses={status.HTTP_422_UNPROCESSABLE_CONTENT: {"model": TemplatePortableRefusalResponse}},
)
@limiter.limit("30/minute")
async def export_project_template(
    project_id: UUID,
    template_id: UUID,
    request: Request,
    db: DbSession,
    _user_sub: UUID = Depends(require_project_manager),
) -> ApiResponse[PortableTemplate]:
    """Export the template's LIVE structure as a ``prumo-template@1`` document.

    Extraction templates only (a QA id 404s). Reads no draft state and takes
    no locks — the pending-draft confirmation is the frontend's (it already
    holds ``config-status``). The frontend writes ``data`` to disk, never the
    envelope. ``TemplateExportInvalidError`` (legacy rows the format cannot
    carry) is an ``AppError`` and reaches ``app_error_handler`` typed.
    """
    try:
        doc = await to_portable(db, project_id=project_id, template_id=template_id)
    except ProjectTemplateNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    return ApiResponse.success(doc, trace_id=getattr(request.state, "trace_id", None))


@router.post(
    "/{project_id}/templates/import",
    status_code=status.HTTP_201_CREATED,
    responses={status.HTTP_422_UNPROCESSABLE_CONTENT: {"model": TemplatePortableRefusalResponse}},
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

    The body is deliberately untyped at the HTTP layer: there is no
    ``RequestValidationError`` handler, so a typed body would yield FastAPI's
    un-enveloped 422 — parsing in the service is what turns a bad file into
    the typed ``TemplatePortableRefusalCode`` 422s (declared above so the
    contract still reaches schema.d.ts; the document's own schema is the
    export response's ``PortableTemplate`` component). Same response shape
    as the catalogue clone. A concurrent activation race is a 409 CONFLICT.
    """
    doc = parse_portable_document(body)
    result = await import_portable(db, project_id=project_id, doc=doc, user_id=current_user_sub)
    await db.commit()
    return ApiResponse.success(result, trace_id=getattr(request.state, "trace_id", None))


@router.delete(
    "/{project_id}/templates/{template_id}",
    responses={status.HTTP_409_CONFLICT: {"model": TemplateDeleteRefusalResponse}},
)
@limiter.limit("10/minute")
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

Update the module docstring with three bullets for the new routes. `Body(...)` after `db` is legal Python (ruff `B008` is ignored in this repo).

- [ ] **Step 5: Run to verify they pass, then the template suites and the fitness gate**

Run: `cd backend && uv run pytest tests/unit/test_project_templates_portable_endpoints_unit.py tests/integration/test_template_portable_endpoints.py -q`
Expected: PASS.

Run: `cd backend && uv run pytest tests/integration -q -k "template"`
Expected: PASS.

Run from the worktree root: `bash scripts/fitness/run_all.sh`
Expected: every fitness checker OK.

- [ ] **Step 6: Regenerate the API contract**

Run from the worktree root: `npm run generate:api-types`
Expected: `frontend/types/api/openapi.json` and `schema.d.ts` change; `grep -c "PortableTemplate\|TemplateDeleteResponse\|TemplatePortableRefusalResponse\|TemplateDeleteRefusalResponse" frontend/types/api/schema.d.ts` > 0 for each.

- [ ] **Step 7: Docs**

In `docs/reference/extraction-hitl-architecture.md` §4.3 add, after the clone table:

```markdown
**File import/export (2026-08-23).** The same dialog (now "Switch template")
also lists the project's own templates — active and inactive — with *Switch
to* (`PATCH …/templates/{id}`, which since this slice deactivates the
extraction sibling first) and *Delete* (`DELETE …/templates/{id}`: guards run
under `SELECT … FOR UPDATE` — 409 `TEMPLATE_ACTIVE` / `TEMPLATE_IN_USE`, else
DB cascade plus the template-scoped `extraction_hitl_configs` row; the locked
pre-check is load-bearing because `extraction_runs` also carries a composite
CASCADE FK to the template). `GET …/templates/{id}/export` serializes the
**live** structure as a `prumo-template@1` document (`app/schemas/
template_portable.py`: nested, UUID-free, `role` derived from nesting + a
`group` flag); `POST …/templates/import` creates a **new** active template
from one and publishes v1 through `republish`. Design:
`docs/superpowers/specs/2026-08-23-template-portable-import-export-design.md`.
```

Set `last_reviewed: 2026-08-23` in that file's frontmatter.

- [ ] **Step 8: Lint, mypy, frontmatter, commit**

```bash
cd backend && uv run ruff format app/api/v1/endpoints/project_templates.py tests/unit/test_project_templates_portable_endpoints_unit.py tests/integration/test_template_portable_endpoints.py && uv run ruff check app/ tests/ && uv run python ../scripts/mypy_baseline.py && cd ..
bash scripts/docs/check-frontmatter.sh
git add backend/app/api/v1/endpoints/project_templates.py backend/tests/unit/test_project_templates_portable_endpoints_unit.py backend/tests/integration/test_template_portable_endpoints.py frontend/types/api/openapi.json frontend/types/api/schema.d.ts docs/reference/extraction-hitl-architecture.md
git commit -m "feat(api): template export, import and delete endpoints + regenerated contract"
```

---

### Task 6: Frontend services, download helper, copy keys

**Files:**
- Create: `frontend/lib/download.ts`
- Modify: `frontend/services/templateImportService.ts`
- Modify: `frontend/lib/copy/templateConfig.ts` (new keys), `frontend/lib/copy/extraction.ts` (two values changed IN PLACE — the file must not grow)
- Test: `frontend/services/templateImportService.test.ts`

**Interfaces:**
- Produces:
  - `triggerDownload(blob: Blob, filename: string): void` in `@/lib/download` (for the new caller only; the three pre-existing private copies in `ArticlesExportDialog`, `ExtractionExportDialog`, `ExtractionErrorBoundary` are a spawned follow-up).
  - In `@/services/templateImportService`: `type PortableTemplateDoc = components['schemas']['PortableTemplate']`; `type PortableIssue = components['schemas']['TemplatePortableIssue']`; `exportTemplate(projectId, templateId): Promise<ErrorResult<PortableTemplateDoc>>`; `templateExportFilename(name: string): string` (`<slug>.prumo-template.json`, via `generateSnakeCaseName` with `_`→`-`); `importTemplateFromFile(projectId, file: File): Promise<ErrorResult<{templateId: string; entityTypesAdded: number; fieldsAdded: number}>>`; `deleteTemplate(projectId, templateId): Promise<ErrorResult<void>>`; `portableIssuesFromError(error: unknown): PortableIssue[] | null` (reads `ApiError.details.errors` when present).
  - Copy keys in `templateConfig`: `projectTemplatesHeading: "This project's templates"`, `projectTemplatesEmpty: 'No templates yet.'`, `projectTemplateActive: 'Active'`, `projectTemplateCreated: 'Added {{date}}'`, `projectTemplateSwitch: 'Switch to'`, `projectTemplateSwitchTooltip: 'Make this the active template'`, `projectTemplateDelete: 'Delete template'`, `projectTemplateDeleteTitle: 'Delete "{{name}}"?'`, `projectTemplateDeleteBody: 'Its sections and fields are removed. This cannot be undone.'`, `projectTemplateDeleted: 'Template deleted'`, `importFromCatalogueHeading: 'Add from the catalogue'`, `importFromFileHeading: 'Add from a file'`, `importFromFileHint: 'A .prumo-template.json file exported from prumo.'`, `importFromFileTrust: 'Only import templates you trust — a file can carry AI instructions.'`, `importFileChoose: 'Choose file'`, `importFileNone: 'No file selected'`, `importFileSubmit: 'Import file'`, `importFileNotJson: 'This is not a valid JSON file.'`, `importFileErrorsHeading: 'The file was rejected:'`, `importFields: 'fields'`, `exportTemplateButton: 'Export'`, `exportTemplateTooltip: 'Download this template as a JSON file'`, `exportDraftTitle: 'Export unpublished changes?'`, `exportDraftBody: 'This file includes unpublished changes.'`, `exportDraftConfirm: 'Export anyway'`, `exportError: 'Could not export the template'`.
  - In `extraction.ts`, change in place: `importTitle: 'Switch template'`, `importDesc: "Switch between this project's templates, or add one from the catalogue or a file."`.

- [ ] **Step 1: Write the failing service tests**

```ts
// frontend/services/templateImportService.test.ts
import {beforeEach, describe, expect, it, vi} from 'vitest';

vi.mock('@/integrations/api/client', () => ({
  apiClient: vi.fn(),
  // Real signature: (code, message, status, traceId?, details?) — client.ts:53-60.
  ApiError: class ApiError extends Error {
    constructor(
      public code: string,
      message: string,
      public status: number,
      public traceId?: string,
      public details?: Record<string, unknown>,
    ) {
      super(message);
    }
  },
}));
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {auth: {getUser: vi.fn(async () => ({data: {user: {id: 'u'}}}))}},
}));

import {ApiError, apiClient} from '@/integrations/api/client';
import {
  deleteTemplate,
  exportTemplate,
  importTemplateFromFile,
  portableIssuesFromError,
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
    expect(result.ok).toBe(true);
  });

  it('portableIssuesFromError reads the typed details, else null', () => {
    const typed = new ApiError('TEMPLATE_IMPORT_INVALID', 'Invalid', 422, undefined, {
      errors: [{path: 'sections[0].fields[1].name', message: 'bad'}],
      error_count: 1,
    });
    expect(portableIssuesFromError(typed)).toEqual([{path: 'sections[0].fields[1].name', message: 'bad'}]);
    expect(portableIssuesFromError(new Error('x'))).toBeNull();
    expect(portableIssuesFromError(new ApiError('CONFLICT', 'y', 409))).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm run test:run -- frontend/services/templateImportService.test.ts`
Expected: FAIL — `exportTemplate is not a function` (or import error).

- [ ] **Step 3: Write the download helper**

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

- [ ] **Step 4: Add the service functions**

Append to `frontend/services/templateImportService.ts` (keep `importGlobalTemplate` untouched; replace its private `interface CloneTemplateResponse` with the generated type — it is code this task touches):

```ts
import {ApiError} from '@/integrations/api/client';
import {generateSnakeCaseName} from '@/lib/extraction/slug';
import {toResult, type ErrorResult} from '@/lib/error-utils';
import type {components} from '@/types/api/schema';

type CloneTemplateResponse = components['schemas']['CloneTemplateResponse'];
export type PortableTemplateDoc = components['schemas']['PortableTemplate'];
export type PortableIssue = components['schemas']['TemplatePortableIssue'];

/** `<slug>.prumo-template.json`; falls back to `template` for an empty slug. */
export function templateExportFilename(name: string): string {
  const slug = generateSnakeCaseName(name).replace(/_/g, '-');
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
      throw new Error(t('templateConfig', 'importFileNotJson'));
    }
    const result = await apiClient<CloneTemplateResponse>(
      `/api/v1/projects/${projectId}/templates/import`,
      {method: 'POST', body: parsed, timeout: 120_000},
    );
    return {
      templateId: result.project_template_id,
      entityTypesAdded: result.entity_type_count,
      fieldsAdded: result.field_count,
    };
  }, 'templateImportService.importTemplateFromFile');
}

export function deleteTemplate(projectId: string, templateId: string): Promise<ErrorResult<void>> {
  return toResult(async () => {
    await apiClient<components['schemas']['TemplateDeleteResponse']>(
      `/api/v1/projects/${projectId}/templates/${templateId}`,
      {method: 'DELETE'},
    );
  }, 'templateImportService.deleteTemplate');
}

/** The typed issue list a 422 refusal carries (`TemplatePortableRefusalDetails`), or null. */
export function portableIssuesFromError(error: unknown): PortableIssue[] | null {
  if (!(error instanceof ApiError)) return null;
  const errors = error.details?.errors;
  return Array.isArray(errors) ? (errors as PortableIssue[]) : null;
}
```

Check `toResult`'s signature in `frontend/lib/error-utils.ts` (used as `toResult(async () => {...}, 'label')` in `qaTemplateService.ts`) and `ApiRequestOptions.body?: unknown` (`client.ts:44-47`) — no cast needed. If `ErrorResult` is exported under a different name, import that. `ErrorResult<void>` has precedent (`apiKeysService.ts:151`).

- [ ] **Step 5: Add the copy keys**

In `frontend/lib/copy/templateConfig.ts`, add a `// Switch-template dialog + portable import/export` block with every key from the Interfaces list above, verbatim values. In `frontend/lib/copy/extraction.ts`, change ONLY the values of `importTitle` and `importDesc` (lines ~317-318) — `wc -l` must still print 905. Run `npm run test:run -- frontend/test/copy-run-vocabulary.test.ts`.

- [ ] **Step 6: Run to verify they pass**

Run: `npm run test:run -- frontend/services/templateImportService.test.ts`
Expected: PASS.

- [ ] **Step 7: Typecheck, lint, fitness, commit**

```bash
npx tsc -p tsconfig.app.json --noEmit && npm run lint -- frontend/services/templateImportService.ts frontend/lib/download.ts frontend/lib/copy/templateConfig.ts frontend/lib/copy/extraction.ts && python3 scripts/fitness/check_file_size.py
git add frontend/lib/download.ts frontend/services/templateImportService.ts frontend/services/templateImportService.test.ts frontend/lib/copy/templateConfig.ts frontend/lib/copy/extraction.ts
git commit -m "feat(frontend): portable template services, download helper, dialog copy"
```

---

### Task 7: `ProjectTemplatesList` (Switch + Delete)

**Files:**
- Create: `frontend/components/extraction/dialogs/ProjectTemplatesList.tsx`
- Test: `frontend/components/extraction/dialogs/ProjectTemplatesList.test.tsx`

**Interfaces:**
- Consumes: `useHITLProjectTemplates({projectId, kind: 'extraction', includeInactive: true})` → `{templates, loading, refresh, setTemplateActive}` (`ProjectTemplate` has `id, name, framework, is_active, created_at`; export the type from the hook if it is not already); `deleteTemplate` from Task 6; `templateConfig` copy; shadcn `Button`, `Badge`, `Tooltip*`, `AlertDialog*`.
- Produces: `export function ProjectTemplatesList({projectId, onSwitched}: {projectId: string; onSwitched: (templateId: string) => void})`. Delete needs no callback: only inactive rows can be deleted, nothing outside this list holds them, and the list refreshes itself. Test ids: `project-template-row-{id}`, `project-template-active-{id}`, `project-template-switch-{id}`, `project-template-delete-{id}`, `project-template-delete-confirm`, `project-template-delete-error`.

- [ ] **Step 1: Write the failing test**

```tsx
// frontend/components/extraction/dialogs/ProjectTemplatesList.test.tsx
import {fireEvent, render, screen, waitFor} from '@testing-library/react';
import {beforeEach, describe, expect, it, vi} from 'vitest';

import {TooltipProvider} from '@/components/ui/tooltip';

const setTemplateActive = vi.fn(async () => true);
const refresh = vi.fn(async () => []);
const templatesState = {
  templates: [
    {id: 'a', name: 'Current CHARMS', framework: 'CHARMS', is_active: true, created_at: '2026-08-01T00:00:00Z'},
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
vi.mock('@/services/templateImportService', () => ({
  deleteTemplate: (...a: unknown[]) => deleteTemplate(...a),
}));
vi.mock('sonner', () => ({toast: {success: vi.fn(), error: vi.fn()}}));

import {ProjectTemplatesList} from './ProjectTemplatesList';

function renderList(onSwitched = vi.fn()) {
  render(
    <TooltipProvider>
      <ProjectTemplatesList projectId="p" onSwitched={onSwitched} />
    </TooltipProvider>,
  );
  return onSwitched;
}

describe('ProjectTemplatesList', () => {
  beforeEach(() => {
    setTemplateActive.mockClear();
    refresh.mockClear();
    deleteTemplate.mockReset();
  });

  it('marks the active row and offers Switch/Delete only on inactive rows', () => {
    renderList();
    expect(screen.getByTestId('project-template-active-a')).toBeInTheDocument();
    expect(screen.queryByTestId('project-template-active-b')).toBeNull();
    expect(screen.queryByTestId('project-template-switch-a')).toBeNull();
    expect(screen.queryByTestId('project-template-delete-a')).toBeNull();
    expect(screen.getByTestId('project-template-switch-b')).toBeInTheDocument();
    expect(screen.getByTestId('project-template-delete-b')).toBeInTheDocument();
  });

  it('Switch activates the template and reports the id', async () => {
    const onSwitched = renderList();
    fireEvent.click(screen.getByTestId('project-template-switch-b'));
    await waitFor(() => expect(setTemplateActive).toHaveBeenCalledWith('b', true));
    await waitFor(() => expect(onSwitched).toHaveBeenCalledWith('b'));
  });

  it('Delete asks for confirmation, then deletes and refreshes', async () => {
    deleteTemplate.mockResolvedValueOnce({ok: true, data: undefined});
    renderList();
    fireEvent.click(screen.getByTestId('project-template-delete-b'));
    expect(deleteTemplate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('project-template-delete-confirm'));
    await waitFor(() => expect(deleteTemplate).toHaveBeenCalledWith('p', 'b'));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it('renders a 409 message inline', async () => {
    deleteTemplate.mockResolvedValueOnce({
      ok: false,
      error: {code: 'TEMPLATE_IN_USE', message: 'extractions already reference it'},
    });
    renderList();
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
 * the active row carries neither. Delete reports to nobody: nothing outside
 * this list holds an inactive row, and the list refreshes itself.
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
}

export function ProjectTemplatesList({projectId, onSwitched}: ProjectTemplatesListProps) {
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
    toast.success(t('templateConfig', 'projectTemplateDeleted'));
    await refresh().catch(() => undefined);
  };

  return (
    <section aria-labelledby="project-templates-heading" className="space-y-2">
      <h3 id="project-templates-heading" className="text-[13px] font-medium text-foreground">
        {t('templateConfig', 'projectTemplatesHeading')}
      </h3>
      {loading ? (
        <div className="flex items-center gap-2 py-3 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          {t('extraction', 'importLoadingTemplates')}
        </div>
      ) : templates.length === 0 ? (
        <p className="py-3 text-sm text-muted-foreground">{t('templateConfig', 'projectTemplatesEmpty')}</p>
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
                  {tpl.is_active && (
                    <Badge data-testid={`project-template-active-${tpl.id}`} className="text-[11px]">
                      {t('templateConfig', 'projectTemplateActive')}
                    </Badge>
                  )}
                </div>
                <div className="text-xs text-muted-foreground">
                  {t('templateConfig', 'projectTemplateCreated').replace(
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
                        {busyId === tpl.id ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> : null}
                        {t('templateConfig', 'projectTemplateSwitch')}
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>{t('templateConfig', 'projectTemplateSwitchTooltip')}</TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8 text-muted-foreground hover:text-destructive"
                        aria-label={t('templateConfig', 'projectTemplateDelete')}
                        data-testid={`project-template-delete-${tpl.id}`}
                        disabled={busyId !== null}
                        onClick={() => setPendingDelete(tpl)}
                      >
                        <Trash2 className="h-4 w-4" aria-hidden />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>{t('templateConfig', 'projectTemplateDelete')}</TooltipContent>
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
              {t('templateConfig', 'projectTemplateDeleteTitle').replace('{{name}}', pendingDelete?.name ?? '')}
            </AlertDialogTitle>
            <AlertDialogDescription>{t('templateConfig', 'projectTemplateDeleteBody')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common', 'cancel')}</AlertDialogCancel>
            <AlertDialogAction
              data-testid="project-template-delete-confirm"
              onClick={() => void handleDeleteConfirmed()}
            >
              {t('templateConfig', 'projectTemplateDelete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
```

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
- Consumes: `importTemplateFromFile`, `portableIssuesFromError` (Task 6); `templateConfig` copy.
- Produces: `export function ImportTemplateFilePane({projectId, onImported}: {projectId: string; onImported: (templateId: string) => void})`. Test ids: `import-template-file-input`, `import-template-file-submit`, `import-template-file-errors`.

- [ ] **Step 1: Write the failing test**

```tsx
// frontend/components/extraction/dialogs/ImportTemplateFilePane.test.tsx
import {fireEvent, render, screen, waitFor} from '@testing-library/react';
import {beforeEach, describe, expect, it, vi} from 'vitest';

const importTemplateFromFile = vi.fn();
vi.mock('@/services/templateImportService', () => ({
  importTemplateFromFile: (...a: unknown[]) => importTemplateFromFile(...a),
  portableIssuesFromError: (error: unknown) =>
    (error as {details?: {errors?: unknown[]}}).details?.errors ?? null,
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
    await waitFor(() => expect(onImported).toHaveBeenCalledWith('new'));
  });

  it('renders the typed rejection list, one line per issue', async () => {
    importTemplateFromFile.mockResolvedValueOnce({
      ok: false,
      error: {
        code: 'TEMPLATE_IMPORT_INVALID',
        message: 'Invalid template file (1 issue(s)):\nsections[0].fields[1].name: String should match pattern',
        details: {errors: [{path: 'sections[0].fields[1].name', message: 'String should match pattern'}], error_count: 1},
      },
    });
    render(<ImportTemplateFilePane projectId="p" onImported={vi.fn()} />);
    pickFile();
    fireEvent.click(screen.getByTestId('import-template-file-submit'));
    const errors = await screen.findByTestId('import-template-file-errors');
    expect(errors).toHaveTextContent('The file was rejected:');
    expect(errors.querySelectorAll('li')).toHaveLength(1);
    expect(errors).toHaveTextContent('sections[0].fields[1].name: String should match pattern');
  });

  it('falls back to the message when there are no typed details', async () => {
    importTemplateFromFile.mockResolvedValueOnce({
      ok: false,
      error: {code: 'TEMPLATE_IMPORT_WRONG_KIND', message: 'Only extraction templates can be imported here.'},
    });
    render(<ImportTemplateFilePane projectId="p" onImported={vi.fn()} />);
    pickFile();
    fireEvent.click(screen.getByTestId('import-template-file-submit'));
    expect(await screen.findByTestId('import-template-file-errors')).toHaveTextContent(
      'Only extraction templates can be imported here.',
    );
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
 * document and its typed issue list (`details.errors`) renders here; any
 * other refusal renders its message (spec §6.2).
 */

import {useId, useState} from 'react';
import {Loader2, Upload} from 'lucide-react';
import {toast} from 'sonner';

import {Button} from '@/components/ui/button';
import {t} from '@/lib/copy';
import {importTemplateFromFile, portableIssuesFromError} from '@/services/templateImportService';

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
      const issues = portableIssuesFromError(result.error);
      setErrorLines(issues ? issues.map((i) => `${i.path}: ${i.message}`) : [result.error.message]);
      return;
    }
    toast.success(
      `${t('extraction', 'importSuccess')}: "${file.name}". ${result.data.entityTypesAdded} ${t('extraction', 'importSections')}, ${result.data.fieldsAdded} ${t('templateConfig', 'importFields')}.`,
    );
    setFile(null);
    onImported(result.data.templateId);
  };

  return (
    <section aria-labelledby={`${inputId}-heading`} className="space-y-2">
      <h3 id={`${inputId}-heading`} className="text-[13px] font-medium text-foreground">
        {t('templateConfig', 'importFromFileHeading')}
      </h3>
      <p className="text-xs text-muted-foreground">{t('templateConfig', 'importFromFileHint')}</p>
      <div className="flex items-center gap-2">
        <label
          htmlFor={inputId}
          // `relative`: the sr-only input inside is absolutely positioned — without
          // a positioned ancestor it adds phantom page scroll.
          className="relative inline-flex h-8 cursor-pointer items-center rounded-md border border-border/60 px-3 text-xs font-medium hover:bg-muted/50"
        >
          {t('templateConfig', 'importFileChoose')}
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
          {file?.name ?? t('templateConfig', 'importFileNone')}
        </span>
        <Button
          size="sm"
          data-testid="import-template-file-submit"
          disabled={!file || importing}
          onClick={() => void handleImport()}
        >
          {importing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> : <Upload className="mr-2 h-4 w-4" aria-hidden />}
          {t('templateConfig', 'importFileSubmit')}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">{t('templateConfig', 'importFromFileTrust')}</p>
      {errorLines && (
        <div
          role="alert"
          data-testid="import-template-file-errors"
          className="rounded-md border border-destructive/40 bg-destructive/5 p-2 text-xs text-destructive"
        >
          <div className="font-medium">{t('templateConfig', 'importFileErrorsHeading')}</div>
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

Also fix the pre-existing hardcoded `fields.` in `ImportTemplateDialog.tsx:96` to use `t('templateConfig', 'importFields')` (Task 9 edits that file anyway).

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

### Task 9: Compose the dialog; forward the active-template change from the editor host

**Files:**
- Modify: `frontend/components/extraction/dialogs/ImportTemplateDialog.tsx`
- Modify: `frontend/components/extraction/TemplateConfigEditor.tsx` (props + the dialog call site ~line 383)
- Modify: `frontend/components/extraction/ExtractionInterface.tsx` (the dialog call site ~line 585 and the `<TemplateConfigEditor>` mount ~line 413)
- Test: `frontend/components/extraction/dialogs/ImportTemplateDialog.test.tsx` (create)

**Interfaces:**
- Produces: `ImportTemplateDialog` props — `projectId`, `open`, `onOpenChange`, `onActiveTemplateChanged: (templateId: string) => void` (replaces `onTemplateImported`; fired after an import from the catalogue, an import from a file, or a Switch — every case means "the active template is now `id`"), `initialTemplateId?`.
- `TemplateConfigEditor` gains `onActiveTemplateChanged?: (templateId: string) => void`. Why: its own dialog instance used to call only `invalidateAfterImport()`, but `ExtractionInterface` owns `activeTemplate` (from the active-only `useHITLProjectTemplates`, not TanStack), so after an import/switch launched from the editor the grid kept rendering the now-inactive template. `ExtractionInterface` passes the same handler it gives its own dialog instance.

- [ ] **Step 1: Write the failing test**

```tsx
// frontend/components/extraction/dialogs/ImportTemplateDialog.test.tsx
import {fireEvent, render, screen} from '@testing-library/react';
import {describe, expect, it, vi} from 'vitest';

vi.mock('@/hooks/extraction/useGlobalTemplates', () => ({
  useGlobalTemplates: () => ({templates: [], loading: false, error: null, refresh: vi.fn()}),
}));
vi.mock('./ProjectTemplatesList', () => ({
  ProjectTemplatesList: ({onSwitched}: {onSwitched: (id: string) => void}) => (
    <button data-testid="stub-switch" onClick={() => onSwitched('switched-id')} />
  ),
}));
vi.mock('./ImportTemplateFilePane', () => ({
  ImportTemplateFilePane: ({onImported}: {onImported: (id: string) => void}) => (
    <button data-testid="stub-import" onClick={() => onImported('imported-id')} />
  ),
}));
vi.mock('@/services/templateImportService', () => ({importGlobalTemplate: vi.fn()}));
vi.mock('sonner', () => ({toast: {success: vi.fn(), error: vi.fn()}}));

import {ImportTemplateDialog} from './ImportTemplateDialog';

describe('ImportTemplateDialog (switch template)', () => {
  it('composes the three parts under the new title and forwards switch/import as one event', () => {
    const onOpenChange = vi.fn();
    const onActiveTemplateChanged = vi.fn();
    render(
      <ImportTemplateDialog
        projectId="p"
        open
        onOpenChange={onOpenChange}
        onActiveTemplateChanged={onActiveTemplateChanged}
      />,
    );
    expect(screen.getByTestId('import-template-dialog')).toHaveTextContent('Switch template');
    expect(screen.getByText('Add from the catalogue')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('stub-switch'));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onActiveTemplateChanged).toHaveBeenCalledWith('switched-id');

    fireEvent.click(screen.getByTestId('stub-import'));
    expect(onActiveTemplateChanged).toHaveBeenCalledWith('imported-id');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test:run -- frontend/components/extraction/dialogs/ImportTemplateDialog.test.tsx`
Expected: FAIL — prop/type error on `onActiveTemplateChanged`, or the stubs are not rendered.

- [ ] **Step 3: Recompose the dialog**

In `ImportTemplateDialog.tsx`:

1. Header comment: "Switch template — the project's own templates (switch/delete), the catalogue, and a file import. Hosted by TemplateConfigEditor and ExtractionInterface."
2. Rename the prop `onTemplateImported` → `onActiveTemplateChanged: (templateId: string) => void`; inside `handleImport` call `onActiveTemplateChanged(result.templateId!)` only when `result.templateId` is set (keep the existing toast; the hardcoded `fields.` becomes `${t('templateConfig', 'importFields')}.`).
3. Imports: `ProjectTemplatesList`, `ImportTemplateFilePane`; swap the `Download` icon import for `Upload`.
4. Title/description keep `t('extraction', 'importTitle')` / `t('extraction', 'importDesc')` (values changed in place in Task 6); icon `<Upload …/>`.
5. Body — inside `<DialogContent>` after the header, in order:

```tsx
        <ProjectTemplatesList
          projectId={projectId}
          onSwitched={(id) => {
            onOpenChange(false);
            onActiveTemplateChanged(id);
          }}
        />

        <section aria-labelledby="catalogue-heading" className="space-y-2">
          <h3 id="catalogue-heading" className="text-[13px] font-medium text-foreground">
            {t('templateConfig', 'importFromCatalogueHeading')}
          </h3>
          {/* existing loading / empty / RadioGroup list + selected-preview block, unchanged */}
        </section>

        <ImportTemplateFilePane
          projectId={projectId}
          onImported={(id) => {
            onOpenChange(false);
            onActiveTemplateChanged(id);
          }}
        />
```

   Keep the existing footer (Cancel + the catalogue Import button with `data-testid="import-template-submit"` — the existing E2E depends on it).
6. `DialogContent` className: widen to `sm:max-w-[680px]`.

In `TemplateConfigEditor.tsx`: add the optional prop `onActiveTemplateChanged?: (templateId: string) => void` to `TemplateConfigEditorProps`; at the dialog call site:

```tsx
      <ImportTemplateDialog
        projectId={projectId}
        open={showImportDialog}
        onOpenChange={setShowImportDialog}
        onActiveTemplateChanged={(templateId) => {
          setShowImportDialog(false);
          // Import/switch publish server-side, possibly for a DIFFERENT
          // template — id-free .all invalidation, then let the host re-point
          // `activeTemplate` (it owns that state; this editor is keyed by it).
          void invalidateAfterImport();
          onActiveTemplateChanged?.(templateId);
        }}
      />
```

In `ExtractionInterface.tsx`: extract the existing `onTemplateImported` arrow (refresh templates → stay on configuration → select by id) into a named `const handleActiveTemplateChanged = async (templateId: string) => {...}` (drop its `templateId?`-undefined branches — the id is always present now), pass it to both `<ImportTemplateDialog onActiveTemplateChanged={...}>` and `<TemplateConfigEditor onActiveTemplateChanged={handleActiveTemplateChanged}>`.

- [ ] **Step 4: Run the dialog tests and the existing editor/interface tests**

Run: `npm run test:run -- frontend/components/extraction/dialogs frontend/components/extraction/TemplateConfigEditor.test.tsx frontend/components/extraction/TemplateConfigEditor.discardMount.test.tsx frontend/test/ExtractionInterface*.test.tsx`
Expected: PASS. If an existing test renders the real dialog and now pulls `useHITLProjectTemplates` (→ supabase client) into its graph, add `vi.mock('@/components/extraction/dialogs/ProjectTemplatesList', …)` in that test rather than env.

- [ ] **Step 5: Env-less CI repro, typecheck, lint, commit**

Run: `mv .env .env.bak && npm run test:run -- frontend/components/extraction; mv .env.bak .env` — must be green without `VITE_SUPABASE_URL`.

```bash
npx tsc -p tsconfig.app.json --noEmit && npm run lint -- frontend/components/extraction/dialogs/ImportTemplateDialog.tsx frontend/components/extraction/TemplateConfigEditor.tsx frontend/components/extraction/ExtractionInterface.tsx
git add frontend/components/extraction/dialogs/ImportTemplateDialog.tsx frontend/components/extraction/dialogs/ImportTemplateDialog.test.tsx frontend/components/extraction/TemplateConfigEditor.tsx frontend/components/extraction/ExtractionInterface.tsx
git commit -m "feat(frontend): switch-template dialog composes project list, catalogue and file import"
```

---

### Task 10: `TemplateExportButton` with the pending-draft confirmation

**Files:**
- Create: `frontend/components/extraction/template-config/TemplateExportButton.tsx`
- Modify: `frontend/components/extraction/TemplateConfigEditor.tsx` (command bar ~lines 251-283: render the button, swap `Download` → `Upload` on the two import buttons)
- Modify: `frontend/components/extraction/TemplateConfigEditor.test.tsx` (mock `useTemplateConfigStatus`, like `.discardMount.test.tsx:64-66` does)
- Test: `frontend/components/extraction/template-config/TemplateExportButton.test.tsx`

**Interfaces:**
- Consumes: `exportTemplate`, `templateExportFilename` (Task 6); `triggerDownload` (Task 6); `useTemplateConfigStatus(projectId, templateId)` → `{data?: {has_pending_changes: boolean}}`; `AlertDialog*`, `Tooltip*`.
- Produces: `export function TemplateExportButton({projectId, templateId}: {projectId: string; templateId: string})` — same prop shape as `TemplateConfigPublishControls`. Test ids `template-config-export`, `template-config-export-confirm`.

- [ ] **Step 1: Write the failing test**

```tsx
// frontend/components/extraction/template-config/TemplateExportButton.test.tsx
import {fireEvent, render, screen, waitFor} from '@testing-library/react';
import {beforeEach, describe, expect, it, vi} from 'vitest';

import {TooltipProvider} from '@/components/ui/tooltip';

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

import {TemplateExportButton} from './TemplateExportButton';

const DOC = {prumo_template: 1, kind: 'extraction', name: 'My CHARMS', sections: [{name: 'sec', label: 'S'}]};

function renderButton() {
  render(
    <TooltipProvider>
      <TemplateExportButton projectId="p" templateId="t" />
    </TooltipProvider>,
  );
}

describe('TemplateExportButton', () => {
  let captured: {blob: Blob; filename: string} | null;
  beforeEach(() => {
    captured = null;
    apiClient.mockReset();
    statusState.data = {has_pending_changes: false};
    URL.createObjectURL = vi.fn(() => 'blob:x');
    URL.revokeObjectURL = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      captured = {
        blob: (URL.createObjectURL as ReturnType<typeof vi.fn>).mock.calls[0][0] as Blob,
        filename: this.download,
      };
    });
  });

  it('downloads the UNWRAPPED document under the slug filename', async () => {
    apiClient.mockResolvedValueOnce(DOC);
    renderButton();
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
    renderButton();
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

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test:run -- frontend/components/extraction/template-config/TemplateExportButton.test.tsx`
Expected: FAIL — cannot resolve `./TemplateExportButton`.

- [ ] **Step 3: Write the component and mount it**

```tsx
// frontend/components/extraction/template-config/TemplateExportButton.tsx
/**
 * Export the template's LIVE structure as a prumo-template@1 file (spec
 * §6.1). Sibling of TemplateConfigPublishControls: same prop shape, reads
 * config-status itself, owns its confirm. The file is the UNWRAPPED
 * document — never the envelope (the importer is `extra="forbid"`).
 */

import {useState} from 'react';
import {FileDown} from 'lucide-react';
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
import {Button} from '@/components/ui/button';
import {Tooltip, TooltipContent, TooltipTrigger} from '@/components/ui/tooltip';
import {useTemplateConfigStatus} from '@/hooks/extraction/useTemplateConfigStatus';
import {t} from '@/lib/copy';
import {triggerDownload} from '@/lib/download';
import {exportTemplate, templateExportFilename} from '@/services/templateImportService';

interface TemplateExportButtonProps {
  projectId: string;
  templateId: string;
}

export function TemplateExportButton({projectId, templateId}: TemplateExportButtonProps) {
  const {data: configStatus} = useTemplateConfigStatus(projectId, templateId);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const exportNow = async () => {
    const result = await exportTemplate(projectId, templateId);
    if (!result.ok) {
      toast.error(`${t('templateConfig', 'exportError')}: ${result.error.message}`);
      return;
    }
    triggerDownload(
      new Blob([JSON.stringify(result.data, null, 2)], {type: 'application/json'}),
      templateExportFilename(result.data.name),
    );
  };

  const handleClick = () => {
    if (configStatus?.has_pending_changes) {
      setConfirmOpen(true);
      return;
    }
    void exportNow();
  };

  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            data-testid="template-config-export"
            onClick={handleClick}
            className="h-8 text-muted-foreground hover:text-foreground"
          >
            <FileDown className="mr-2 h-4 w-4" />
            {t('templateConfig', 'exportTemplateButton')}
          </Button>
        </TooltipTrigger>
        <TooltipContent>{t('templateConfig', 'exportTemplateTooltip')}</TooltipContent>
      </Tooltip>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('templateConfig', 'exportDraftTitle')}</AlertDialogTitle>
            <AlertDialogDescription>{t('templateConfig', 'exportDraftBody')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common', 'cancel')}</AlertDialogCancel>
            <AlertDialogAction
              data-testid="template-config-export-confirm"
              onClick={() => {
                setConfirmOpen(false);
                void exportNow();
              }}
            >
              {t('templateConfig', 'exportDraftConfirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
```

In `TemplateConfigEditor.tsx`: import `TemplateExportButton`; render `<TemplateExportButton projectId={projectId} templateId={templateId} />` in the command bar immediately before the existing import button; swap `<Download …/>` to `<Upload …/>` on both import buttons (command bar + empty-state card) and fix the lucide import. In `TemplateConfigEditor.test.tsx`, add `vi.mock('@/hooks/extraction/useTemplateConfigStatus', () => ({useTemplateConfigStatus: () => ({data: undefined})}))` next to its other hook mocks (the editor now renders a consumer of it; without the mock the real `useQuery` hits the wholesale-mocked `templateService`).

- [ ] **Step 4: Run to verify it passes**

Run: `npm run test:run -- frontend/components/extraction/template-config/TemplateExportButton.test.tsx frontend/components/extraction/TemplateConfigEditor.test.tsx frontend/components/extraction/TemplateConfigEditor.discardMount.test.tsx`
Expected: PASS.

- [ ] **Step 5: Typecheck, lint, commit**

```bash
npx tsc -p tsconfig.app.json --noEmit && npm run lint -- frontend/components/extraction/template-config/TemplateExportButton.tsx frontend/components/extraction/template-config/TemplateExportButton.test.tsx frontend/components/extraction/TemplateConfigEditor.tsx frontend/components/extraction/TemplateConfigEditor.test.tsx
git add frontend/components/extraction/template-config/TemplateExportButton.tsx frontend/components/extraction/template-config/TemplateExportButton.test.tsx frontend/components/extraction/TemplateConfigEditor.tsx frontend/components/extraction/TemplateConfigEditor.test.tsx
git commit -m "feat(frontend): export template from the config command bar, confirming on a pending draft"
```

---

### Task 11: Playwright E2E on a dedicated fixture project + design review + spec status

**Files:**
- Modify: `frontend/e2e/_fixtures/fixture-ids.ts` (add `PORTABLE_PROJECT_ID`), `frontend/e2e/_fixtures/ensure-fixtures.ts` (provision it WITH CHARMS), `frontend/e2e/_fixtures/env.ts` (expose `portableProjectId`)
- Create: `frontend/e2e/flows/template-portable.ui.e2e.ts`
- Modify: `docs/superpowers/specs/2026-08-23-template-portable-import-export-design.md` (frontmatter `status: shipped`)

Why a dedicated project: the existing `template-import.ui.e2e.ts` and this spec both run in the `local-ui` Playwright project (`fullyParallel`, 2 workers in CI) and both flip the active template of whatever project they share; `E2E_IMPORT_PROJECT_ID` is also provisioned "intentionally NO CHARMS" (`ensure-fixtures.ts:175-176`), so `TemplateConfigEditor` (and its export button) never mounts there until something imports. A project provisioned WITH CHARMS removes both the interleaving and the bootstrap branch.

- [ ] **Step 1: Fixture project**

In `fixture-ids.ts` add `export const PORTABLE_PROJECT_ID = "e2e00001-0000-4000-8000-000000000002";` (next to `IMPORT_PROJECT_ID`). In `ensure-fixtures.ts` after the import-project block:

```ts
  // Portable import/export flow: needs an ACTIVE template from the start
  // (the export button lives in the config editor, which mounts only with
  // one) and must not share a project with the catalogue-import spec.
  await ensureProject(F.PORTABLE_PROJECT_ID, "E2E Portable Project", ownerId);
  await ensureMembership(F.PORTABLE_PROJECT_ID, ownerId, "manager");
  await ensureCharmsImported(F.PORTABLE_PROJECT_ID, ownerToken);
```

In `env.ts` add `portableProjectId: process.env.E2E_PORTABLE_PROJECT_ID || F.PORTABLE_PROJECT_ID` (type + value, mirroring `importProjectId`).

- [ ] **Step 2: Write the E2E**

```ts
// frontend/e2e/flows/template-portable.ui.e2e.ts
import {readFile} from 'node:fs/promises';

import {expect, test} from '@playwright/test';

import {loginViaUi} from '../_fixtures/auth';
import {loadE2EEnv, missingEnvKeys} from '../_fixtures/env';

/**
 * Export → import (renamed, with a unique first-section label) → the grid
 * renders the IMPORTED structure → switch back → delete the import. Runs on
 * PORTABLE_PROJECT_ID, provisioned with CHARMS by global setup, so the
 * config editor (and its export button) is mounted from the first paint.
 */
test.describe('Portable template import/export', () => {
  test('round-trips a template through a file and cleans up', async ({page}) => {
    test.setTimeout(180_000);
    const required = missingEnvKeys(['E2E_USER_EMAIL', 'E2E_USER_PASSWORD']);
    test.skip(required.length > 0, `Missing required env: ${required.join(', ')}`);

    const env = loadE2EEnv();
    await loginViaUi(page);
    await page.goto(
      `${env.frontendUrl}/projects/${env.portableProjectId}?tab=extraction&extractionTab=configuration`,
      {waitUntil: 'domcontentloaded'},
    );

    const exportButton = page.getByTestId('template-config-export');
    await expect(exportButton).toBeVisible({timeout: 60_000});

    // Export → capture the file.
    const downloadPromise = page.waitForEvent('download');
    await exportButton.click();
    const maybeConfirm = page.getByTestId('template-config-export-confirm');
    if (await maybeConfirm.isVisible().catch(() => false)) await maybeConfirm.click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/\.prumo-template\.json$/);
    const doc = JSON.parse(await readFile((await download.path())!, 'utf8'));
    expect(doc.prumo_template).toBe(1);
    expect(doc).not.toHaveProperty('data');

    // Import it back under a new name, with a first-section label that
    // exists NOWHERE in the original — the grid assertion below must prove
    // it renders the imported structure, not the old one.
    const stamp = Date.now();
    const renamed = structuredClone(doc);
    renamed.name = `E2E import ${stamp}`;
    renamed.sections[0].label = `Imported section ${stamp}`;
    await page.getByTestId('template-config-open-import').first().click();
    await page.getByTestId('import-template-file-input').setInputFiles({
      name: 'x.prumo-template.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(renamed)),
    });
    await page.getByTestId('import-template-file-submit').click();
    await expect(page.getByTestId('import-template-dialog')).toBeHidden({timeout: 60_000});
    await expect(page.getByText(`Imported section ${stamp}`).first()).toBeVisible({timeout: 60_000});

    // Switch back to the original, then delete the import.
    await page.getByTestId('template-config-open-import').first().click();
    const importedRow = page
      .locator('[data-testid^="project-template-row-"]')
      .filter({hasText: renamed.name});
    await expect(importedRow.locator('[data-testid^="project-template-active-"]')).toBeVisible();
    const originalRow = page
      .locator('[data-testid^="project-template-row-"]')
      .filter({hasNotText: renamed.name})
      .first();
    await originalRow.locator('[data-testid^="project-template-switch-"]').click();
    await expect(page.getByTestId('import-template-dialog')).toBeHidden({timeout: 30_000});
    await expect(page.getByText(`Imported section ${stamp}`)).toHaveCount(0, {timeout: 60_000});

    await page.getByTestId('template-config-open-import').first().click();
    await importedRow.locator('[data-testid^="project-template-delete-"]').click();
    await page.getByTestId('project-template-delete-confirm').click();
    await expect(importedRow).toHaveCount(0, {timeout: 30_000});
  });
});
```

- [ ] **Step 3: Run it against the worktree stack**

Backend: `cd backend && uv run uvicorn app.main:app --port 8000` (background, from the worktree). Frontend: `npx vite --port 8090` from the worktree root (8080 belongs to the main checkout); assert `pid=$(lsof -ti:8090 | head -1); lsof -a -p "$pid" -d cwd -Fn | grep '^n'` prints the worktree. Credentials: `E2E_USER_EMAIL`/`E2E_USER_PASSWORD` are the `OWNER_EMAIL` / `FIXTURE_PASSWORD` constants in `fixture-ids.ts` (not `teste@prumo.local`), and they are not in `.env` — pass them on the command line.

Run: `E2E_FRONTEND_URL=http://127.0.0.1:8090 E2E_USER_EMAIL=<OWNER_EMAIL> E2E_USER_PASSWORD=<FIXTURE_PASSWORD> npx playwright test frontend/e2e/flows/template-portable.ui.e2e.ts frontend/e2e/flows/template-import.ui.e2e.ts --project=local-ui`
Expected: 2 passed (the existing catalogue-import spec still passes — shared test ids unchanged).

- [ ] **Step 4: Design review of the dialog and the command bar**

Run `/design-review` on `/projects/<PORTABLE_PROJECT_ID>?tab=extraction&extractionTab=configuration` with the dialog open; fix density/spacing findings against the Plane/Linear target; re-screenshot.

- [ ] **Step 5: Spec status, commit**

- Spec frontmatter: `status: shipped`. (This plan is already in `.markdownlintignore`.)
- `bash scripts/docs/check-frontmatter.sh`.

```bash
git add frontend/e2e/_fixtures/fixture-ids.ts frontend/e2e/_fixtures/ensure-fixtures.ts frontend/e2e/_fixtures/env.ts frontend/e2e/flows/template-portable.ui.e2e.ts docs/superpowers/specs/2026-08-23-template-portable-import-export-design.md
git commit -m "test(e2e): portable template export → import → switch → delete; mark spec shipped"
```

---

## Self-review against the spec

| Spec section | Task |
| --- | --- |
| §3.1 import creates new, activates, publishes v1 | 3 |
| §3.3 live export + draft confirm | 3 (live rows), 10 (confirm) |
| §3.4 extraction only (import kind check; export rejects QA ids) | 1, 3 |
| §3.5 reachable imports (list + switch) | 2 (PATCH fix), 7, 9 |
| §3.6 delete | 4, 5, 7 |
| §4.1–4.3 keys, derived role, renames, caps (incl. the 4000 relaxation, description caps, total-fields cap) | 1 |
| §4.2 same-named sections legal | 1, 3 |
| §4.4 vestigial columns excluded, unknown key rejected | 1, 3 (`validation_schema={}` on import) |
| §5.1 three endpoints, unwrapped file, rate limits, declared refusal bodies | 5, 6, 10 |
| §5.2 modules, shared helper | 2, 3, 4 |
| §5.3 no topological sort, template-wide sort_order, concurrency → 409 | 3 |
| §5.4 typed errors + capped list (+ `TEMPLATE_EXPORT_INVALID`) | 3, 4, 5 |
| §5.5 caps | 1 |
| §5.6 switch deactivates sibling; QA untouched | 2 |
| §5.7 delete under FOR UPDATE, conditional DELETE, FK mapping, hitl config | 4 |
| §6.1 command bar Export + Upload icon | 10 |
| §6.2 dialog composition, browser doesn't validate, host forwards active change | 8, 9 |
| §6.3 services + copy (templateConfig namespace) | 6 |
| §7 accepted costs | — (no code) |
| §8 trust copy | 6, 8 |
| §9 verification list (every bullet, incl. "QA activation deactivates nothing") | 1, 2, 3, 4, 5, 7, 8, 10, 11 |
| §4.3 docs paragraph | 5 |

## Panel reconciliation (2026-08-23)

Five adversarial lenses reviewed the first draft. What changed and why:

- **Export 500 on CHARMS+Multimodal** (security, migration-safety): `llm_description` relaxed to 4000 in the format; export maps residual `ValidationError` to a typed 422; round-trip test parametrized over both seeded extraction globals with the instruction set explicitly (the seed backfill does not run in CI).
- **Delete TOCTOU** (security, migration-safety): guards under `SELECT … FOR UPDATE`, conditional `DELETE … WHERE is_active = false` with rowcount check, FK constraint names mapped to `TEMPLATE_IN_USE`. Spec §5.7 amended: the composite CASCADE FK makes RI-trigger order the real guarantee, so the locked pre-check is load-bearing.
- **Tied `sort_order`** (migration-safety): one template-wide pre-order counter for entity types.
- **mypy ratchet + frozen copy file** (constitution): `TemplateKind` from `extraction_versioning`; validated `model_validate(from_attributes=True, by_name=True)` export; all new copy in `templateConfig`.
- **Tests that could not pass as written** (test-coverage, constitution): ≥2-char names; real `Request` for limited endpoints; `TooltipProvider` wrappers; `auth_as_manager` reuse; dedicated Playwright project with a unique-label grid assertion; editor host forwards the active-template change (without it the grid kept showing the old template).
- **Simplifications** (simplicity): export/import field mapping via Pydantic attribute paths (no hand-maintained column lists); single flush with pre-assigned ids; `CloneTemplateResponse` returned by the service; `TemplateExportButton` extracted (test mocks 12 → 4); no `onDeleted` callback; `generateSnakeCaseName` reused; no unrelated `ArticlesExportDialog` edit (the three private `triggerDownload` copies are a spawned follow-up); dead `templateSwitched` key and the redundant validator `entry_label` fill dropped.
- **Spec amendments** recorded in the spec's "Amendments" section: caps on section/template `description` and total fields; `TEMPLATE_EXPORT_INVALID` and the 409 `CONFLICT` race; §8's list of every prompt-reaching key; rate limits on export/delete.
- **Out of slice, spawned as follow-ups**: `authenticated` still holds `DELETE/INSERT/UPDATE` on `project_extraction_templates` through PostgREST (bypasses the new guards); `extraction_entity_types`/`extraction_fields` SELECT policies are `USING (true)` (cross-tenant structure read); the three private `triggerDownload` copies.
