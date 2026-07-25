---
status: draft
last_reviewed: 2026-07-25
owner: '@raphaelfh'
---

# CHARMS + Multimodal seed template Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps
> use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Seed the CHARMS + multimodal-extension extraction instrument into
prumo's global template catalogue as `seed_charms_mm()`, so it can be
imported into a project and drive grounded AI extraction.

**Architecture:** Pure seed data on existing tables — one new
`seed_charms_mm()` function in `backend/app/seed.py` following the exact
shape of `seed_charms` / `seed_probast` (fixed UUIDs, existence-check
idempotency, `_EntitySpec` list + a local `_f` field helper), wired into
`main()`. Structure is the native prumo study/model split: 7 study-level
sections + 1 `model_container` + 6 per-model sections, 66 fields.

**Tech Stack:** Python 3.11+, SQLAlchemy 2.0 async ORM (declarative
objects only — the seed uses `session.get` + `session.add`, no SQL),
pytest.

**Spec:** [`docs/superpowers/specs/2026-07-25-charms-multimodal-template-design.md`](../specs/2026-07-25-charms-multimodal-template-design.md)
— the complete, committed field roster (66 rows: name, type,
`allowed_values`, units, disposition flags) lives in that document's
"Field roster" section and is the authoritative input to Task 2.

## Global Constraints

- **No Alembic migration.** This adds rows to existing tables via the seed
  script; no SQLAlchemy model changes. If a model change becomes
  necessary, STOP — that is out of scope for this plan.
- **English only** for all code, labels, descriptions, and
  `llm_description` prompts (repo hard rule).
- **Fixed UUIDs** — deterministic across environments. Template
  `000e0000-0000-0000-0000-000000000001`; entity types
  `000e0001…000e000e`. The `000e` prefix is verified free.
- **`field_type`** must be one of `text` / `number` / `date` / `select` /
  `multiselect` / `boolean` (`ExtractionFieldType`). There is no
  `integer` type — integers use `number`.
- **`is_required`** — entity types `False` (hardcoded by
  `_entity_type_from_spec`); fields `True` (leave the `_f` default),
  matching CHARMS / PROBAST / QUADAS-2.
- **ADR-0016 dispositions** — never seed `"NI"` / `"No information"` /
  `"Not applicable"` as `allowed_values`. `no_information` is universal
  and needs no flag; `allows_not_applicable` / `allows_not_evaluated`
  are per-field opt-ins.
- **Entity-role invariants** — exactly one `model_container` per
  template; `study_section` and `model_container` have
  `parent_entity_type_id IS NULL`; every `model_section` has the
  container as its parent (deferred trigger
  `trg_check_model_section_parent_role`).
- **Do not modify `seed_charms`** — it is a different review's
  instrument (endocarditis) and stays untouched.

## Panel reconciliation (2026-07-25)

Four adversarial lenses reviewed this plan. No BLOCKING defects. Accepted
changes, already folded into the tasks below:

1. **File-size ratchet** — `scripts/fitness/check_file_size.baseline`
   pins `backend/app/seed.py` at its exact current length (1954); *any*
   growth is a hard failure in `scripts/fitness/run_all.sh` → `make
   quality-scan` **and** CI. Task 2 ends with
   `--update-baseline` + committing the baseline in the same PR.
