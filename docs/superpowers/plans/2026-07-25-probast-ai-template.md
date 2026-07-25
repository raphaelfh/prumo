---
status: draft
last_reviewed: 2026-07-25
owner: '@raphaelfh'
---

# PROBAST+AI Canonical QA Template Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Seed the PROBAST+AI instrument (Moons 2025) as a canonical
`quality_assessment` template, with its four overall judgments computed by a
single backend worst-domain module rather than typed by reviewers.

**Architecture:** One flat global template (10 parentless `study_section`
entity types, 58 select fields) seeded from a new `backend/app/seed_probast_ai.py`
module. The overall-judgment derivation spec is *data* on the template's
existing `schema` JSONB column; one pure backend module reads it and is
consumed by both the run-view payload and the xlsx export, so the rule has
exactly one implementation. The frontend only renders.

**Tech Stack:** Python 3.11 / SQLAlchemy 2.0 async / Pydantic v2 / pytest;
React 19 / TypeScript strict / TanStack Query / vitest.

## Global Constraints

- **No Alembic migration in this plan.** Every change is seed data, service
  code, Pydantic schema code, or frontend. If a step seems to need a new
  column, STOP — the design forbids it.
- **File-size ratchet — five touched files sit EXACTLY at their baseline cap.**
  `scripts/fitness/check_file_size.py` fails on `GREW:` (exit 1), and
  `backend/tests/unit/scripts/test_check_file_size.py:15` shells out to the
  real check on the real tree, so a breach reds **both** the Fitness job and
  Backend Tests. Verified caps: `backend/app/seed.py` 1954,
  `backend/app/services/extraction_export_service.py` 2261,
  `backend/app/services/section_extraction_service.py` 1657,
  `frontend/pages/QualityAssessmentFullScreen.tsx` 874,
  `frontend/test/QualityAssessmentFullScreen.test.tsx` 1111. Any task that
  grows one of these MUST end with, in the same commit:
  ```bash
  python3 scripts/fitness/check_file_size.py --update-baseline
  git add scripts/fitness/check_file_size.baseline
  ```
  A **new** file under `MAX_LINES_DEFAULT = 800` needs no baseline entry;
  a new file over 800 fails as `NEW over-ceiling file`.
- **mypy ratchet.** `backend/pyproject.toml:119` sets `strict = true`, and
  `backend/.mypy_baseline` has **no entry for `app/seed.py`** — so new backend
  code must be fully annotated. Every new function needs a return type.
  Verify with:
  ```bash
  cd backend && { uv run mypy app --ignore-missing-imports || true; } | uv run python ../scripts/mypy_baseline.py --baseline .mypy_baseline
  ```
- **English only** for code, comments, labels, descriptions, commit messages.
- `allowed_values` must be a **flat `list[str]`**, never `{value,label}` dicts
  (`test_seed_dispositions.py` does `set(f.allowed_values or [])` → `TypeError`
  on dicts).
- Signaling questions must pass the **module constant object**
  `_PROBAST_SIGNALING` (not a copy) — `_signaling` sets
  `allows_not_applicable=(allowed is _PROBAST_SIGNALING)` by **identity**.
- Backend layering (CI-enforced): `api → services → repositories → models`;
  `app.schemas` and `app.llm` are allowed support imports from services.
- Frontend: all user-facing text through `frontend/lib/copy/`; no `fetch()` in
  components; React Compiler forbids `try/finally` in component/hook bodies.
- Run backend commands from `backend/`; frontend commands from the **repo
  root** (`npm run test:run`, never `npm test` — watch mode hangs).
- Commit after every task. Conventional commits.

---

## File Structure

**PR1 — the template exists, renders correctly, and is usable**

| File | Responsibility |
|---|---|
| `backend/app/services/template_clone_service.py` (modify ~line 344) | Carry `allows_not_applicable` / `allows_not_evaluated` into the project clone |
| `backend/tests/integration/test_template_clone_dispositions.py` (create) | Lock the clone flag copy |
| `backend/app/services/section_extraction_service.py` (modify line 452) | Feed the QA prompt the template **name**, not the framework enum |
| `backend/tests/unit/test_qa_prompt_framework_label.py` (create) | Lock the prompt label source |
| `backend/app/seed_probast_ai.py` (**create**, target ≤ 400 lines) | The whole PROBAST+AI definition + derivation spec |
| `backend/app/seed.py` (modify: `_signaling` widened, import + `main()` call) | Shared helpers; registration |
| `backend/tests/unit/test_seed_probast_ai.py` (create) | Shape of the seeded template (no DB) |
| `backend/tests/unit/test_seed_dispositions.py` (modify) | ADR-0016 sweep covers the new seed |
| `backend/tests/integration/test_kind_discriminator.py` (modify) | Allow the new QA template name |
| `frontend/lib/extraction/judgmentFields.ts` (create) | Data-driven "is this a judgment field" predicate |
| `frontend/components/assessment/QASectionAccordion.tsx` (modify) | Use the predicate instead of the name allowlist |
| `frontend/test/lib/judgmentFields.test.ts` (create) | Predicate vectors |
| `backend/tests/integration/test_qa_seed.py` (modify) | PROBAST+AI in a seeded DB |
| `docs/how-to/seed-database.md`, `frontend/lib/copy/qa.ts` (modify) | Document + name the new tool |

**PR2 — the overalls are computed**

| File | Responsibility |
|---|---|
| `backend/app/services/derived_judgment_service.py` (create) | THE worst-domain rule. Pure, no IO, no ORM |
| `backend/tests/unit/test_derived_judgment_service.py` (create) | Rule vectors incl. strict/lenient asymmetry |
| `backend/app/schemas/extraction_run.py` (modify) | `RunViewDerivedJudgment` + field on `RunViewResponse` |
| `backend/app/services/extraction_run_read_service.py` (modify) | Resolve coordinates, pick the right value set, call the module |
| `backend/tests/unit/test_run_view_derived_judgments.py` (create) | Direct-call unit tests (ASGI blind spot) |
| `backend/app/services/extraction_export_service.py` (modify) | Descriptor `name` passthrough; spec-driven appraisal |
| `backend/app/services/exports/extraction/appraisal_summary.py` (modify) | Render named overall columns |
| `backend/tests/unit/test_appraisal_derived_overalls.py` (create) | Export uses the same module |
| `frontend/components/assessment/OverallJudgmentBanner.tsx` (create) | Dumb render of the 4 computed overalls |
| `frontend/hooks/runs/types.ts`, `frontend/pages/QualityAssessmentFullScreen.tsx`, `frontend/lib/copy/qa.ts` (modify) | Wire + copy |
| `frontend/test/components/OverallJudgmentBanner.test.tsx` (create) | Banner rendering incl. the null case |

---

# PR1

## Task 1: Clone preserves ADR-0016 disposition flags

`TemplateCloneService._insert_project_structure_from_global` copies 14 field
columns but omits both disposition flags, so every NA-enabled signaling
question loses its "Not applicable" affordance the moment a project adopts the
template — and the loss is frozen into the version snapshot. This blocks the
whole PROBAST+AI seed, so it goes first.

**Files:**
- Modify: `backend/app/services/template_clone_service.py:343-361`
- Test: `backend/tests/integration/test_template_clone_dispositions.py` (create)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: no new API. Behavioral guarantee relied on by Task 3.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/integration/test_template_clone_dispositions.py`.
The exact names below are verified — do not substitute:
`TemplateCloneService.clone` is keyword-only with a **required** `kind`
(`template_clone_service.py:63-70`); the returned `TemplateClone` exposes
`project_template_id` and has **no** `.id` (`:33-47`); the integration
conftest exposes ids via the module constant `SEED`
(`backend/tests/integration/conftest.py:129`), not per-id fixtures.

```python
"""Clone must carry ADR-0016 opt-in disposition flags into the project copy.

Without this, every PROBAST / PROBAST+AI signaling question loses its
"Not applicable" affordance inside a project (and in the frozen version
snapshot), because the project clone is what the run-open form renders.
"""

from uuid import UUID

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.extraction_versioning import TemplateKind
from app.services.template_clone_service import TemplateCloneService
from tests.integration.conftest import SEED

_PROBAST_TEMPLATE_ID = UUID("00b00000-0000-0000-0000-000000000001")


@pytest.mark.asyncio
async def test_clone_preserves_not_applicable_flag(db_session: AsyncSession) -> None:
    global_na = (
        await db_session.execute(
            text(
                """
                SELECT COUNT(*) FROM public.extraction_fields f
                JOIN public.extraction_entity_types et ON et.id = f.entity_type_id
                WHERE et.template_id = :tid AND f.allows_not_applicable
                """
            ),
            {"tid": str(_PROBAST_TEMPLATE_ID)},
        )
    ).scalar()
    assert global_na and global_na > 0, "PROBAST global must have NA-enabled fields"

    clone = await TemplateCloneService(db_session).clone(
        project_id=SEED.primary_project,
        global_template_id=_PROBAST_TEMPLATE_ID,
        user_id=SEED.primary_profile,
        kind=TemplateKind.QUALITY_ASSESSMENT,
    )
    await db_session.flush()

    cloned_na = (
        await db_session.execute(
            text(
                """
                SELECT COUNT(*) FROM public.extraction_fields f
                JOIN public.extraction_entity_types et ON et.id = f.entity_type_id
                WHERE et.project_template_id = :tid AND f.allows_not_applicable
                """
            ),
            {"tid": str(clone.project_template_id)},
        )
    ).scalar()
    assert cloned_na == global_na, (
        f"clone dropped disposition flags: {cloned_na} of {global_na} survived"
    )
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd backend && uv run pytest tests/integration/test_template_clone_dispositions.py -v
```

Expected: FAIL — `clone dropped disposition flags: 0 of 20 survived`.

- [ ] **Step 3: Write minimal implementation**

In `backend/app/services/template_clone_service.py`, inside the
`ExtractionField(...)` construction, add two columns after
`other_placeholder=f.other_placeholder,`:

```python
                        other_placeholder=f.other_placeholder,
                        # ADR-0016 opt-in dispositions travel with the field:
                        # the project clone is what the run-open form renders,
                        # so dropping them here silently removes the
                        # "Not applicable" affordance from every signaling
                        # question (and freezes that loss into the snapshot).
                        allows_not_applicable=f.allows_not_applicable,
                        allows_not_evaluated=f.allows_not_evaluated,
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd backend && uv run pytest tests/integration/test_template_clone_dispositions.py -v
```

Expected: PASS.

- [ ] **Step 5: Confirm the snapshot needs no change**

Read `backend/app/services/extraction_snapshot.py:62-63` — `SNAPSHOT_SQL`
already selects both columns, so the frozen snapshot picks the values up for
free. Do **not** edit `SNAPSHOT_SQL` or migration 0026.

- [ ] **Step 6: Commit**

```bash
git add backend/app/services/template_clone_service.py backend/tests/integration/test_template_clone_dispositions.py
git commit -m "fix(templates): carry ADR-0016 disposition flags into project clones"
```

---

## Task 2: QA prompt names the instrument, not the framework enum

Every QA AI run currently prompts *"assessing a study using CUSTOM"* because
`framework` is the `extraction_framework` enum (`CHARMS`/`PICOS`/`CUSTOM`) and
all QA templates are `CUSTOM`. Passing the template **name** avoids an enum
migration.

**Files:**
- Modify: `backend/app/services/section_extraction_service.py:452`
- Test: `backend/tests/unit/test_qa_prompt_framework_label.py` (create)

**Interfaces:**
- Consumes: nothing.
- Produces: `_qa_framework_label(template: Any | None) -> str | None` (module
  level). No signature change to `quality_assessment.system_prompt` / `.render`
  — only the *value* passed changes.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/unit/test_qa_prompt_framework_label.py`:

```python
"""The QA prompt must name the instrument, not the framework enum.

Every quality-assessment template is framework='CUSTOM' (the enum has only
CHARMS/PICOS/CUSTOM), so interpolating `template.framework` produced the
literal prompt "assessing a study using CUSTOM".
"""

from app.llm.prompts import quality_assessment
from app.services.section_extraction_service import _qa_framework_label


def test_system_prompt_uses_given_label() -> None:
    assert "PROBAST+AI" in quality_assessment.system_prompt("PROBAST+AI")


def test_system_prompt_falls_back_when_label_missing() -> None:
    assert "the assessment tool" in quality_assessment.system_prompt(None)


def test_label_prefers_template_name() -> None:
    class _Tpl:
        name = "PROBAST+AI"
        framework = "CUSTOM"

    assert _qa_framework_label(_Tpl()) == "PROBAST+AI"


def test_label_is_none_without_a_template() -> None:
    assert _qa_framework_label(None) is None


def test_label_falls_back_to_framework_when_name_blank() -> None:
    class _Tpl:
        name = "   "
        framework = "CHARMS"

    assert _qa_framework_label(_Tpl()) == "CHARMS"
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd backend && uv run pytest tests/unit/test_qa_prompt_framework_label.py -v
```

Expected: FAIL — `ImportError: cannot import name '_qa_framework_label'`.

- [ ] **Step 3: Write minimal implementation**

Add this module-level helper to
`backend/app/services/section_extraction_service.py`, above the service class:

```python
def _qa_framework_label(template: Any | None) -> str | None:
    """Label the QA prompt grounds in.

    Prefers the template's human name ("PROBAST+AI", "QUADAS-2") over
    ``framework``: every quality-assessment template is ``framework='CUSTOM'``
    (the enum has only CHARMS/PICOS/CUSTOM), so the enum produced the literal
    prompt "assessing a study using CUSTOM". Falls back to ``framework`` when
    the name is missing or blank.
    """
    if template is None:
        return None
    name = (getattr(template, "name", None) or "").strip()
    return name or getattr(template, "framework", None)
```

Then replace line 452 — **this is the only `template.framework` read in the
file**; `grep -n framework` shows only `:439` (a docstring) and `:452`.
Everything downstream is parameter plumbing; do **not** rename parameters.

```python
        framework: str | None = _qa_framework_label(template)
```

Update the docstring at `:438-441` to say the prompt is selected from
`run.kind` + the template **name**.

- [ ] **Step 4: Run test to verify it passes**

```bash
cd backend && uv run pytest tests/unit/test_qa_prompt_framework_label.py -v
```

Expected: PASS (5 passed).

- [ ] **Step 5: Run the neighbouring suite**

```bash
cd backend && uv run pytest tests/unit/test_section_extraction_service.py -v
```

Expected: PASS. If a test asserts the old `CUSTOM` label, update that
assertion — the new behavior is the intended one.

- [ ] **Step 6: Bump the file-size baseline (this file is AT its cap)**

```bash
python3 scripts/fitness/check_file_size.py --update-baseline
git diff scripts/fitness/check_file_size.baseline
```

Expected: `section_extraction_service.py` cap rises from 1657.

- [ ] **Step 7: Commit**

```bash
git add backend/app/services/section_extraction_service.py backend/tests/unit/test_qa_prompt_framework_label.py scripts/fitness/check_file_size.baseline
git commit -m "fix(llm): ground QA prompts in the template name, not the framework enum"
```

---

## Task 3: Seed the PROBAST+AI template

Lives in its **own module** — `backend/app/seed.py` is at its file-size cap
(1954) and the definition is ~350 lines.

**Files:**
- Create: `backend/app/seed_probast_ai.py`
- Modify: `backend/app/seed.py` (widen `_signaling`; import + `main()` call)
- Modify: `backend/tests/integration/test_kind_discriminator.py:97-104`
- Test: `backend/tests/unit/test_seed_probast_ai.py` (create)
- Test: `backend/tests/unit/test_seed_dispositions.py` (modify)

**Interfaces:**
- Consumes from `app.seed`: `_EntitySpec`, `_entity_type_from_spec`,
  `_qa_field`, `_signaling` (widened in Step 3), `_PROBAST_SIGNALING`,
  `_PROBAST_JUDGMENT`.
- Produces: `async def seed_probast_ai(session: AsyncSession) -> None`,
  `_PROBAST_AI_TEMPLATE_ID: UUID`, `_PAI_DERIVED_JUDGMENTS: list[dict[str, Any]]`.
  Task 6's cross-check imports all three.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/unit/test_seed_probast_ai.py`:

```python
"""Shape of the seeded PROBAST+AI template (no DB — capturing session)."""

from __future__ import annotations

from typing import Any

import pytest

from app.models.extraction import (
    ExtractionEntityType,
    ExtractionField,
    ExtractionTemplateGlobal,
)
from app.seed import _PROBAST_JUDGMENT, _PROBAST_SIGNALING
from app.seed_probast_ai import seed_probast_ai


class _CapturingSession:
    def __init__(self) -> None:
        self.added: list[Any] = []

    async def get(self, *_a: Any, **_k: Any) -> None:
        return None

    def add(self, obj: Any) -> None:
        self.added.append(obj)


async def _seed() -> _CapturingSession:
    session = _CapturingSession()
    await seed_probast_ai(session)
    return session


def _of(session: _CapturingSession, cls: type) -> list[Any]:
    return [o for o in session.added if isinstance(o, cls)]


@pytest.mark.asyncio
async def test_template_row() -> None:
    tpl = _of(await _seed(), ExtractionTemplateGlobal)
    assert len(tpl) == 1
    assert tpl[0].name == "PROBAST+AI"
    assert tpl[0].kind == "quality_assessment"
    assert tpl[0].framework == "CUSTOM"


@pytest.mark.asyncio
async def test_ten_flat_sections() -> None:
    ets = _of(await _seed(), ExtractionEntityType)
    assert len(ets) == 10
    # Flat: a grouping parent is unrepresentable (role CHECK + the
    # one-model_container-per-template partial unique index).
    assert all(et.parent_entity_type_id is None for et in ets)
    assert all(et.role == "study_section" for et in ets)
    assert all(et.cardinality == "one" for et in ets)
    assert sorted(et.sort_order for et in ets) == list(range(1, 11))


@pytest.mark.asyncio
async def test_field_counts_per_section() -> None:
    session = await _seed()
    names = {et.id: et.name for et in _of(session, ExtractionEntityType)}
    counts: dict[str, int] = {}
    for f in _of(session, ExtractionField):
        counts[names[f.entity_type_id]] = counts.get(names[f.entity_type_id], 0) + 1
    assert counts == {
        "dev_d1_participants": 5,
        "dev_d2_predictors": 6,
        "dev_d3_outcome": 6,
        "dev_d4_analysis": 6,
        "eval_d1_participants": 5,
        "eval_d2_predictors": 6,
        "eval_d3_outcome": 6,
        "eval_d4_analysis_apparent": 6,
        "eval_d4_analysis_internal": 7,
        "eval_d4_analysis_external": 5,
    }
    assert sum(counts.values()) == 58


@pytest.mark.asyncio
async def test_sort_orders_are_dense_and_unique_per_section() -> None:
    """Guards the enumerate-driven emission against duplicate/missing orders."""
    session = await _seed()
    per_section: dict[Any, list[int]] = {}
    for f in _of(session, ExtractionField):
        per_section.setdefault(f.entity_type_id, []).append(f.sort_order)
    for eid, orders in per_section.items():
        assert sorted(orders) == list(range(len(orders))), (eid, sorted(orders))


@pytest.mark.asyncio
async def test_signaling_fields_allow_not_applicable() -> None:
    fields = _of(await _seed(), ExtractionField)
    signaling = [f for f in fields if f.allowed_values == _PROBAST_SIGNALING]
    assert len(signaling) == 42
    assert all(f.allows_not_applicable for f in signaling)
    assert not any(f.allows_not_evaluated for f in signaling)


@pytest.mark.asyncio
async def test_signaling_prompts_are_question_specific() -> None:
    """Each question carries its own instruction, not the generic default."""
    fields = _of(await _seed(), ExtractionField)
    signaling = [f for f in fields if f.allowed_values == _PROBAST_SIGNALING]
    assert all(f.llm_description for f in signaling)
    assert not any(
        (f.llm_description or "").startswith("Answer the signaling question:")
        for f in signaling
    )


@pytest.mark.asyncio
async def test_judgment_fields() -> None:
    fields = _of(await _seed(), ExtractionField)
    judgments = [f for f in fields if f.allowed_values == _PROBAST_JUDGMENT]
    assert len(judgments) == 16
    assert not any(f.allows_not_applicable or f.allows_not_evaluated for f in judgments)
    assert sorted({f.name for f in judgments}) == [
        "applicability_concerns",
        "quality_concern",
        "risk_of_bias",
    ]


@pytest.mark.asyncio
async def test_na_defaults_expressed_by_omission() -> None:
    """d4_q5 (leakage) and d4_q6 (resampling) are NA for apparent + external,
    so they exist ONLY in the internal-validation section; the gate q1 exists
    only once."""
    session = await _seed()
    names = {et.id: et.name for et in _of(session, ExtractionEntityType)}
    where: dict[str, set[str]] = {}
    for f in _of(session, ExtractionField):
        where.setdefault(f.name, set()).add(names[f.entity_type_id])
    assert where["q5_data_leakage_avoided"] == {"eval_d4_analysis_internal"}
    assert where["q6_resampling_replicates_all_steps"] == {"eval_d4_analysis_internal"}
    assert where["q1_apparent_only_avoided"] == {"eval_d4_analysis_apparent"}


@pytest.mark.asyncio
async def test_derived_judgment_spec_on_template_schema() -> None:
    tpl = _of(await _seed(), ExtractionTemplateGlobal)[0]
    spec = tpl.schema_["derived_judgments"]
    assert [d["id"] for d in spec] == [
        "dev_overall_quality",
        "dev_overall_applicability",
        "eval_overall_rob",
        "eval_overall_applicability",
    ]
    assert all(d["rule"] == "worst_domain" for d in spec)
    rob = next(d for d in spec if d["id"] == "eval_overall_rob")
    collapse = [i for i in rob["inputs"] if "collapse" in i]
    assert len(collapse) == 1
    assert collapse[0]["collapse"] == "worst_of"
    assert len(collapse[0]["inputs"]) == 3


@pytest.mark.asyncio
async def test_every_spec_input_resolves_to_a_seeded_field() -> None:
    """No dangling (section, field) reference — a dangling ref silently nulls
    an overall forever, because the seed never UPDATEs an existing template."""
    session = await _seed()
    names = {et.id: et.name for et in _of(session, ExtractionEntityType)}
    real = {(names[f.entity_type_id], f.name) for f in _of(session, ExtractionField)}
    tpl = _of(session, ExtractionTemplateGlobal)[0]

    def _refs(inputs: list[dict[str, Any]]) -> list[tuple[str, str]]:
        out: list[tuple[str, str]] = []
        for item in inputs:
            if "collapse" in item:
                out.extend(_refs(item["inputs"]))
            else:
                out.append((item["section"], item["field"]))
        return out

    for derived in tpl.schema_["derived_judgments"]:
        for ref in _refs(derived["inputs"]):
            assert ref in real, f"{derived['id']} references missing field {ref}"


@pytest.mark.asyncio
async def test_idempotent_when_template_exists() -> None:
    class _Existing(_CapturingSession):
        async def get(self, *_a: Any, **_k: Any) -> Any:
            return object()

    session = _Existing()
    await seed_probast_ai(session)
    assert session.added == []
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd backend && uv run pytest tests/unit/test_seed_probast_ai.py -v
```

Expected: FAIL — `ModuleNotFoundError: No module named 'app.seed_probast_ai'`.

- [ ] **Step 3: Widen `_signaling` to accept a per-question prompt**

`_signaling` currently hardcodes `llm=f"Answer the signaling question: {question}"`
(`backend/app/seed.py:1307-1332`). PROBAST+AI needs per-question instructions.
**Never bypass `_signaling` for a signaling question** — routing around it via
bare `_qa_field` silently drops the identity-based
`allows_not_applicable` and breaks Step 7's assertions.

```python
def _signaling(
    eid: UUID,
    name: str,
    question: str,
    sort: int,
    allowed: list[str],
    *,
    llm: str | None = None,
) -> ExtractionField:
    """Build a signaling-question ExtractionField (select with fixed answer set).

    PROBAST signaling questions historically offered "NA" (not applicable); under
    ADR-0016 that becomes the opt-in ``not_applicable`` disposition flag. Detected
    by identity of the PROBAST answer set (QUADAS-2's Y/N/Unclear set never
    offered NA, so it stays flag-free).

    ``llm`` overrides the generic instruction for checklists (PROBAST+AI) whose
    published elaboration gives each question its own criterion.
    """
    return _qa_field(
        eid,
        name,
        question,
        question,
        "select",
        sort,
        allowed=allowed,
        allows_not_applicable=(allowed is _PROBAST_SIGNALING),
        llm=llm or f"Answer the signaling question: {question}",
    )
```

- [ ] **Step 4: Write `backend/app/seed_probast_ai.py`**

Question sets are declared **once** and reused across the parts and the three
evaluation-D4 performance types — the D1/D2/D3 questions are identical in both
parts, and `enumerate` assigns sort orders so they cannot drift.