2. **No third field helper** — the plan originally added a local `_f`
   inside `seed_charms_mm`, a near-copy of `seed_charms`'s local `_f` and
   the module-level `_qa_field`. Instead, generalize `_qa_field` into a
   shared module-level `_field` (adds `unit`, requires `llm`, hardcodes
   `is_required=True`). Verified backward-compatible across all 89
   existing call sites (none passes `required=`; all pass `llm=`), and
   `_qa_field` is never imported outside `seed.py`. `seed_charms`'s own
   local `_f` stays untouched (pre-existing debt, not this PR's job).
3. **Keyword arguments for all new `_EntitySpec` / `_field` calls.**
   `ruff format` reflows these to one argument per line regardless, so
   keywords cost zero lines and remove the transposition risk across
   3–4 consecutive string parameters in 66 hand-transcribed rows.
4. **Assert field names per section, not counts.** Per-section *counts*
   repeat (5×2, 3×4, 2×3), so a field built with the wrong `eid` between
   two same-size sections passes a count check. The test asserts the full
   `{section: [field names in order]}` mapping, which subsumes counts,
   identity, and ordering — and cannot pass vacuously.
5. **Reuse the existing disposition sweep.** Add `seed_charms_mm` to the
   parametrize list in `backend/tests/unit/test_seed_dispositions.py`
   instead of duplicating the ADR-0016 check, and lift the shared
   `_CapturingSession` double into `backend/tests/unit/conftest.py`.
6. **E2E locator** — `frontend/e2e/flows/template-import.ui.e2e.ts`
   falls back to `getByText("CHARMS", { exact: true }).first()`. The new
   template also carries `framework="CHARMS"`, which renders as an exact
   "CHARMS" Badge in a *second* card, making that locator ambiguous.
   Scope it to the option label.

Explicitly **not** actioned:

- *Diff-cover risk* — measured, not assumed: a multi-line list literal
  collapses to a single executable statement, so the ~700 new lines
  contribute ~50 statements, nearly all executed by the unit tests
  (measured 95.2% on a synthetic equivalent). No action needed.
- *`main()` wiring line is uncovered* — true, and equally true of the
  three existing `seed_*` calls beside it. Consistent with precedent.
- *Copy still says "Import the CHARMS template"*
  (`frontend/lib/copy/extraction.ts`) — cosmetic, unrelated to this
  change; flagged, not touched.

**Behaviour to know (pre-existing, not changed here):**
`TemplateCloneService` enforces one *active* extraction template per
project, so importing CHARMS + Multimodal into a project that already has
CHARMS active will **deactivate** CHARMS (reactivatable, not deleted).

---

### Task 1: Template + entity-type tree, wired into `main()`

**Files:**

- Modify: `backend/app/seed.py` (add fixed-UUID block near the existing
  ones at ~line 115-146; add `seed_charms_mm()` after `seed_charms`; add
  the call in `main()` at ~line 1937)
- Test: `backend/tests/unit/test_seed_charms_mm.py` (create)

**Interfaces:**

- Consumes: `_EntitySpec`, `_entity_type_from_spec`,
  `ExtractionEntityRole`, `ExtractionTemplateGlobal`, `TemplateKind` —
  all already defined at the top of `seed.py`.
- Produces: `async def seed_charms_mm(session: AsyncSession) -> None`,
  and module-level UUID constants `_MM_TEMPLATE_ID`,
  `_MM_ET_SOURCE`, `_MM_ET_PARTICIPANTS`, `_MM_ET_OUTCOME`,
  `_MM_ET_PREDICTORS`, `_MM_ET_SAMPLE_SIZE`, `_MM_ET_MISSING`,
  `_MM_ET_INTERPRETATION`, `_MM_ET_MODELS`, `_MM_ET_MODEL_DEV`,
  `_MM_ET_MODEL_PERF`, `_MM_ET_MODEL_EVAL`, `_MM_ET_RESULTS`,
  `_MM_ET_MULTIMODAL`, `_MM_ET_NUMERIC_PERF`. Task 2 consumes all of
  these entity-type constants.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/unit/test_seed_charms_mm.py`. It reuses the
DB-free capturing-session pattern from
`backend/tests/unit/test_seed_dispositions.py` (the seed functions only
call `session.get` + `session.add`, so no database is needed).

```python
"""Structure guards for the CHARMS + multimodal seed template.

Runs without a database: the seed functions only use ``get`` (forced to
None so the build path runs) and ``add``.
"""

from __future__ import annotations

import pytest

from app.models.extraction import (
    ExtractionEntityRole,
    ExtractionEntityType,
    ExtractionField,
    ExtractionTemplateGlobal,
)
from app.seed import seed_charms_mm


class _CapturingSession:
    def __init__(self) -> None:
        self.added: list[object] = []

    async def get(self, *_a: object, **_k: object) -> None:
        return None

    def add(self, obj: object) -> None:
        self.added.append(obj)


async def _seed() -> _CapturingSession:
    session = _CapturingSession()
    await seed_charms_mm(session)
    return session


def _of(session: _CapturingSession, cls: type) -> list:
    return [o for o in session.added if isinstance(o, cls)]


@pytest.mark.asyncio
async def test_seeds_one_template() -> None:
    session = await _seed()
    templates = _of(session, ExtractionTemplateGlobal)
    assert len(templates) == 1
    assert templates[0].framework == "CHARMS"


@pytest.mark.asyncio
async def test_entity_type_tree_shape() -> None:
    session = await _seed()
    ets = _of(session, ExtractionEntityType)
    assert len(ets) == 14

    by_role: dict[str, list[ExtractionEntityType]] = {}
    for et in ets:
        by_role.setdefault(et.role, []).append(et)

    assert len(by_role[ExtractionEntityRole.STUDY_SECTION.value]) == 7
    assert len(by_role[ExtractionEntityRole.MODEL_CONTAINER.value]) == 1
    assert len(by_role[ExtractionEntityRole.MODEL_SECTION.value]) == 6


@pytest.mark.asyncio
async def test_role_parent_coherence() -> None:
    """Mirrors the DB CHECK + deferred trigger so a bad tree fails here."""
    session = await _seed()
    ets = _of(session, ExtractionEntityType)
    container = next(
        e for e in ets if e.role == ExtractionEntityRole.MODEL_CONTAINER.value
    )

    assert container.parent_entity_type_id is None
    assert container.cardinality == "many"

    for et in ets:
        if et.role == ExtractionEntityRole.STUDY_SECTION.value:
            assert et.parent_entity_type_id is None, et.name
        if et.role == ExtractionEntityRole.MODEL_SECTION.value:
            assert et.parent_entity_type_id == container.id, et.name


@pytest.mark.asyncio
async def test_exactly_one_many_model_section() -> None:
    """Numeric Performance repeats per validation type; every other
    per-model section is 1:1 with the model."""
    session = await _seed()
    ets = _of(session, ExtractionEntityType)
    many = [
        e
        for e in ets
        if e.role == ExtractionEntityRole.MODEL_SECTION.value
        and e.cardinality == "many"
    ]
    assert [e.name for e in many] == ["numeric_performance"]


@pytest.mark.asyncio
async def test_entity_types_are_not_required() -> None:
    session = await _seed()
    assert all(not et.is_required for et in _of(session, ExtractionEntityType))


@pytest.mark.asyncio
async def test_idempotent_when_template_exists() -> None:
    """A pre-existing template short-circuits the whole build."""

    class _ExistingSession(_CapturingSession):
        async def get(self, *_a: object, **_k: object) -> object:
            return object()

    session = _ExistingSession()
    await seed_charms_mm(session)
    assert session.added == []
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
cd backend && uv run pytest tests/unit/test_seed_charms_mm.py -v
```

Expected: collection error — `ImportError: cannot import name
'seed_charms_mm' from 'app.seed'`.

- [ ] **Step 3: Add the fixed UUID block**

In `backend/app/seed.py`, after the existing `_ET_MODEL_OBS` constant
(~line 146), add:

```python
# CHARMS + Multimodal (ML prediction) — extraction template.
# Prefix 000e is reserved for this template; never reuse.
_MM_TEMPLATE_ID = UUID("000e0000-0000-0000-0000-000000000001")
# Study-level sections
_MM_ET_SOURCE = UUID("000e0001-0000-0000-0000-000000000000")
_MM_ET_PARTICIPANTS = UUID("000e0002-0000-0000-0000-000000000000")
_MM_ET_OUTCOME = UUID("000e0003-0000-0000-0000-000000000000")
_MM_ET_PREDICTORS = UUID("000e0004-0000-0000-0000-000000000000")
_MM_ET_SAMPLE_SIZE = UUID("000e0005-0000-0000-0000-000000000000")
_MM_ET_MISSING = UUID("000e0006-0000-0000-0000-000000000000")
_MM_ET_INTERPRETATION = UUID("000e0007-0000-0000-0000-000000000000")
# Model container + per-model sections
_MM_ET_MODELS = UUID("000e0008-0000-0000-0000-000000000000")
_MM_ET_MODEL_DEV = UUID("000e0009-0000-0000-0000-000000000000")
_MM_ET_MODEL_PERF = UUID("000e000a-0000-0000-0000-000000000000")
_MM_ET_MODEL_EVAL = UUID("000e000b-0000-0000-0000-000000000000")
_MM_ET_RESULTS = UUID("000e000c-0000-0000-0000-000000000000")
_MM_ET_MULTIMODAL = UUID("000e000d-0000-0000-0000-000000000000")
_MM_ET_NUMERIC_PERF = UUID("000e000e-0000-0000-0000-000000000000")
```

- [ ] **Step 4: Add `seed_charms_mm()` with the template + entity types**

Add after `seed_charms()` ends (before the `_qa_field` helper). Fields
come in Task 2 — this step ends with an empty `fields` list so the tree
tests pass on their own.

```python
async def seed_charms_mm(session: AsyncSession) -> None:
    """Seeds the CHARMS + multimodal template, 14 entity types, 66 fields.

    The multimodal-ML instrument: CHARMS study/model sections plus a
    per-model multimodal extension (Schouten 2025 modality definition,
    fusion taxonomy, representation tiers) and a per-validation numeric
    performance block feeding the meta-analysis.
    """
    print("Seeding CHARMS + Multimodal template...")

    template = await session.get(ExtractionTemplateGlobal, _MM_TEMPLATE_ID)
    if template:
        print("  CHARMS + Multimodal already exists — skipping.")
        return

    session.add(
        ExtractionTemplateGlobal(
            id=_MM_TEMPLATE_ID,
            name="CHARMS + Multimodal (ML prediction)",
            description=(
                "CHARMS checklist extended for multimodal machine-learning "
                "prediction models. Study-level sections (Source of Data, "
                "Participants, Outcome, Candidate Predictors, Sample Size, "
                "Missing Data, Interpretation) are filled once per article; "
                "per-model sections (Model Development, Performance, "
                "Evaluation, Results, Multimodal Extension) are filled once "
                "per prediction model, and Numeric Performance repeats per "
                "validation type (apparent / internal / external)."
            ),
            framework="CHARMS",
            version="1.0.0",
            kind=TemplateKind.EXTRACTION.value,
        )
    )

    _study = ExtractionEntityRole.STUDY_SECTION
    _container = ExtractionEntityRole.MODEL_CONTAINER
    _section = ExtractionEntityRole.MODEL_SECTION
    entity_types: list[_EntitySpec] = [
        _EntitySpec(_MM_ET_SOURCE, "source_of_data", "Source of Data",
                    "Study design and data source (CHARMS: source of data)",
                    None, "one", _study, 0),
        _EntitySpec(_MM_ET_PARTICIPANTS, "participants", "Participants",
                    "Eligibility, setting, and centres (CHARMS: participants)",
                    None, "one", _study, 1),
        _EntitySpec(_MM_ET_OUTCOME, "outcome", "Outcome",
                    "Predicted outcome definition and timing (CHARMS: outcome)",
                    None, "one", _study, 2),
        _EntitySpec(_MM_ET_PREDICTORS, "candidate_predictors",
                    "Candidate Predictors",
                    "Candidate predictors considered (CHARMS: candidate predictors)",
                    None, "one", _study, 3),
        _EntitySpec(_MM_ET_SAMPLE_SIZE, "sample_size", "Sample Size",
                    "Participants, events, and EPV (CHARMS: sample size)",
                    None, "one", _study, 4),
        _EntitySpec(_MM_ET_MISSING, "missing_data", "Missing Data",
                    "Missing data reporting and handling (CHARMS: missing data)",
                    None, "one", _study, 5),
        _EntitySpec(_MM_ET_INTERPRETATION, "interpretation", "Interpretation",
                    "Authors' comparison, limitations, and applicability "
                    "(CHARMS: interpretation). Study-level: describes the paper, "
                    "not an individual model.",
                    None, "one", _study, 6),
        _EntitySpec(_MM_ET_MODELS, "prediction_models", "Prediction Models",
                    "Prediction models relevant to the review question. One "
                    "instance per model (multimodal, unimodal comparator, "
                    "baseline, or guideline score).",
                    None, "many", _container, 7),
        _EntitySpec(_MM_ET_MODEL_DEV, "model_development", "Model Development",
                    "Modelling method, predictor selection, tuning, internal validation",
                    _MM_ET_MODELS, "one", _section, 8),
        _EntitySpec(_MM_ET_MODEL_PERF, "model_performance", "Model Performance",
                    "Reported discrimination, calibration, and classification measures",
                    _MM_ET_MODELS, "one", _section, 9),
        _EntitySpec(_MM_ET_MODEL_EVAL, "model_evaluation", "Model Evaluation",
                    "Validation level, external source, and comparator",
                    _MM_ET_MODELS, "one", _section, 10),
        _EntitySpec(_MM_ET_RESULTS, "results", "Results",
                    "Final model presentation and coefficient availability",
                    _MM_ET_MODELS, "one", _section, 11),
        _EntitySpec(_MM_ET_MULTIMODAL, "multimodal_extension",
                    "Multimodal Extension",
                    "Modalities, domain count, fusion, representation tier, "
                    "encoders, provenance, comparator type (review protocol)",
                    _MM_ET_MODELS, "one", _section, 12),
        _EntitySpec(_MM_ET_NUMERIC_PERF, "numeric_performance",
                    "Numeric Performance",
                    "Quantitative performance for one validation type. Repeat "
                    "per apparent / internal / external estimate.",
                    _MM_ET_MODELS, "many", _section, 13),
    ]
    for spec in entity_types:
        session.add(_entity_type_from_spec(spec, template_id=_MM_TEMPLATE_ID))

    fields: list[ExtractionField] = []
    for field in fields:
        session.add(field)

    print(f"  Seeded {len(entity_types)} entity types and {len(fields)} fields.")
```

- [ ] **Step 5: Wire into `main()`**

In `main()`, add the call after `seed_charms(session)`:

```python
            await seed_charms(session)
            await seed_charms_mm(session)
            await seed_probast(session)
            await seed_quadas2(session)
```

- [ ] **Step 6: Run the tests to verify they pass**

Run:

```bash
cd backend && uv run pytest tests/unit/test_seed_charms_mm.py -v
```

Expected: all 6 tests PASS.

- [ ] **Step 7: Lint and commit**

```bash
cd backend && uv run ruff check app/seed.py tests/unit/test_seed_charms_mm.py && uv run ruff format app/seed.py tests/unit/test_seed_charms_mm.py
git add backend/app/seed.py backend/tests/unit/test_seed_charms_mm.py
git commit -m "feat(extraction): seed CHARMS + multimodal template tree"
```

---

### Task 2: The 66 fields

**Files:**

- Modify: `backend/app/seed.py` (the `fields` list inside
  `seed_charms_mm`, plus a local `_f` helper)
- Test: `backend/tests/unit/test_seed_charms_mm.py` (extend)

**Interfaces:**

- Consumes: every `_MM_ET_*` constant from Task 1, and the empty
  `fields` list placeholder inside `seed_charms_mm`.
- Produces: 66 `ExtractionField` rows. No new module-level names.

**Authoritative roster:** the "Field roster" section of the spec
([`2026-07-25-charms-multimodal-template-design.md`](../specs/2026-07-25-charms-multimodal-template-design.md))
lists all 66 fields with exact `name`, `field_type`, `allowed_values`,
units, and disposition flags. Transcribe it exactly. Each field's
`llm_description` is the English translation of that field's `prompt-IA`
column in
`pj_multimodal_ml_heart_failure_sr/docs/data_extraction/data_extraction_fields.md`.

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/unit/test_seed_charms_mm.py`:

```python
_EXPECTED_COUNTS = {
    "source_of_data": 4,
    "participants": 5,
    "outcome": 6,
    "candidate_predictors": 5,
    "sample_size": 3,
    "missing_data": 2,
    "interpretation": 3,
    "prediction_models": 2,
    "model_development": 4,
    "model_performance": 3,
    "model_evaluation": 3,
    "results": 2,
    "multimodal_extension": 7,
    "numeric_performance": 17,
}

_DISPOSITION_STRINGS = {"No information", "Not applicable", "Not evaluated", "NI", "NA"}


async def _fields_by_section() -> dict[str, list[ExtractionField]]:
    session = await _seed()
    names = {et.id: et.name for et in _of(session, ExtractionEntityType)}
    out: dict[str, list[ExtractionField]] = {}
    for f in _of(session, ExtractionField):
        out.setdefault(names[f.entity_type_id], []).append(f)
    return out


@pytest.mark.asyncio
async def test_field_count_per_section() -> None:
    by_section = await _fields_by_section()
    assert {k: len(v) for k, v in by_section.items()} == _EXPECTED_COUNTS


@pytest.mark.asyncio
async def test_total_field_count() -> None:
    session = await _seed()
    assert len(_of(session, ExtractionField)) == 66


@pytest.mark.asyncio
async def test_no_disposition_strings_in_allowed_values() -> None:
    """ADR-0016: NI/NA are coded markers, never select options."""
    session = await _seed()
    for f in _of(session, ExtractionField):
        for value in f.allowed_values or []:
            assert value not in _DISPOSITION_STRINGS, f"{f.name}: {value}"


@pytest.mark.asyncio
async def test_select_fields_have_allowed_values() -> None:
    session = await _seed()
    for f in _of(session, ExtractionField):
        if f.field_type in ("select", "multiselect"):
            assert f.allowed_values, f.name
        else:
            assert f.allowed_values is None, f.name


@pytest.mark.asyncio
async def test_every_field_has_an_llm_prompt() -> None:
    session = await _seed()
    for f in _of(session, ExtractionField):
        assert f.llm_description, f.name


@pytest.mark.asyncio
async def test_fields_are_required() -> None:
    """Matches CHARMS/PROBAST/QUADAS-2: a required field turns 'if absent,
    NI' into an explicitly recorded answer (constitution §IX)."""
    session = await _seed()
    assert all(f.is_required for f in _of(session, ExtractionField))


@pytest.mark.asyncio
async def test_disposition_opt_ins() -> None:
    session = await _seed()
    fields = {f.name: f for f in _of(session, ExtractionField)}

    assert fields["eval_external_source"].allows_not_applicable

    for name in ("perf_calibration", "pnum_calib_slope", "pnum_calib_intercept"):
        assert fields[name].allows_not_evaluated, name

    # No blanket opt-ins: everything else relies on universal no_information.
    assert sum(f.allows_not_applicable for f in fields.values()) == 1
    assert sum(f.allows_not_evaluated for f in fields.values()) == 3


@pytest.mark.asyncio
async def test_confidence_intervals_are_paired_numbers() -> None:
    """Spec decision: no number_ci type — each CI is two number fields."""
    session = await _seed()
    fields = {f.name: f for f in _of(session, ExtractionField)}
    for stem in ("pnum_auc", "pnum_cindex"):
        assert fields[stem].field_type == "number"
        for bound in ("_ci_low", "_ci_high"):
            assert fields[stem + bound].field_type == "number", stem + bound


@pytest.mark.asyncio
async def test_multimodal_vocabulary() -> None:
    session = await _seed()
    fields = {f.name: f for f in _of(session, ExtractionField)}

    modalities = fields["mm_modalities"]
    assert modalities.field_type == "multiselect"
    assert modalities.allowed_values == [
        "ecg", "pcg", "cxr", "echo", "cmr", "clinical-text",
        "tabular-ehr", "ehr-timeseries", "omics", "hrv", "wearable-iot",
    ]

    assert fields["mm_fusion_type"].allowed_values == [
        "early", "intermediate", "late", "none",
    ]
    assert fields["mm_representation_tier"].allowed_values == [
        "tier-1", "tier-2", "tier-3",
    ]
    assert fields["mm_provenance_flag"].allowed_values == [
        "separate-stream", "single-field-imaging-origin", "na",
    ]
    assert fields["pnum_validation_type"].allowed_values == [
        "apparent", "internal", "external",
    ]


@pytest.mark.asyncio
async def test_modality_prompts_carry_the_protocol_definition() -> None:
    """mm_modalities / mm_n_domains embed the protocol's modality
    definition so the classification does not depend on the wrapper
    retrieving the right protocol passage."""
    session = await _seed()
    fields = {f.name: f for f in _of(session, ExtractionField)}
    for name in ("mm_modalities", "mm_n_domains"):
        prompt = fields[name].llm_description.lower()
        assert "provenance" in prompt, name
        assert "tabular-ehr" in prompt, name
```

- [ ] **Step 2: Run the tests to verify they fail**

Run:

```bash
cd backend && uv run pytest tests/unit/test_seed_charms_mm.py -v
```

Expected: the Task 1 tests still PASS; every new test FAILS (0 fields
seeded — `test_total_field_count` reports `0 == 66`).

- [ ] **Step 3: Add the local `_f` helper**

Inside `seed_charms_mm`, immediately before `fields: list[...]`, add the
same helper `seed_charms` uses (kept local so the two templates can
diverge without coupling):

```python
    def _f(
        eid: UUID,
        name: str,
        label: str,
        desc: str,
        ftype: str,
        sort: int,
        *,
        allowed: list[str] | None = None,
        unit: str | None = None,
        llm: str,
        allows_not_applicable: bool = False,
        allows_not_evaluated: bool = False,
    ) -> ExtractionField:
        return ExtractionField(
            entity_type_id=eid,
            name=name,
            label=label,
            description=desc,
            field_type=ftype,
            sort_order=sort,
            is_required=True,
            allowed_values=allowed,
            unit=unit,
            llm_description=llm,
            allows_not_applicable=allows_not_applicable,
            allows_not_evaluated=allows_not_evaluated,
        )
```

Note the deliberate differences from `seed_charms`'s `_f`: `llm` is
**required** (a keyword-only argument with no default) so no field can
ship without a prompt, and `required` is not a parameter at all.

- [ ] **Step 4: Transcribe the 66 fields**

Populate the `fields` list from the spec's "Field roster", section by
section in entity-type order, `sort` starting at 0 within each section.
Each `llm` value is the English translation of that field's `prompt-IA`.

Two prompts carry the embedded protocol definition and must be
translated with the full modality rules intact (domain vocabulary, the
single-acquisition-derivation rule, and the provenance criterion) —
`mm_modalities` and `mm_n_domains`. The remaining multimodal prompts
carry their operational definitions inline.

- [ ] **Step 5: Run the tests to verify they pass**

Run:

```bash
cd backend && uv run pytest tests/unit/test_seed_charms_mm.py -v
```

Expected: all tests PASS.

- [ ] **Step 6: Verify the seed actually applies against a real database**

The unit tests never touch Postgres, so they cannot catch an enum
mismatch, a CHECK violation, or the deferred `model_section` parent
trigger. Run the real seed once locally:

```bash
make db-fresh
cd backend && uv run python -m app.seed
```

Expected: `Seeding CHARMS + Multimodal template...` then
`Seeded 14 entity types and 66 fields.`, and the process exits 0.
Then confirm idempotency by running it a second time:

```bash
cd backend && uv run python -m app.seed
```

Expected: `CHARMS + Multimodal already exists — skipping.`

- [ ] **Step 7: Lint and commit**

```bash
cd backend && uv run ruff check app/seed.py tests/unit/test_seed_charms_mm.py && uv run ruff format app/seed.py tests/unit/test_seed_charms_mm.py
git add backend/app/seed.py backend/tests/unit/test_seed_charms_mm.py
git commit -m "feat(extraction): seed CHARMS + multimodal field roster"
```

---

## Verification

Full gate before shipping:

```bash
make quality-scan
```

Plus the backend unit suite the diff touches:

```bash
cd backend && uv run pytest tests/unit -q
```

Both must be green and READ before any claim of completion.