```python
"""PROBAST+AI canonical quality-assessment template (Moons et al., BMJ 2025).

Kept in its own module because ``app.seed`` is at its file-size ratchet cap and
this definition is large. Shares every helper with ``app.seed`` so the field
shape (and the ADR-0016 identity check on the answer set) cannot drift.

Structure: a model-development part judged on Quality (16 signaling questions)
and a model-evaluation part judged on Risk of Bias (18), four domains each,
with evaluation domain 4 assessed separately per reported performance type
(apparent / internal / external).

Two structural notes:

* The two parts are SIBLING sections, not a tree. A grouping parent would have
  to be ``role='model_container'`` (0016 role CHECK) and at most one such node
  may exist per template (partial unique index).
* Per-type "not applicable by default" answers (data leakage and resampling in
  the apparent and external types) are expressed by OMITTING the field from
  those sections — ``extraction_fields`` has no default-value column.

The four overall judgments are NOT seeded as fields: they are computed from the
domain judgments by ``derived_judgment_service``, configured by the
``derived_judgments`` spec on this template's ``schema`` JSONB.
"""

from __future__ import annotations

from typing import Any
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.extraction import (
    ExtractionEntityRole,
    ExtractionField,
    ExtractionTemplateGlobal,
)
from app.models.extraction_versioning import TemplateKind
from app.seed import (
    _PROBAST_JUDGMENT,
    _PROBAST_SIGNALING,
    _EntitySpec,
    _entity_type_from_spec,
    _qa_field,
    _signaling,
)

# ---------------------------------------------------------------------------
# Fixed UUIDs — never change (prefix convention: 000c CHARMS, 00b0 PROBAST,
# 00d0 QUADAS-2, 00ba PROBAST+AI).
# ---------------------------------------------------------------------------

_PROBAST_AI_TEMPLATE_ID = UUID("00ba0000-0000-0000-0000-000000000001")
_ET_DEV_D1 = UUID("00ba0001-0000-0000-0000-000000000000")
_ET_DEV_D2 = UUID("00ba0002-0000-0000-0000-000000000000")
_ET_DEV_D3 = UUID("00ba0003-0000-0000-0000-000000000000")
_ET_DEV_D4 = UUID("00ba0004-0000-0000-0000-000000000000")
_ET_EVAL_D1 = UUID("00ba0005-0000-0000-0000-000000000000")
_ET_EVAL_D2 = UUID("00ba0006-0000-0000-0000-000000000000")
_ET_EVAL_D3 = UUID("00ba0007-0000-0000-0000-000000000000")
_ET_EVAL_D4_A = UUID("00ba0008-0000-0000-0000-000000000000")
_ET_EVAL_D4_I = UUID("00ba0009-0000-0000-0000-000000000000")
_ET_EVAL_D4_E = UUID("00ba000a-0000-0000-0000-000000000000")

# Section machine names — referenced by the derivation spec, so they are
# declared once here.
_S_DEV_D1 = "dev_d1_participants"
_S_DEV_D2 = "dev_d2_predictors"
_S_DEV_D3 = "dev_d3_outcome"
_S_DEV_D4 = "dev_d4_analysis"
_S_EVAL_D1 = "eval_d1_participants"
_S_EVAL_D2 = "eval_d2_predictors"
_S_EVAL_D3 = "eval_d3_outcome"
_S_EVAL_D4_A = "eval_d4_analysis_apparent"
_S_EVAL_D4_I = "eval_d4_analysis_internal"
_S_EVAL_D4_E = "eval_d4_analysis_external"

_F_QUALITY = "quality_concern"
_F_ROB = "risk_of_bias"
_F_APPLICABILITY = "applicability_concerns"

_ANSWER_INSTRUCTION = (
    " Answer Y, PY, PN or N; mark no information when the article is silent, "
    "and not applicable when the criterion does not apply."
)

# (name, official text, criterion) — the criterion is appended to the shared
# answer instruction to form ``llm_description``.
_Question = tuple[str, str, str]

_D1_QUESTIONS: tuple[_Question, ...] = (
    (
        "q1_appropriate_data_sources",
        "Were appropriate data sources used?",
        "Assess whether the data source is appropriate and its provenance is "
        "traceable — enough detail on how the data were collected and measured. "
        "Open-repository sources with insufficient collection detail are a "
        "concern and can hide fairness problems.",
    ),
    (
        "q2_appropriate_study_design",
        "Was an appropriate study design used?",
        "Assess whether the study design suits the task: a prospective "
        "longitudinal cohort is preferred for prognosis; selective sampling "
        "(case-cohort, nested case-control) must be adjusted for the sampling "
        "fraction; registry and routine-care data carry more quality problems.",
    ),
    (
        "q3_representative_dataset",
        "Did the inclusions and exclusions of study participants result in a "
        "representative dataset?",
        "Assess whether inclusions and exclusions align with the intended use "
        "and leave a dataset representative of the target population, with no "
        "marginalised subgroup improperly excluded.",
    ),
)

_D2_QUESTIONS: tuple[_Question, ...] = (
    (
        "q1_similar_definition_assessment",
        "Were predictors defined and assessed in a similar way for all participants?",
        "Assess whether definitions, thresholds and measurement methods were "
        "the same across participants. Risk is higher for subjective predictors "
        "(imaging, electrophysiology, pathology).",
    ),
    (
        "q2_similar_preprocessing",
        "Was any preprocessing of predictors similar for all participants?",
        "Assess whether preprocessing — value standardisation, feature "
        "extraction from unstructured data such as images or signals — was the "
        "same across participants, centres and subgroups.",
    ),
    (
        "q3_blind_to_outcome",
        "Were predictor assessments made without knowledge of outcome data?",
        "Assess whether predictors were measured blind to the outcome. This "
        "matters most for subjective predictors and is frequently unreported; "
        "when unreported, answer no information.",
    ),
    (
        "q4_available_at_intended_use",
        "Were the predictors included in the model available at the time the "
        "model was intended to be used?",
        "Assess whether every predictor in the final model is obtainable at the "
        "moment of intended use (for example, a preoperative model must not use "
        "an intraoperative or postoperative predictor).",
    ),
)

_D3_QUESTIONS: tuple[_Question, ...] = (
    (
        "q1_appropriate_definition",
        "Were outcomes defined and assessed appropriately?",
        "Assess whether the outcome definition is standard and prespecified and "
        "the measurement method accurate. Error is larger with non-standard "
        "definitions, subjective or composite outcomes, and data-driven "
        "thresholds.",
    ),
    (
        "q2_similar_definition_assessment",
        "Were outcomes defined and assessed in a similar way for all participants?",
        "Assess whether the same definition, threshold and method (including "
        "number of visits) applied to all participants; watch for partial or "
        "differential verification in diagnostic studies.",
    ),
    (
        "q3_blind_to_predictors",
        "Were outcome assessments made without use or knowledge of predictor data?",
        "Assess whether the outcome was determined blind to the predictors. If a "
        "predictor forms part of the outcome definition, the association is "
        "spurious and performance is inflated.",
    ),
    (
        "q4_appropriate_time_interval",
        "Was the time interval between predictor assessment and outcome "
        "assessment appropriate?",
        "Assess whether the predictor-to-outcome interval is neither too short "
        "nor too long: ideally simultaneous for diagnosis, and consistent with "
        "the stated horizon for prognosis.",
    ),
)

_DEV_D4_QUESTIONS: tuple[_Question, ...] = (
    (
        "q1_reasonable_sample_size",
        "Was there evidence that the sample size was reasonable?",
        "Assess whether the development sample is large relative to model "
        "complexity, considering the number of parameters and the event "
        "fraction. Regularisation does not substitute for an adequate sample; "
        "when no information is given, lean to no information.",
    ),
    (
        "q2_continuous_categorical_handling",
        "Were continuous and categorical predictors handled appropriately?",
        "Assess whether categorisation or dichotomisation discarded information "
        "or used data-driven thresholds; regression should ideally model "
        "non-linearity (splines, fractional polynomials).",
    ),
    (
        "q3_missing_censored_handling",
        "Were participants with missing or censored data handled appropriately "
        "in the analysis?",
        "Assess whether selective exclusion was avoided, whether multiple "
        "imputation (generally preferred) was used, and whether censoring was "
        "handled — competing risks where relevant. Silence often means an "
        "implicit complete-case analysis.",
    ),
    (
        "q4_imbalance_recalibration",
        "If methods to address class imbalance were used, was the model or the "
        "model predictions recalibrated?",
        "Conditional criterion: if class-imbalance corrections (under- or "
        "oversampling, SMOTE) were used in development, assess whether the model "
        "or its predictions were recalibrated — those corrections distort "
        "estimated probabilities. If no imbalance method was used, answer not "
        "applicable.",
    ),
    (
        "q5_overfitting_methods",
        "Were methods used to address potential model overfitting?",
        "Assess whether overfitting was addressed: sufficient data, avoiding "
        "data-driven univariable selection (the winner's curse), regularisation "
        "or shrinkage, and careful hyperparameter tuning for AI models.",
    ),
)

# --- Evaluation D4, split by performance type -------------------------------

_EVAL_D4_GATE: tuple[_Question, ...] = (
    (
        "q1_apparent_only_avoided",
        "Was model evaluation based on only apparent performance avoided?",
        "Domain gate, answered ONCE for the whole evaluation domain and stored "
        "in the apparent-performance section. Apparent performance is estimated "
        "on the same data used for development and is optimistic; the study is "
        "expected to go beyond it, with internal validation (resampling or "
        "cross-validation on the development set) and/or external validation "
        "(participants not used for development). Answer N when only apparent "
        "performance was reported, in which case the internal and external "
        "sections are left blank.",
    ),
)

# Asked for every reported performance type.
_EVAL_D4_CORE: tuple[_Question, ...] = (
    (
        "q2_reasonable_sample_size",
        "Was there evidence that the sample size was reasonable?",
        "For THIS performance type, assess whether the evaluation sample is "
        "large enough to estimate performance precisely; subgroups may have too "
        "few participants.",
    ),
    (
        "q3_missing_censored_handling",
        "Were participants with missing or censored data handled appropriately "
        "in the analysis?",
        "For THIS performance type, assess whether missing or censored data were "
        "handled appropriately and selective exclusion avoided. In external "
        "data, beware a systematically absent predictor — its coefficient must "
        "not simply be zeroed.",
    ),
    (
        "q4_uncorrected_imbalance_evaluation",
        "If methods to address class imbalance were used, was the evaluation "
        "done in a dataset without correction for imbalance?",
        "Conditional criterion: if imbalance corrections were used in "
        "development, the evaluation must run on data WITHOUT that correction, "
        "which distorts the true prevalence. If no correction was used, answer "
        "not applicable.",
    ),
)

# Internal validation only — NA by definition for apparent and external, so
# these fields are omitted from those sections entirely.
_EVAL_D4_INTERNAL_ONLY: tuple[_Question, ...] = (
    (
        "q5_data_leakage_avoided",
        "If data splitting was done to create training and test datasets, was "
        "there evidence that data leakage was avoided?",
        "Assess whether leakage was avoided: overlap between evaluation and "
        "training data, or re-tuning parameters on the evaluation data, "
        "overestimates performance.",
    ),
    (
        "q6_resampling_replicates_all_steps",
        "If resampling methods were used to evaluate model performance, were "
        "all model development steps replicated in the resampling process?",
        "Assess whether EVERY development step — imputation, variable "
        "selection, hyperparameter tuning, fitting — was replicated inside each "
        "resampling iteration; otherwise optimism is underestimated.",
    ),
)

_EVAL_D4_PERFORMANCE: tuple[_Question, ...] = (
    (
        "q7_appropriate_performance_measures",
        "Was the predictive performance of the model evaluated appropriately, "
        "for example, calibration, discrimination, and net benefit?",
        "For THIS performance type, assess whether performance was evaluated "
        "appropriately: ideally calibration (a curve, not only a "
        "goodness-of-fit test), discrimination (for example the c-index) and "
        "clinical utility (net benefit). Omitting calibration or discrimination "
        "signals a problem; calibration reported only as apparent is weakly "
        "informative.",
    ),
)

# (name, label, official judgment text)
_Judgment = tuple[str, str, str]

_APPLICABILITY_D1 = (
    _F_APPLICABILITY,
    "Applicability concerns",
    "Concern that the data of the included participants do not match the review "
    "question or the intended use of the prediction model",
)
_APPLICABILITY_D2 = (
    _F_APPLICABILITY,
    "Applicability concerns",
    "Concern that the definition, preprocessing, assessment, or timing of "
    "assessment of the predictors in the model do not match the review question "
    "or the intended use",
)
_APPLICABILITY_D3 = (
    _F_APPLICABILITY,
    "Applicability concerns",
    "Concern that the outcome, its definition, assessment, or timing of "
    "assessment do not match the review question or the intended use",
)

# (entity id, name, label, description, questions, judgments)
_Section = tuple[UUID, str, str, str, tuple[_Question, ...], tuple[_Judgment, ...]]


def _sections() -> tuple[_Section, ...]:
    """The ten sections, in display order."""
    return (
        (
            _ET_DEV_D1,
            _S_DEV_D1,
            "Development D1: Participants and data sources",
            "PROBAST+AI model-development domain 1 — quality of participant "
            "selection and data sources.",
            _D1_QUESTIONS,
            (
                (
                    _F_QUALITY,
                    "Quality",
                    "Concern regarding quality of selection of participants and "
                    "data sources",
                ),
                _APPLICABILITY_D1,
            ),
        ),
        (
            _ET_DEV_D2,
            _S_DEV_D2,
            "Development D2: Predictors",
            "PROBAST+AI model-development domain 2 — quality of the predictors "
            "and their assessment.",
            _D2_QUESTIONS,
            (
                (
                    _F_QUALITY,
                    "Quality",
                    "Concern regarding the quality of the predictors or their "
                    "assessment",
                ),
                _APPLICABILITY_D2,
            ),
        ),
        (
            _ET_DEV_D3,
            _S_DEV_D3,
            "Development D3: Outcome",
            "PROBAST+AI model-development domain 3 — quality of the outcome and "
            "its determination.",
            _D3_QUESTIONS,
            (
                (
                    _F_QUALITY,
                    "Quality",
                    "Concern regarding quality of the outcome or its determination",
                ),
                _APPLICABILITY_D3,
            ),
        ),
        (
            _ET_DEV_D4,
            _S_DEV_D4,
            "Development D4: Analysis",
            "PROBAST+AI model-development domain 4 — quality of the analysis. "
            "Applicability is not judged for domain 4.",
            _DEV_D4_QUESTIONS,
            ((_F_QUALITY, "Quality", "Concern regarding quality of the analysis"),),
        ),
        (
            _ET_EVAL_D1,
            _S_EVAL_D1,
            "Evaluation D1: Participants and data sources",
            "PROBAST+AI model-evaluation domain 1 — risk of bias from "
            "participant selection and data sources.",
            _D1_QUESTIONS,
            (
                (
                    _F_ROB,
                    "Risk of bias",
                    "Risk of bias introduced by the selection of participants and "
                    "data sources",
                ),
                _APPLICABILITY_D1,
            ),
        ),
        (
            _ET_EVAL_D2,
            _S_EVAL_D2,
            "Evaluation D2: Predictors",
            "PROBAST+AI model-evaluation domain 2 — risk of bias from the "
            "predictors or their assessment.",
            _D2_QUESTIONS,
            (
                (
                    _F_ROB,
                    "Risk of bias",
                    "Risk of bias introduced by the predictors or their assessment",
                ),
                _APPLICABILITY_D2,
            ),
        ),
        (
            _ET_EVAL_D3,
            _S_EVAL_D3,
            "Evaluation D3: Outcome",
            "PROBAST+AI model-evaluation domain 3 — risk of bias from the "
            "outcome or its determination.",
            _D3_QUESTIONS,
            (
                (
                    _F_ROB,
                    "Risk of bias",
                    "Risk of bias introduced by the outcome or its determination",
                ),
                _APPLICABILITY_D3,
            ),
        ),
        (
            _ET_EVAL_D4_A,
            _S_EVAL_D4_A,
            "Evaluation D4: Analysis (apparent performance)",
            "PROBAST+AI model-evaluation domain 4, judged for APPARENT "
            "performance (estimated on the same data used for development). "
            "Leave blank when the study reports no apparent performance.",
            _EVAL_D4_GATE + _EVAL_D4_CORE + _EVAL_D4_PERFORMANCE,
            ((_F_ROB, "Risk of bias", "Risk of bias introduced by the analysis"),),
        ),
        (
            _ET_EVAL_D4_I,
            _S_EVAL_D4_I,
            "Evaluation D4: Analysis (internal validation)",
            "PROBAST+AI model-evaluation domain 4, judged for INTERNAL "
            "validation (resampling — cross-validation or bootstrap — within the "
            "development data). Leave blank when the study reports none.",
            _EVAL_D4_CORE + _EVAL_D4_INTERNAL_ONLY + _EVAL_D4_PERFORMANCE,
            ((_F_ROB, "Risk of bias", "Risk of bias introduced by the analysis"),),
        ),
        (
            _ET_EVAL_D4_E,
            _S_EVAL_D4_E,
            "Evaluation D4: Analysis (external validation)",
            "PROBAST+AI model-evaluation domain 4, judged for EXTERNAL "
            "validation (participants not used for development). Leave blank "
            "when the study reports none.",
            _EVAL_D4_CORE + _EVAL_D4_PERFORMANCE,
            ((_F_ROB, "Risk of bias", "Risk of bias introduced by the analysis"),),
        ),
    )


def _judgment_field(eid: UUID, judgment: _Judgment, sort: int) -> ExtractionField:
    """One PROBAST+AI domain judgment (Low / High / Unclear).

    Unlike ``_domain_judgment`` (PROBAST / QUADAS-2), the judgment NAME varies
    by part: the development part judges "Quality", the evaluation part judges
    "Risk of bias". The QA form detects a judgment by its Low/High/Unclear
    answer set rather than by name, so honest names cost nothing.
    """
    name, label, official_text = judgment
    return _qa_field(
        eid,
        name,
        label,
        official_text,
        "select",
        sort,
        allowed=_PROBAST_JUDGMENT,
        llm=(
            f"Domain judgment (not a signaling question): {official_text}. "
            "Aggregate the answers and evidence of this domain's signaling "
            "questions — N/PN signal a relevant concern; a no-information answer "
            "that prevents judging leads to Unclear; a legitimate not-applicable "
            "does not count against the domain; Low when nothing relevant is "
            "signalled. This is a judgment, not a count: a single serious flaw is "
            "enough for High. If the article reports more than one eligible "
            "model, judge the WORST case among them and name that model in your "
            "reasoning. Answer Low, High or Unclear."
        ),
    )


# ---------------------------------------------------------------------------
# Derivation spec — computed overalls (Moons 2025 step 4: worst domain).
# Seeded onto the template's `schema` JSONB and consumed by
# `derived_judgment_service`, the single implementation shared by the run-view
# payload and the xlsx export. `rule` is declared even though `worst_domain` is
# currently the only one, so a future second rule fails loudly.
# ---------------------------------------------------------------------------

_PAI_DERIVED_JUDGMENTS: list[dict[str, Any]] = [
    {
        "id": "dev_overall_quality",
        "label": "Overall quality (development)",
        "rule": "worst_domain",
        "inputs": [
            {"section": _S_DEV_D1, "field": _F_QUALITY},
            {"section": _S_DEV_D2, "field": _F_QUALITY},
            {"section": _S_DEV_D3, "field": _F_QUALITY},
            {"section": _S_DEV_D4, "field": _F_QUALITY},
        ],
    },
    {
        "id": "dev_overall_applicability",
        "label": "Overall applicability (development)",
        "rule": "worst_domain",
        "inputs": [
            {"section": _S_DEV_D1, "field": _F_APPLICABILITY},
            {"section": _S_DEV_D2, "field": _F_APPLICABILITY},
            {"section": _S_DEV_D3, "field": _F_APPLICABILITY},
        ],
    },
    {
        "id": "eval_overall_rob",
        "label": "Overall risk of bias (evaluation)",
        "rule": "worst_domain",
        "inputs": [
            {"section": _S_EVAL_D1, "field": _F_ROB},
            {"section": _S_EVAL_D2, "field": _F_ROB},
            {"section": _S_EVAL_D3, "field": _F_ROB},
            {
                # Domain 4 collapses across the reported performance types
                # before entering the overall: unreported types are ignored.
                "collapse": "worst_of",
                "inputs": [
                    {"section": _S_EVAL_D4_A, "field": _F_ROB},
                    {"section": _S_EVAL_D4_I, "field": _F_ROB},
                    {"section": _S_EVAL_D4_E, "field": _F_ROB},
                ],
            },
        ],
    },
    {
        "id": "eval_overall_applicability",
        "label": "Overall applicability (evaluation)",
        "rule": "worst_domain",
        "inputs": [
            {"section": _S_EVAL_D1, "field": _F_APPLICABILITY},
            {"section": _S_EVAL_D2, "field": _F_APPLICABILITY},
            {"section": _S_EVAL_D3, "field": _F_APPLICABILITY},
        ],
    },
]


async def seed_probast_ai(session: AsyncSession) -> None:
    """Seeds the PROBAST+AI quality-assessment template (10 sections, 58 fields).

    Idempotent by primary key. NOTE: an existing row is left untouched, so a
    corrected `derived_judgments` spec requires `make db-fresh` (or a manual
    UPDATE) — `make db-seed` alone will not install it.
    """
    print("Seeding PROBAST+AI template...")

    template = await session.get(ExtractionTemplateGlobal, _PROBAST_AI_TEMPLATE_ID)
    if template:
        print("  PROBAST+AI already exists — skipping.")
        return

    session.add(
        ExtractionTemplateGlobal(
            id=_PROBAST_AI_TEMPLATE_ID,
            name="PROBAST+AI",
            description=(
                "PROBAST+AI — Prediction model Risk Of Bias ASsessment Tool for "
                "regression- and AI/ML-based prediction models (Moons et al., "
                "BMJ 2025). Model development is judged on Quality; model "
                "evaluation is judged on Risk of Bias. Applicability is judged "
                "on domains 1-3 of each part. Overall judgments are computed "
                "from the domain judgments (worst domain), never entered."
            ),
            framework="CUSTOM",
            version="1.0.0",
            kind=TemplateKind.QUALITY_ASSESSMENT.value,
            schema_={"derived_judgments": _PAI_DERIVED_JUDGMENTS},
        )
    )

    fields: list[ExtractionField] = []
    for order, (eid, name, label, description, questions, judgments) in enumerate(
        _sections(), start=1
    ):
        session.add(
            _entity_type_from_spec(
                _EntitySpec(
                    eid,
                    name,
                    label,
                    description,
                    None,
                    "one",
                    ExtractionEntityRole.STUDY_SECTION,
                    order,
                ),
                template_id=_PROBAST_AI_TEMPLATE_ID,
            )
        )
        for sort, (q_name, q_text, criterion) in enumerate(questions):
            fields.append(
                _signaling(
                    eid,
                    q_name,
                    q_text,
                    sort,
                    _PROBAST_SIGNALING,
                    llm=criterion + _ANSWER_INSTRUCTION,
                )
            )
        for offset, judgment in enumerate(judgments):
            fields.append(_judgment_field(eid, judgment, len(questions) + offset))

    for field in fields:
        session.add(field)

    print(f"  Created PROBAST+AI with 10 entity types and {len(fields)} fields.")
```

- [ ] **Step 5: Register in `main()`**

In `backend/app/seed.py`, add the import next to the other app imports and one
call in `main()`:

```python
from app.seed_probast_ai import seed_probast_ai
```
```python
            await seed_charms(session)
            await seed_probast(session)
            await seed_quadas2(session)
            await seed_probast_ai(session)
```

- [ ] **Step 6: Run test to verify it passes**

```bash
cd backend && uv run pytest tests/unit/test_seed_probast_ai.py -v
```

Expected: PASS (11 passed). If a count assertion fails, the seed is wrong —
fix the seed, not the test; the counts come from the instrument
(34 questions → 42 rows because eval-D4 q2/q3/q4/q7 are triplicated;
14 domain judgments → 16 rows because eval-D4's is triplicated).

- [ ] **Step 7: Extend the ADR-0016 disposition sweep**

In `backend/tests/unit/test_seed_dispositions.py`: add `_PROBAST_JUDGMENT` to
the `from app.seed import (...)` list, add
`from app.seed_probast_ai import seed_probast_ai`, and change line 80:

```python
@pytest.mark.parametrize(
    "seed_fn", [seed_charms, seed_probast, seed_quadas2, seed_probast_ai]
)
```

Then append:

```python
@pytest.mark.asyncio
async def test_probast_ai_signaling_fields_allow_not_applicable() -> None:
    """PROBAST+AI signaling questions offer NA in the instrument, so every one
    opts into the not_applicable disposition; judgments do not."""
    fields = await _seeded_fields(seed_probast_ai)
    signaling = [f for f in fields if f.allowed_values == _PROBAST_SIGNALING]
    assert len(signaling) == 42
    assert all(f.allows_not_applicable for f in signaling)
    judgments = [f for f in fields if f.allowed_values == _PROBAST_JUDGMENT]
    assert judgments
    assert not any(f.allows_not_applicable or f.allows_not_evaluated for f in judgments)
```

- [ ] **Step 8: Unblock the kind-discriminator test**

`backend/tests/integration/test_kind_discriminator.py:97-104` asserts that no
global template outside `('PROBAST', 'QUADAS-2')` has a non-extraction kind —
seeding PROBAST+AI makes that count 1. Extend the list and its comment:

```python
            WHERE kind <> 'extraction'
              AND name NOT IN ('PROBAST', 'QUADAS-2', 'PROBAST+AI')
```

- [ ] **Step 9: Run both suites + the mypy ratchet**

```bash
cd backend && uv run pytest tests/unit/test_seed_dispositions.py -v
cd backend && { uv run mypy app --ignore-missing-imports || true; } | uv run python ../scripts/mypy_baseline.py --baseline .mypy_baseline
```

Expected: pytest PASS; mypy ratchet reports **no new codes**. A
`TypeError: unhashable type: 'dict'` in pytest means a seeded `allowed_values`
used option dicts — convert to a flat `list[str]`. A `no-untyped-def` from
mypy means a helper is missing its return annotation.

- [ ] **Step 10: Bump the file-size baseline (seed.py grew by 2 lines)**

```bash
python3 scripts/fitness/check_file_size.py --update-baseline
python3 scripts/fitness/check_file_size.py    # must exit 0 now
```

Expected: exit 0. `seed_probast_ai.py` is a new file under 800 lines, so it
gets no baseline entry — if it exceeds 800, split the question tables into
`backend/app/seed_probast_ai_questions.py` rather than bumping the ceiling.

- [ ] **Step 11: Commit**

```bash
git add backend/app/seed_probast_ai.py backend/app/seed.py backend/tests/unit/test_seed_probast_ai.py backend/tests/unit/test_seed_dispositions.py backend/tests/integration/test_kind_discriminator.py scripts/fitness/check_file_size.baseline
git commit -m "feat(seed): add PROBAST+AI canonical quality-assessment template"
```

---

## Task 4: Data-driven judgment-field detection

**This must ship in PR1.** The QA form partitions fields with a hardcoded
four-name allowlist that does not contain `quality_concern`, so without this
task PROBAST+AI's four development judgments render as ordinary signaling rows
— PR1 would ship visibly wrong.

**Files:**
- Create: `frontend/lib/extraction/judgmentFields.ts`
- Modify: `frontend/components/assessment/QASectionAccordion.tsx:91-96,117-118,272-274`
- Modify: `frontend/lib/copy/qa.ts`
- Test: `frontend/test/lib/judgmentFields.test.ts` (create)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `isJudgmentField(field: { field_type: string; allowed_values?: unknown }): boolean`
  and `JUDGMENT_LABELS: ReadonlySet<string>`.

- [ ] **Step 1: Write the failing test**

The vocabulary must match the backend's `_RISK_LABELS` — the seven casefolded
members of `_SEVERITY_RANK`
(`backend/app/services/exports/extraction/appraisal_summary.py:23-39`), not
just three — or the screen and the workbook disagree the first time a
ROB-2/ROBINS-I template is seeded.

Create `frontend/test/lib/judgmentFields.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { isJudgmentField } from "@/lib/extraction/judgmentFields";

describe("isJudgmentField", () => {
  it("detects a Low/High/Unclear select", () => {
    expect(
      isJudgmentField({ field_type: "select", allowed_values: ["Low", "High", "Unclear"] }),
    ).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(isJudgmentField({ field_type: "select", allowed_values: ["low", "HIGH"] })).toBe(true);
  });

  it("accepts the wider ROB-2 / ROBINS-I vocabulary (parity with the export)", () => {
    expect(
      isJudgmentField({
        field_type: "select",
        allowed_values: ["Low", "Some concerns", "Serious", "Critical"],
      }),
    ).toBe(true);
  });

  it("rejects PROBAST signaling answers", () => {
    expect(
      isJudgmentField({ field_type: "select", allowed_values: ["Y", "PY", "PN", "N"] }),
    ).toBe(false);
  });

  it("rejects QUADAS-2 signaling answers", () => {
    expect(
      isJudgmentField({ field_type: "select", allowed_values: ["Y", "N", "Unclear"] }),
    ).toBe(false);
  });

  it("rejects non-select fields", () => {
    expect(isJudgmentField({ field_type: "text", allowed_values: ["Low"] })).toBe(false);
  });

  it("rejects empty or missing allowed_values", () => {
    expect(isJudgmentField({ field_type: "select", allowed_values: [] })).toBe(false);
    expect(isJudgmentField({ field_type: "select" })).toBe(false);
  });

  it("tolerates the {options:[...]} envelope shape", () => {
    expect(
      isJudgmentField({
        field_type: "select",
        allowed_values: { options: ["Low", "High", "Unclear"] },
      }),
    ).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm run test:run -- frontend/test/lib/judgmentFields.test.ts
```

Expected: FAIL — cannot resolve `@/lib/extraction/judgmentFields`.

- [ ] **Step 3: Write minimal implementation**

Create `frontend/lib/extraction/judgmentFields.ts`:

```ts
/**
 * "Is this field a domain judgment?" — data-driven, not a name allowlist.
 *
 * The QA form used to key off four hardcoded field names
 * (`risk_of_bias`, `applicability_concerns`, `overall_*`). PROBAST+AI's
 * development part judges *Quality*, not risk of bias, so the name allowlist
 * silently demoted its judgments to ordinary signaling rows.
 *
 * The discriminant is the answer set, and the vocabulary is a hand-mirror of
 * the backend's `_SEVERITY_RANK`
 * (backend/app/services/exports/extraction/appraisal_summary.py) — the same
 * rule `extraction_export_service._is_verdict` applies — so the screen and the
 * workbook agree by construction rather than by convention.
 */

/** Casefolded risk-label vocabulary; mirrors the backend `_RISK_LABELS`. */
export const JUDGMENT_LABELS: ReadonlySet<string> = new Set([
  "critical",
  "serious",
  "high",
  "some concerns",
  "moderate",
  "unclear",
  "low",
]);

interface JudgmentCandidate {
  field_type: string;
  allowed_values?: unknown;
}

function optionLabels(allowedValues: unknown): string[] {
  const raw = Array.isArray(allowedValues)
    ? allowedValues
    : allowedValues && typeof allowedValues === "object" && "options" in allowedValues
      ? (allowedValues as { options?: unknown }).options
      : undefined;
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) =>
      typeof item === "string"
        ? item
        : item && typeof item === "object" && "value" in item
          ? String((item as { value?: unknown }).value ?? "")
          : "",
    )
    .map((label) => label.trim().toLowerCase())
    .filter((label) => label.length > 0);
}

export function isJudgmentField(field: JudgmentCandidate): boolean {
  if (field.field_type !== "select") return false;
  const labels = optionLabels(field.allowed_values);
  return labels.length > 0 && labels.every((label) => JUDGMENT_LABELS.has(label));
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npm run test:run -- frontend/test/lib/judgmentFields.test.ts
```

Expected: PASS (8 passed).

- [ ] **Step 5: Use it in the accordion**

In `frontend/components/assessment/QASectionAccordion.tsx`: delete the
`SUMMARY_FIELD_NAMES` constant (lines 91-96) and replace the partition at
lines 117-118:

```tsx
  const signaling = fields.filter((f) => !isJudgmentField(f));
  const summary = fields.filter((f) => isJudgmentField(f));
```

Add `import { isJudgmentField } from "@/lib/extraction/judgmentFields";` and
update the file header comment (lines 9-12) to describe the new rule. Move the
literal card title at line 273 into copy: add
`domainJudgmentCardTitle: 'Domain judgment',` to `frontend/lib/copy/qa.ts` and
render `{qa.domainJudgmentCardTitle}` (import `qa` from `@/lib/copy/qa`).

- [ ] **Step 6: Run the QA suites and typecheck**

```bash
npm run test:run -- frontend/test/QualityAssessmentFullScreen.test.tsx frontend/test/QualityAssessmentInterface.test.tsx
npx tsc -p tsconfig.app.json --noEmit
```

Expected: both PASS. Classic PROBAST/QUADAS-2 judgment fields all use
`Low/High/Unclear`, so their rendering is unchanged. (vitest passing is not a
typecheck — the CI gate is the `tsc` command.)

- [ ] **Step 7: Commit**

```bash
git add frontend/lib/extraction/judgmentFields.ts frontend/components/assessment/QASectionAccordion.tsx frontend/lib/copy/qa.ts frontend/test/lib/judgmentFields.test.ts
git commit -m "refactor(qa): detect judgment fields by answer set, not by name"
```

---

## Task 5: Prove the seed against a real database + document it

**Files:**
- Modify: `backend/tests/integration/test_qa_seed.py`
- Modify: `docs/how-to/seed-database.md`
- Modify: `frontend/lib/copy/qa.ts`

**Interfaces:**
- Consumes: `seed_probast_ai` (Task 3).
- Produces: nothing consumed later.

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/integration/test_qa_seed.py`:

```python
@pytest.mark.asyncio
async def test_probast_ai_template_exists(db_session: AsyncSession) -> None:
    row = (
        await db_session.execute(
            text(
                """
                SELECT kind, framework, schema FROM public.extraction_templates_global
                WHERE name = 'PROBAST+AI'
                """
            )
        )
    ).first()
    assert row is not None, "PROBAST+AI template should exist after seed"
    assert row[0] == "quality_assessment"
    assert row[1] == "CUSTOM"
    assert len(row[2]["derived_judgments"]) == 4


@pytest.mark.asyncio
async def test_probast_ai_has_ten_flat_sections(db_session: AsyncSession) -> None:
    rows = (
        await db_session.execute(
            text(
                """
                SELECT et.role, et.cardinality, et.parent_entity_type_id
                FROM public.extraction_entity_types et
                JOIN public.extraction_templates_global t ON t.id = et.template_id
                WHERE t.name = 'PROBAST+AI'
                """
            )
        )
    ).all()
    assert len(rows) == 10
    assert all(r[0] == "study_section" and r[1] == "one" and r[2] is None for r in rows)


@pytest.mark.asyncio
async def test_probast_ai_has_58_fields(db_session: AsyncSession) -> None:
    count = (
        await db_session.execute(
            text(
                """
                SELECT COUNT(*) FROM public.extraction_fields f
                JOIN public.extraction_entity_types et ON et.id = f.entity_type_id
                JOIN public.extraction_templates_global t ON t.id = et.template_id
                WHERE t.name = 'PROBAST+AI'
                """
            )
        )
    ).scalar()
    assert count == 58
```

Also extend `test_seed_is_idempotent` (line 117) to import
`from app.seed_probast_ai import seed_probast_ai` and call it alongside the
other two.

- [ ] **Step 2: Reseed and run**

```bash
make db-fresh
cd backend && uv run pytest tests/integration/test_qa_seed.py tests/integration/test_kind_discriminator.py -v
```

Expected: PASS. Use `make db-fresh` (migrate + seed), never `make reset-db`
alone — and note that `make db-seed` on an existing DB will **not** update an
already-present PROBAST+AI row.

- [ ] **Step 3: Document the new template**

In `docs/how-to/seed-database.md`: add PROBAST+AI to the "What gets seeded"
list (10 entity types, 58 fields, `kind=quality_assessment`) matching the
existing rows' format, update any total counts, and add one line to the
re-seeding section stating that the seed is idempotent **by primary key** — an
existing template row is never updated, so a corrected definition needs
`make db-fresh`.

- [ ] **Step 4: Update the three copy strings that enumerate the tools**

In `frontend/lib/copy/qa.ts` — all three, including `activeTemplateNone` at
line 71 which is easy to miss:

```ts
  noTemplatesDesc:
    'Run `make db-seed` (or `python -m app.seed`) to install PROBAST, PROBAST+AI and QUADAS-2.',
  configEmptyGlobals:
    'No quality-assessment templates available. Seed PROBAST, PROBAST+AI and QUADAS-2 first.',
  activeTemplateNone:
    'No tool enabled — open Configuration to enable PROBAST, PROBAST+AI or QUADAS-2.',
```

- [ ] **Step 5: Run the frontend suites**

```bash
npm run test:run -- frontend/test/components/QualityAssessmentConfiguration.test.tsx frontend/test/QualityAssessmentInterface.test.tsx
```

Expected: PASS. If a test asserts an old string verbatim, update the assertion.

- [ ] **Step 6: Commit**

```bash
git add backend/tests/integration/test_qa_seed.py docs/how-to/seed-database.md frontend/lib/copy/qa.ts
git commit -m "test(seed): cover PROBAST+AI against a seeded database"
```

**PR1 ends here.** Full gate before opening it:

```bash
make quality-scan
```

> **Delivery note (do not skip):** the deploy start command is
> `alembic upgrade head && gunicorn …` — **the seed does not run on deploy**.
> After PR1 reaches an environment, the template must be installed explicitly
> there: `cd backend && DATABASE_URL=<target> uv run python -m app.seed`,
> then verify with the SELECT from `docs/how-to/seed-database.md`.

---

# PR2

## Task 6: The worst-domain rule module

**Files:**
- Create: `backend/app/services/derived_judgment_service.py`
- Test: `backend/tests/unit/test_derived_judgment_service.py` (create)

**Interfaces:**
- Consumes: `app.services.value_semantics.unwrap_value_envelope`,
  `value_absent_reason`.
- Produces (relied on by Tasks 7 and 8):
  ```python
  JUDGMENT_SEVERITY: dict[str, int]           # {"Low": 0, "Unclear": 1, "High": 2}

  @dataclass(frozen=True)
  class DerivedJudgment:
      id: str
      label: str
      value: str | None

  def worst_of(values: Iterable[Any]) -> str | None
  def worst_domain(values: Iterable[Any]) -> str | None
  def derived_spec(template_schema: Any) -> list[dict[str, Any]]
  def compute_derived_judgments(
      spec: Any,
      values_by_coord: Mapping[tuple[str, str], Any],
  ) -> list[DerivedJudgment]
  ```
  `values_by_coord` maps `(section_name, field_name)` to the **raw stored
  value** (envelope or scalar); callers do not pre-unwrap.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/unit/test_derived_judgment_service.py`:

```python
"""The single worst-domain implementation (PROBAST+AI step 4).

Two deliberately different aggregations:
  * worst_of   (collapse across performance types) — LENIENT: ignores
    unjudged members; null only when nothing is judged.
  * worst_domain (across domains) — STRICT: any unjudged domain yields None.
    One does not conclude low risk from an incomplete assessment.
"""

from __future__ import annotations

from typing import Any

import pytest

from app.services.derived_judgment_service import (
    DerivedJudgment,
    compute_derived_judgments,
    derived_spec,
    worst_domain,
    worst_of,
)

_SPEC: list[dict[str, Any]] = [
    {
        "id": "eval_overall_rob",
        "label": "Overall risk of bias (evaluation)",
        "rule": "worst_domain",
        "inputs": [
            {"section": "eval_d1", "field": "risk_of_bias"},
            {
                "collapse": "worst_of",
                "inputs": [
                    {"section": "eval_d4_a", "field": "risk_of_bias"},
                    {"section": "eval_d4_i", "field": "risk_of_bias"},
                    {"section": "eval_d4_e", "field": "risk_of_bias"},
                ],
            },
        ],
    }
]


@pytest.mark.parametrize(
    ("values", "expected"),
    [
        (["Low", "Low"], "Low"),
        (["Low", "Unclear"], "Unclear"),
        (["Unclear", "High"], "High"),
        (["High", "Low"], "High"),
    ],
)
def test_worst_domain_severity_order(values: list[Any], expected: str) -> None:
    assert worst_domain(values) == expected


@pytest.mark.parametrize("missing", [None, "", "  ", {"value": None}, "Bogus"])
def test_worst_domain_is_strict_about_incompleteness(missing: Any) -> None:
    assert worst_domain(["Low", missing]) is None


def test_worst_domain_of_nothing_is_none() -> None:
    assert worst_domain([]) is None


def test_worst_domain_excludes_absent_reason_markers() -> None:
    marker = {"value": None, "absent_reason": "no_information"}
    assert worst_domain(["Low", marker]) is None


def test_worst_of_is_lenient() -> None:
    """Unreported performance types are ignored, not counted as incomplete."""
    assert worst_of(["Low", None, ""]) == "Low"
    assert worst_of([None, "High", None]) == "High"
    assert worst_of([None, None, None]) is None


def test_worst_of_unwraps_envelopes_and_is_case_insensitive() -> None:
    assert worst_of([{"value": "high"}, {"value": "Low"}]) == "High"


def test_compute_collapses_d4_then_aggregates() -> None:
    values: dict[tuple[str, str], Any] = {
        ("eval_d1", "risk_of_bias"): "Low",
        ("eval_d4_i", "risk_of_bias"): {"value": "High"},
        # apparent + external not reported -> ignored by the collapse
    }
    assert compute_derived_judgments(_SPEC, values) == [
        DerivedJudgment(
            id="eval_overall_rob",
            label="Overall risk of bias (evaluation)",
            value="High",
        )
    ]


def test_compute_returns_none_when_a_domain_is_unjudged() -> None:
    assert compute_derived_judgments(_SPEC, {("eval_d4_i", "risk_of_bias"): "Low"})[0].value is None


def test_compute_returns_none_when_no_performance_type_reported() -> None:
    assert compute_derived_judgments(_SPEC, {("eval_d1", "risk_of_bias"): "Low"})[0].value is None


def test_derived_spec_reads_template_schema() -> None:
    assert derived_spec({"derived_judgments": _SPEC}) == _SPEC
    assert derived_spec({}) == []
    assert derived_spec(None) == []
    assert derived_spec({"derived_judgments": "nonsense"}) == []


def test_malformed_spec_entries_are_skipped_not_crashed() -> None:
    """Defensive branches: non-dict entries, missing inputs, bad collapse."""
    malformed: list[Any] = [
        "not-a-dict",
        {"id": "no_inputs", "label": "X"},
        {"id": "bad_collapse", "label": "Y", "inputs": [{"collapse": "worst_of"}]},
    ]
    out = compute_derived_judgments(malformed, {})
    assert [d.id for d in out] == ["bad_collapse"]
    assert out[0].value is None


def test_compute_on_empty_spec_is_empty() -> None:
    assert compute_derived_judgments([], {}) == []
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd backend && uv run pytest tests/unit/test_derived_judgment_service.py -v
```

Expected: FAIL — `ModuleNotFoundError`.

- [ ] **Step 3: Write minimal implementation**

Create `backend/app/services/derived_judgment_service.py`. The two
`list`-narrowing details below are required for the mypy ratchet — `any(j is
None ...)` does not narrow the element type, and `dict.get` needs `str` keys:

```python
"""Computed overall judgments for quality-assessment templates.

PROBAST+AI (Moons et al., BMJ 2025) step 4 defines four *overall* judgments as
a deterministic function of the domain judgments — they are never entered by a
reviewer, so an overall can never contradict its own domains. `extraction_fields`
has no computed-field concept, so the overalls are not stored at all: this
module is THE implementation, and both the run-view payload and the xlsx export
call it. Do not re-implement the rule anywhere else.

The derivation is configured as data on the template's `schema` JSONB
(`derived_judgments`), so a future checklist with different roll-ups needs no
code change here. NOTE: `schema` is NOT part of the frozen version snapshot
(`extraction_snapshot.SNAPSHOT_SQL` freezes entity_types only), so the rule is
read live while its coordinates come from the snapshot. Renaming a seeded
section or judgment field without updating the spec silently nulls every
overall — callers should log a dangling reference rather than fail closed.

Two aggregations, deliberately different:

* ``worst_of`` — collapse across the evaluation-D4 performance types
  (apparent / internal / external). LENIENT: an unreported type is ignored,
  because "the study did not do external validation" is not a gap in the
  assessment. Null only when no type was judged at all.
* ``worst_domain`` — aggregate across domains. STRICT: if any domain is
  unjudged, the overall is None ("incomplete"), never Low. One does not
  conclude low risk of bias from an assessment that is not finished.
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from typing import Any

from app.services.value_semantics import unwrap_value_envelope, value_absent_reason

# Severity order for the Low / High / Unclear judgment vocabulary. Higher is
# worse; `max` over this mapping is the "worst" operator.
JUDGMENT_SEVERITY: dict[str, int] = {"Low": 0, "Unclear": 1, "High": 2}

_COLLAPSE_KEY = "collapse"

# `worst_domain` is currently the only rule. A spec declaring anything else is
# a definition the code cannot honour, so it resolves to None rather than being
# silently treated as worst-domain.
_SUPPORTED_RULE = "worst_domain"


@dataclass(frozen=True)
class DerivedJudgment:
    """One computed overall. ``value`` is None when the inputs are incomplete."""

    id: str
    label: str
    value: str | None


def _judgment(raw: Any) -> str | None:
    """The canonical judgment carried by *raw*, or None when it is not one.

    A coded disposition marker ("no information" / "not applicable") is NOT a
    judgment: it is excluded here and therefore counts as unjudged upstream.
    """
    if value_absent_reason(raw) is not None:
        return None
    value = unwrap_value_envelope(raw)
    if not isinstance(value, str):
        return None
    text = value.strip()
    for known in JUDGMENT_SEVERITY:
        if text.casefold() == known.casefold():
            return known
    return None


def worst_of(values: Iterable[Any]) -> str | None:
    """Worst judgment among *values*, IGNORING unjudged entries (lenient)."""
    ranked = [j for j in (_judgment(v) for v in values) if j is not None]
    if not ranked:
        return None
    return max(ranked, key=JUDGMENT_SEVERITY.__getitem__)


def worst_domain(values: Iterable[Any]) -> str | None:
    """Worst judgment among *values*, None if ANY entry is unjudged (strict)."""
    judgments = [_judgment(v) for v in values]
    if not judgments or any(j is None for j in judgments):
        return None
    ranked = [j for j in judgments if j is not None]
    return max(ranked, key=JUDGMENT_SEVERITY.__getitem__)


def derived_spec(template_schema: Any) -> list[dict[str, Any]]:
    """The `derived_judgments` list on a template's `schema` JSONB, or []."""
    if not isinstance(template_schema, dict):
        return []
    spec = template_schema.get("derived_judgments")
    if not isinstance(spec, list):
        return []
    return [item for item in spec if isinstance(item, dict)]


def spec_coordinates(spec: Iterable[Any]) -> list[tuple[str, str]]:
    """Every (section, field) coordinate a spec references, collapses included.

    Callers use this to warn about references that resolve to nothing.
    """
    found: list[tuple[str, str]] = []

    def _walk(items: Any) -> None:
        if not isinstance(items, list):
            return
        for item in items:
            if not isinstance(item, dict):
                continue
            if _COLLAPSE_KEY in item:
                _walk(item.get("inputs"))
            else:
                found.append((str(item.get("section", "")), str(item.get("field", ""))))

    for derived in spec if isinstance(spec, list) else []:
        if isinstance(derived, dict):
            _walk(derived.get("inputs"))
    return found


def _resolve_input(
    item: Mapping[str, Any],
    values_by_coord: Mapping[tuple[str, str], Any],
) -> Any:
    """One overall input: either a coordinate, or a nested collapse group."""
    if _COLLAPSE_KEY in item:
        nested = item.get("inputs")
        if not isinstance(nested, list):
            return None
        return worst_of(
            _resolve_input(sub, values_by_coord) for sub in nested if isinstance(sub, dict)
        )
    return values_by_coord.get((str(item.get("section", "")), str(item.get("field", ""))))


def compute_derived_judgments(
    spec: Any,
    values_by_coord: Mapping[tuple[str, str], Any],
) -> list[DerivedJudgment]:
    """Compute every overall in *spec* from the stored domain judgments.

    ``values_by_coord`` maps ``(section_name, field_name)`` to the RAW stored
    value (envelope or scalar); unwrapping happens here so every caller feeds
    the same shape.
    """
    results: list[DerivedJudgment] = []
    for derived in spec if isinstance(spec, list) else []:
        if not isinstance(derived, dict):
            continue
        inputs = derived.get("inputs")
        if not isinstance(inputs, list):
            continue
        rule = str(derived.get("rule", _SUPPORTED_RULE))
        resolved = [
            _resolve_input(item, values_by_coord) for item in inputs if isinstance(item, dict)
        ]
        results.append(
            DerivedJudgment(
                id=str(derived.get("id", "")),
                label=str(derived.get("label", "")),
                value=worst_domain(resolved) if rule == _SUPPORTED_RULE else None,
            )
        )
    return results
```

- [ ] **Step 4: Run test + the mypy ratchet**

```bash
cd backend && uv run pytest tests/unit/test_derived_judgment_service.py -v
cd backend && { uv run mypy app --ignore-missing-imports || true; } | uv run python ../scripts/mypy_baseline.py --baseline .mypy_baseline
```

Expected: pytest PASS; mypy ratchet reports no new codes. If `arg-type` appears
on a `max(...)` or a `.get(...)`, the narrowing above was not applied.

- [ ] **Step 5: Cross-check the seeded spec end-to-end**

```bash
cd backend && uv run python -c "
import asyncio
from app.models.extraction import ExtractionTemplateGlobal
from app.seed_probast_ai import seed_probast_ai
from app.services.derived_judgment_service import compute_derived_judgments, derived_spec

class S:
    def __init__(self): self.added=[]
    async def get(self,*a,**k): return None
    def add(self,o): self.added.append(o)

s=S(); asyncio.run(seed_probast_ai(s))
tpl=[o for o in s.added if isinstance(o,ExtractionTemplateGlobal)][0]
spec=derived_spec(tpl.schema_)
print('overalls:', [d['id'] for d in spec])
print([(d.id,d.value) for d in compute_derived_judgments(spec, {
  ('dev_d1_participants','quality_concern'):'Low',
  ('dev_d2_predictors','quality_concern'):'Low',
  ('dev_d3_outcome','quality_concern'):'High',
  ('dev_d4_analysis','quality_concern'):'Low',
})])
"
```

Expected: `dev_overall_quality` is `High`; the other three are `None`. If
`dev_overall_quality` is `None`, a coordinate in the seeded spec does not match
a seeded field — fix the seed constant, then `make db-fresh` (a re-seed alone
will not update an existing row).

- [ ] **Step 6: Commit**

```bash
git add backend/app/services/derived_judgment_service.py backend/tests/unit/test_derived_judgment_service.py
git commit -m "feat(qa): add the single worst-domain derivation module"
```

---

## Task 7: Expose the computed overalls on the run-view payload

The value set matters: `resolve_caller_current_values` is caller-scoped in
**every** stage (Layer 1 filters `source_user_id == caller_id`, Layer 2 filters
`ExtractionReviewerState.reviewer_id == caller_id`), so using it alone would
show an arbitrator the *reviewer's* overalls on a finalized run, and show a
manager who never filled the form four dashes. The canonical rows are already
loaded and already returned to every caller by
`get_run_with_workflow_history` — no extra query, no new blind surface.

**Files:**
- Modify: `backend/app/schemas/extraction_run.py`
- Modify: `backend/app/services/extraction_run_read_service.py`
- Test: `backend/tests/unit/test_run_view_derived_judgments.py` (create)

**Interfaces:**
- Consumes: `compute_derived_judgments`, `derived_spec`, `spec_coordinates`
  (Task 6).
- Produces: `RunViewResponse.derived_judgments: list[RunViewDerivedJudgment]`
  (`id: str`, `label: str`, `value: str | None`); empty for templates without a
  spec. Consumed by Task 9's banner.

- [ ] **Step 1: Write the failing test**

Direct-call unit tests **on purpose**: endpoint lines exercised only through
httpx ASGITransport do not register with diff-cover.

Create `backend/tests/unit/test_run_view_derived_judgments.py`:

```python
"""Run-view exposes computed overalls for templates that declare a spec."""

from __future__ import annotations

from typing import Any
from uuid import uuid4

from app.schemas.extraction_run import RunViewDerivedJudgment
from app.services.extraction_run_read_service import build_derived_judgments_payload

_SPEC: dict[str, Any] = {
    "derived_judgments": [
        {
            "id": "dev_overall_quality",
            "label": "Overall quality (development)",
            "rule": "worst_domain",
            "inputs": [{"section": "dev_d1_participants", "field": "quality_concern"}],
        }
    ]
}


class _Field:
    def __init__(self, fid: Any, name: str) -> None:
        self.id = fid
        self.name = name


class _EntityType:
    def __init__(self, name: str, fields: list[_Field]) -> None:
        self.id = uuid4()
        self.name = name
        self.fields = fields


class _Instance:
    def __init__(self, entity_type_id: Any, iid: Any) -> None:
        self.entity_type_id = entity_type_id
        self.id = iid


class _Value:
    def __init__(self, iid: Any, fid: Any, value: Any) -> None:
        self.instance_id = iid
        self.field_id = fid
        self.value = value


def test_returns_empty_without_a_spec() -> None:
    assert (
        build_derived_judgments_payload(
            template_schema={}, entity_types=[], instances=[], values=[]
        )
        == []
    )


def test_maps_names_to_coordinates_and_computes() -> None:
    fid, iid = uuid4(), uuid4()
    et = _EntityType("dev_d1_participants", [_Field(fid, "quality_concern")])
    out = build_derived_judgments_payload(
        template_schema=_SPEC,
        entity_types=[et],
        instances=[_Instance(et.id, iid)],
        values=[_Value(iid, fid, {"value": "High"})],
    )
    assert out == [
        RunViewDerivedJudgment(
            id="dev_overall_quality",
            label="Overall quality (development)",
            value="High",
        )
    ]


def test_unjudged_domain_yields_null_not_low() -> None:
    et = _EntityType("dev_d1_participants", [_Field(uuid4(), "quality_concern")])
    out = build_derived_judgments_payload(
        template_schema=_SPEC, entity_types=[et], instances=[], values=[]
    )
    assert out[0].value is None


def test_first_instance_wins_for_a_repeated_entity_type() -> None:
    """Mirrors the export's `instance_ids[0]` rule."""
    fid, first, second = uuid4(), uuid4(), uuid4()
    et = _EntityType("dev_d1_participants", [_Field(fid, "quality_concern")])
    out = build_derived_judgments_payload(
        template_schema=_SPEC,
        entity_types=[et],
        instances=[_Instance(et.id, first), _Instance(et.id, second)],
        values=[_Value(first, fid, "Low"), _Value(second, fid, "High")],
    )
    assert out[0].value == "Low"


def test_schema_model_accepts_null_value() -> None:
    assert RunViewDerivedJudgment(id="x", label="X", value=None).value is None
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd backend && uv run pytest tests/unit/test_run_view_derived_judgments.py -v
```

Expected: FAIL — `ImportError: cannot import name 'RunViewDerivedJudgment'`.

- [ ] **Step 3: Add the schema model**

In `backend/app/schemas/extraction_run.py`, after `RunViewInstance`:

```python
class RunViewDerivedJudgment(BaseModel):
    """One computed overall judgment (never stored, never entered).

    Present only for templates whose `schema` JSONB declares a
    `derived_judgments` spec (today: PROBAST+AI). ``value`` is None when the
    inputs are incomplete — the client renders "—", never Low.
    """

    id: str
    label: str
    value: str | None = None
```

On `RunViewResponse`, matching the `reviewers_ready` style at line 279:

```python
    # Computed overalls (worst-domain). Empty for templates with no spec.
    derived_judgments: list[RunViewDerivedJudgment] = Field(default_factory=list)
```

- [ ] **Step 4: Add the payload builder**

In `backend/app/services/extraction_run_read_service.py`, module level
(services may import `app.models` and `app.schemas` — verified against
`scripts/fitness/check_layered_arch.py`):

```python
def build_derived_judgments_payload(
    *,
    template_schema: Any,
    entity_types: Sequence[Any],
    instances: Sequence[Any],
    values: Sequence[Any],
) -> list[RunViewDerivedJudgment]:
    """Compute the template's overall judgments from *values*.

    Resolves the spec's (section_name, field_name) coordinates against the
    frozen entity_types tree + this run's instances, then delegates the RULE to
    `derived_judgment_service` — the single implementation shared with the
    export. The caller chooses *values*: the canonical set once peers are
    revealed, the caller's own while blind (see `build_run_view`).
    """
    spec = derived_spec(template_schema)
    if not spec:
        return []

    instance_by_entity_type: dict[Any, Any] = {}
    for inst in instances:
        # First instance wins, mirroring the export's `instance_ids[0]`.
        instance_by_entity_type.setdefault(inst.entity_type_id, inst.id)
    value_by_ids = {(v.instance_id, v.field_id): v.value for v in values}

    values_by_coord: dict[tuple[str, str], Any] = {}
    for et in entity_types:
        instance_id = instance_by_entity_type.get(et.id)
        if instance_id is None:
            continue
        for field in et.fields:
            raw = value_by_ids.get((instance_id, field.id))
            if raw is not None:
                values_by_coord[(et.name, field.name)] = raw

    # A coordinate the template no longer has is a definition bug that would
    # otherwise null an overall in silence (the spec is read live; the
    # coordinates come from the frozen snapshot).
    dangling = [c for c in spec_coordinates(spec) if c not in values_by_coord]
    known = {(et.name, f.name) for et in entity_types for f in et.fields}
    unresolvable = [c for c in dangling if c not in known]
    if unresolvable:
        logger.warning("qa_derived_spec_dangling_ref", coordinates=unresolvable)

    return [
        RunViewDerivedJudgment(id=d.id, label=d.label, value=d.value)
        for d in compute_derived_judgments(spec, values_by_coord)
    ]
```

Add imports (`Sequence` from `collections.abc`, `Any` from `typing`,
`ProjectExtractionTemplate` from `app.models.extraction`,
`RunViewDerivedJudgment` from `app.schemas.extraction_run`, and the three
functions from `app.services.derived_judgment_service`) only where absent, and
reuse the module's existing structlog logger — if the module has none, use
`structlog.get_logger(__name__)` matching the neighbouring services.

- [ ] **Step 5: Wire it into `build_run_view` with the right value set**

After `instances = await _instances_for_run(db, detail.run)`:

```python
    derived_judgments: list[RunViewDerivedJudgment] = []
    if detail.run.kind == TemplateKind.QUALITY_ASSESSMENT.value:
        template = await db.get(ProjectExtractionTemplate, detail.run.template_id)
        # Canonical once peers are revealed (consensus / finalized): the
        # published state, else the consensus decision. Both are already in
        # `detail` and already returned to every caller, so this adds no query
        # and no new blind surface. While blind, the caller's own values are
        # the only correct source.
        canonical: list[Any] = []
        if detail.peers_revealed:
            canonical = list(detail.published_states) or list(detail.consensus_decisions)
        derived_judgments = build_derived_judgments_payload(
            template_schema=template.schema_ if template is not None else None,
            entity_types=entity_types,
            instances=instances,
            values=canonical or current_values,
        )
```

Add `derived_judgments=derived_judgments,` to the `RunViewResponse(...)`
construction. `ConsensusDecisionResponse` and `PublishedStateResponse` both
carry `(instance_id, field_id, value)`, so they satisfy the builder's duck-type
without adaptation.

- [ ] **Step 6: Run tests + regressions**

```bash
cd backend && uv run pytest tests/unit/test_run_view_derived_judgments.py -v
cd backend && uv run pytest tests/unit -k "run_view or run_read" -v
cd backend && uv run pytest tests/integration -k "run_view or hitl_session or consensus" -v
```

Expected: all PASS. The new field is defaulted, so existing constructions
still validate.

- [ ] **Step 7: Add a QA-run integration test (diff-cover on the wiring)**

The `build_run_view` QA branch has no existing coverage — every current test
uses extraction runs. Add one test to
`backend/tests/integration/test_run_view_current_values.py` that opens a QA run
against the seeded PROBAST+AI template, writes one domain judgment, calls
`build_run_view`, and asserts `view.derived_judgments` has 4 entries with
`dev_overall_quality is None` (incomplete). Follow the file's existing
run-construction helpers rather than inventing new ones.

- [ ] **Step 8: Regenerate the API contract types**

```bash
npm run generate:api-types
git diff --stat frontend/types/api/
```

Expected: both files change (new `RunViewDerivedJudgment` component). CI's
`api-contract` job fails if this is not committed.

- [ ] **Step 9: Commit**

```bash
git add backend/app/schemas/extraction_run.py backend/app/services/extraction_run_read_service.py backend/tests/unit/test_run_view_derived_judgments.py backend/tests/integration/test_run_view_current_values.py frontend/types/api/
git commit -m "feat(qa): expose computed overall judgments on the run view"
```

---

## Task 8: Export uses the same module

**Files:**
- Modify: `backend/app/services/extraction_export_service.py`
- Modify: `backend/app/services/exports/extraction/appraisal_summary.py`
- Test: `backend/tests/unit/test_appraisal_derived_overalls.py` (create)

**Interfaces:**
- Consumes: `compute_derived_judgments`, `derived_spec` (Task 6).
- Produces: `AppraisalModel.derived_labels: tuple[str, ...]` and
  `AppraisalRow.derived_values: tuple[str | None, ...]`, both defaulting to `()`
  so templates with no spec are byte-for-byte unchanged.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/unit/test_appraisal_derived_overalls.py`:

```python
"""The appraisal sheet's overall columns come from the shared rule module.

Templates WITHOUT a `derived_judgments` spec keep the legacy single
worst-case `Overall` column, byte for byte.
"""

from __future__ import annotations

from typing import Any

from app.services.exports.extraction.appraisal_summary import build_appraisal_summary
from app.services.extraction_export_service import AppraisalModel, AppraisalRow, ExportMode


class _Layout:
    def __init__(self, appraisal: Any, mode: ExportMode = ExportMode.CONSENSUS) -> None:
        self.appraisal = appraisal
        self.mode = mode
        self.reviewers: tuple[Any, ...] = ()


def test_legacy_template_keeps_single_overall_column() -> None:
    model = AppraisalModel(
        domain_section_ids=(),
        domain_labels=("D1", "D2"),
        rows=(
            AppraisalRow(
                article_id=None,
                record_label="Art 1",
                domain_verdicts=("Low", "High"),
                overall="High",
                per_reviewer_overall={},
            ),
        ),
    )
    sheet = build_appraisal_summary(_Layout(model))
    assert sheet is not None
    assert tuple(c.value for c in sheet.rows[0]) == ("Record", "D1", "D2", "Overall")


def test_spec_template_emits_named_overall_columns() -> None:
    model = AppraisalModel(
        domain_section_ids=(),
        domain_labels=("Dev D1",),
        rows=(
            AppraisalRow(
                article_id=None,
                record_label="Art 1",
                domain_verdicts=("Low",),
                overall=None,
                per_reviewer_overall={},
                derived_values=("Low", None),
            ),
        ),
        derived_labels=("Overall quality (development)", "Overall RoB (evaluation)"),
    )
    sheet = build_appraisal_summary(_Layout(model))
    assert sheet is not None
    header = tuple(c.value for c in sheet.rows[0])
    assert header == (
        "Record",
        "Dev D1",
        "Overall quality (development)",
        "Overall RoB (evaluation)",
    )
    assert "Overall" not in header[2:], "legacy worst-case column must not double up"
    assert tuple(c.value for c in sheet.rows[1]) == ("Art 1", "Low", "Low", None)
```

Add a second test module-level function that calls
`ExtractionExportService._build_appraisal_model(...)` **directly** with
`template_schema={...}` and asserts `model.derived_labels` and
`rows[0].derived_values` — without it the whole `if spec:` branch is uncovered
(all six existing direct callers omit `template_schema`). Copy the argument
shape from `backend/tests/unit/test_extraction_appraisal_model_resolution.py:82`.

- [ ] **Step 2: Run test to verify it fails**

```bash
cd backend && uv run pytest tests/unit/test_appraisal_derived_overalls.py -v
```

Expected: FAIL — `TypeError: … unexpected keyword argument 'derived_values'`.

- [ ] **Step 3: Widen the descriptors and models**

In `backend/app/services/extraction_export_service.py`:

1. Add `name: str = ""` as the **LAST** field of `FieldDescriptor` (after
   `allow_other: bool = False`, line 95) and of `SectionDescriptor` (after
   `description: str | None = None`, line 114). Both are
   `@dataclass(frozen=True)`; inserting a defaulted field before a
   non-defaulted one raises `TypeError` at import.
2. In `_load_sections`, pass `name=s.name` / `name=f.name` — the snapshot
   reader already carries both
   (`backend/app/services/exports/extraction_snapshot_reader.py:44,59`).
3. Add `derived_values: tuple[str | None, ...] = ()` as the last field of
   `AppraisalRow`, and `derived_labels: tuple[str, ...] = ()` as the last field
   of `AppraisalModel`.

- [ ] **Step 4: Compute the derived overalls in `_build_appraisal_model`**

Add a keyword argument `template_schema: Any = None` to the `@staticmethod` and
pass `template.schema_` from `resolve_layout` (the `template` local is already
in scope at line 435). Import `compute_derived_judgments` / `derived_spec` at
**module level** — unlike the existing function-local `appraisal_summary`
import at `:606-613`, `derived_judgment_service` imports nothing from this
module, so there is no cycle.

After the existing `domains` list is built:

```python
        spec = derived_spec(template_schema)
        derived_labels = tuple(str(d.get("label", "")) for d in spec)
```

Per article, inside the existing loop:

```python
            derived_values: tuple[str | None, ...] = ()
            if spec:
                values_by_coord: dict[tuple[str, str], Any] = {}
                for section in sections:
                    instance_ids = article.section_instances.get(section.entity_type_id, ())
                    instance_id = instance_ids[0] if instance_ids else None
                    for field in section.fields:
                        key = (
                            (run_id, instance_id, field.field_id, None)
                            if is_all_users
                            else (run_id, instance_id, field.field_id)
                        )
                        raw = value_map.get(key)
                        if raw is not None:
                            values_by_coord[(section.name, field.name)] = raw
                derived_values = tuple(
                    d.value for d in compute_derived_judgments(spec, values_by_coord)
                )
```

Pass `derived_values=derived_values` into `AppraisalRow(...)` and
`derived_labels=derived_labels` into `AppraisalModel(...)`.

- [ ] **Step 5: Render the columns**

In `backend/app/services/exports/extraction/appraisal_summary.py`, replace the
single `Overall` header append:

```python
    # A template that declares a `derived_judgments` spec replaces the legacy
    # single worst-case column with its own named overalls (computed by
    # derived_judgment_service — the same module the run view uses). Templates
    # without a spec keep the legacy column unchanged.
    derived_labels = appraisal.derived_labels
    if derived_labels:
        header_cells.extend(Cell(label, _HEADER_STYLE) for label in derived_labels)
    else:
        header_cells.append(Cell(_OVERALL_COL, _HEADER_STYLE))
```

and mirror it in the row loop:

```python
        if derived_labels:
            cells.extend(Cell(v) for v in row.derived_values)
        else:
            cells.append(Cell(row.overall))
```

Fix the width computation:

```python
    overall_cols = len(derived_labels) if derived_labels else 1
    domain_and_overall = len(domain_labels) + overall_cols + len(reviewer_overall_cols)
```

Note in the docstring that per-reviewer `Overall` columns (ALL_USERS mode) keep
the legacy worst-case rollup — the derived spec is computed for the consensus
value set only, deliberately, in this slice.

- [ ] **Step 6: Run tests + regressions**

```bash
cd backend && uv run pytest tests/unit/test_appraisal_derived_overalls.py -v
cd backend && uv run pytest tests/unit -k "export or appraisal" -v
```

Expected: PASS, including `test_extraction_export_determinism.py` and
`test_extraction_appraisal_model_resolution.py`. A failure there means a legacy
template's output changed — that is a bug in this task, not an expectation to
update.

- [ ] **Step 7: Bump the file-size baseline (this file is AT its cap)**

```bash
python3 scripts/fitness/check_file_size.py --update-baseline
python3 scripts/fitness/check_file_size.py    # must exit 0
```

- [ ] **Step 8: Commit**

```bash
git add backend/app/services/extraction_export_service.py backend/app/services/exports/extraction/appraisal_summary.py backend/tests/unit/test_appraisal_derived_overalls.py scripts/fitness/check_file_size.baseline
git commit -m "feat(export): derive appraisal overalls from the shared rule module"
```

---

## Task 9: Render the computed overalls

**Files:**
- Create: `frontend/components/assessment/OverallJudgmentBanner.tsx`
- Modify: `frontend/hooks/runs/types.ts`, `frontend/pages/QualityAssessmentFullScreen.tsx`, `frontend/lib/copy/qa.ts`
- Test: `frontend/test/components/OverallJudgmentBanner.test.tsx` (create)

**Interfaces:**
- Consumes: `RunViewResponse.derived_judgments` (Task 7) — array of
  `{ id: string; label: string; value: string | null }`.
- Produces: `<OverallJudgmentBanner judgments={...} />`.

- [ ] **Step 1: Write the failing test**

`frontend/components/ui/tooltip.tsx:9` is a bare
`const Tooltip = TooltipPrimitive.Root` with **no** self-provider, so Radix
throws without a `TooltipProvider`. Wrap every render:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { OverallJudgmentBanner } from "@/components/assessment/OverallJudgmentBanner";
import { TooltipProvider } from "@/components/ui/tooltip";

function renderBanner(judgments: Parameters<typeof OverallJudgmentBanner>[0]["judgments"]) {
  return render(
    <TooltipProvider>
      <OverallJudgmentBanner judgments={judgments} />
    </TooltipProvider>,
  );
}

describe("OverallJudgmentBanner", () => {
  it("renders nothing when there are no derived judgments", () => {
    const { container } = renderBanner([]);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders one chip per judgment with its value", () => {
    renderBanner([
      { id: "dev_overall_quality", label: "Overall quality (development)", value: "High" },
      { id: "eval_overall_rob", label: "Overall RoB (evaluation)", value: "Low" },
    ]);
    expect(screen.getByTestId("qa-overall-dev_overall_quality")).toHaveTextContent("High");
    expect(screen.getByTestId("qa-overall-eval_overall_rob")).toHaveTextContent("Low");
  });

  it("renders an em dash for an incomplete judgment, never Low", () => {
    renderBanner([{ id: "x", label: "Overall quality", value: null }]);
    const chip = screen.getByTestId("qa-overall-x");
    expect(chip).toHaveTextContent("—");
    expect(chip).not.toHaveTextContent("Low");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm run test:run -- frontend/test/components/OverallJudgmentBanner.test.tsx
```

Expected: FAIL — cannot resolve the component.

- [ ] **Step 3: Add the copy keys**

In `frontend/lib/copy/qa.ts`, inside the `qa` object:

```ts
  // Computed overall judgments (worst-domain; never entered by a reviewer)
  overallBannerTitle: 'Overall judgments',
  overallBannerHint: 'Computed from the domain judgments (worst domain). Not editable.',
  overallIncomplete: '—',
  overallIncompleteHint: 'Incomplete — at least one domain has not been judged.',
```

- [ ] **Step 4: Write the component**

Before writing, confirm the tone tokens exist:
`grep -nE "success|warning" tailwind.config.ts`. If `success` is absent, use the
nearest defined token — never invent a color.

Create `frontend/components/assessment/OverallJudgmentBanner.tsx`:

```tsx
/**
 * Read-only banner for a quality-assessment template's computed overalls.
 *
 * PROBAST+AI defines its four overall judgments as a deterministic function of
 * the domain judgments, so they are never stored and never typed — the backend
 * (`derived_judgment_service`) is the single implementation and this component
 * only renders what it returns. An incomplete overall renders as an em dash,
 * never as Low: one does not conclude low risk from an unfinished assessment.
 */

import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { qa } from "@/lib/copy/qa";
import { cn } from "@/lib/utils";

export interface DerivedJudgmentView {
  id: string;
  label: string;
  value: string | null;
}

interface OverallJudgmentBannerProps {
  judgments: DerivedJudgmentView[];
}

function toneFor(value: string | null): string {
  switch (value?.toLowerCase()) {
    case "high":
      return "border-destructive/40 bg-destructive/10 text-destructive";
    case "unclear":
      return "border-warning/40 bg-warning/10 text-warning";
    case "low":
      return "border-success/40 bg-success/10 text-success";
    default:
      return "border-border bg-muted text-muted-foreground";
  }
}

export function OverallJudgmentBanner({ judgments }: OverallJudgmentBannerProps) {
  if (judgments.length === 0) return null;

  return (
    <section
      className="mb-3 rounded-md border bg-card p-3"
      data-testid="qa-overall-banner"
      aria-label={qa.overallBannerTitle}
    >
      <div className="mb-2 flex items-baseline gap-2">
        <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {qa.overallBannerTitle}
        </h2>
        <span className="text-[11px] text-muted-foreground">{qa.overallBannerHint}</span>
      </div>
      <ul className="flex flex-wrap gap-2">
        {judgments.map((judgment) => (
          <li key={judgment.id}>
            <Tooltip>
              <TooltipTrigger asChild>
                <Badge
                  variant="outline"
                  className={cn("gap-2 font-normal", toneFor(judgment.value))}
                  data-testid={`qa-overall-${judgment.id}`}
                >
                  <span className="text-muted-foreground">{judgment.label}</span>
                  <span className="font-semibold">
                    {judgment.value ?? qa.overallIncomplete}
                  </span>
                </Badge>
              </TooltipTrigger>
              <TooltipContent>
                {judgment.value ? qa.overallBannerHint : qa.overallIncompleteHint}
              </TooltipContent>
            </Tooltip>
          </li>
        ))}
      </ul>
    </section>
  );
}
```

- [ ] **Step 5: Run test to verify it passes**

```bash
npm run test:run -- frontend/test/components/OverallJudgmentBanner.test.tsx
```

Expected: PASS (3 passed).

- [ ] **Step 6: Extend the frontend run-view type**

In `frontend/hooks/runs/types.ts`, add to `RunViewResponse`:

```ts
  /** Computed overall judgments (worst-domain). Empty for templates with no spec. */
  derived_judgments?: { id: string; label: string; value: string | null }[];
```

- [ ] **Step 7: Mount the banner**

In `frontend/pages/QualityAssessmentFullScreen.tsx`, inside the
`showFormStage && template && session && effectiveViewMode === "assess"` block,
immediately before the `sortedDomains.length === 0 ? … : …` conditional:

```tsx
          <OverallJudgmentBanner judgments={runDetail?.derived_judgments ?? []} />
```

`runDetail` is already in scope (line 172). Add the import. The page's existing
test already wraps in a provider
(`frontend/test/QualityAssessmentFullScreen.test.tsx:246`), so no extra wrapper
is needed there.

- [ ] **Step 8: Run the page suite + typecheck**

```bash
npm run test:run -- frontend/test/QualityAssessmentFullScreen.test.tsx
npx tsc -p tsconfig.app.json --noEmit
```

Expected: both PASS.

- [ ] **Step 9: Bump the file-size baseline (page + its test are AT cap)**

```bash
python3 scripts/fitness/check_file_size.py --update-baseline
python3 scripts/fitness/check_file_size.py    # must exit 0
```

- [ ] **Step 10: Commit**

```bash
git add frontend/components/assessment/OverallJudgmentBanner.tsx frontend/hooks/runs/types.ts frontend/pages/QualityAssessmentFullScreen.tsx frontend/lib/copy/qa.ts frontend/test/components/OverallJudgmentBanner.test.tsx scripts/fitness/check_file_size.baseline
git commit -m "feat(qa): render computed overall judgments on the assessment screen"
```

---

## Verification checklist (before either PR)

- [ ] `make quality-scan` green, output read (not assumed).
- [ ] `python3 scripts/fitness/check_file_size.py` exits 0 **and** the baseline
      diff is committed in the same PR.
- [ ] mypy ratchet reports no new codes.
- [ ] `cd backend && uv run pytest tests/unit tests/integration -q` green.
- [ ] `npm run test:run` green; `npx tsc -p tsconfig.app.json --noEmit` clean.
- [ ] `git diff --stat backend/alembic/` is **empty** — this plan adds no
      migration.
- [ ] `npm run generate:api-types` produces no further diff after Task 7.
- [ ] Remember: the seed does **not** run on deploy. Installing the template in
      any deployed environment is an explicit, separate step.
