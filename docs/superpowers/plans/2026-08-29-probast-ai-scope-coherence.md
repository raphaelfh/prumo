---
status: in_progress
last_reviewed: 2026-08-29
owner: '@raphaelfh'
---

# PROBAST+AI scope coherence — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: use
> `superpowers:subagent-driven-development` or `superpowers:executing-plans`
> to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** make PROBAST+AI v2's Step-2 study-type classification load-bearing
across progress, AI calls, derivation and export, on an instrument-exact
five-answer signaling scale, delivered by a seed that actually converges.

**Architecture:** the rule is declared data (`scope_rules` on the template's
`schema_`, sibling of `derived_judgments`); each layer evaluates it where that
layer acts. One additive column (`allows_no_information`) turns the hardcoded
universal "No information" marker into a per-field opt-in like its NA/NE
siblings. The seed converges unconditionally so corrected template data
reaches an existing database.

**Tech stack:** Python 3.11 / FastAPI / SQLAlchemy 2.0 async / Alembic /
pytest; TypeScript strict / React 19 / TanStack Query / Vitest.

**Design:**
[`docs/superpowers/specs/2026-08-26-probast-ai-scope-coherence-design.md`](../specs/2026-08-26-probast-ai-scope-coherence-design.md)

## Global constraints

Copied from the design; every task inherits them.

- `allows_no_information` is a boolean on `extraction_fields` with
  `server_default true`. Every existing template behaves identically by
  default.
- Seed v2.1.0 sets `allows_no_information=False` on all 95 fields.
- The shared `_PROBAST_SIGNALING` constant stays untouched — the five-answer
  list is v2-local.
- `_SIGNALING_MAP` gains `"ni"` mapped to `Unclear`.
- Required = the scope classifier + the 8 domain judgments + the 6
  applicability judgments. Signaling questions and all text boxes are
  optional.
- The six conditional rows keep `allows_not_applicable`.
- Seed convergence is unconditional — no version compare. The template row is
  updated, never deleted; its children are replaced.
- Alembic revision ids are at most 32 characters, and adding a migration means
  bumping the `test_migration_roundtrip` head pin in the same change.
- English only, conventional commits, PRs target `dev`.

## Delivery — PR train on `dev`

| PR | Content | Ships in this run |
|----|---------|-------------------|
| PR1 | model + seed: the migration, `scope_rules` data, the NI answer, optionality, unconditional convergence, `2.1.0`, seed tests | **yes** |
| PR2 | backend consumers: scope helper, AI-path guard, payload state, export parity, run-view `general_instructions` | queued |
| PR3 | frontend: schema in selects, data-driven `studyTypeScope`, progress filtering, collapse and copy, banner and chip state, flag-gated NI in `FieldInput` | queued |
| PR4 | finalize backstop for divergence-without-rationale | queued |
| PR5 | `useProjectQATemplate` to TanStack Query | queued |

PR1 is inert to every runtime path: the new column defaults `true` everywhere
it already exists, and only the global catalogue row changes — existing project
clones keep their v2.0.0 copy until they re-import.

---

## PR1 — model and seed

### Task 1: `allows_no_information` column and its five touchpoints

**Files:**

- Create: `backend/alembic/versions/0062_allows_no_information.py`
- Modify: `backend/app/models/extraction.py` (beside `allows_not_evaluated`)
- Modify: `backend/app/seed.py` (`_field` keyword)
- Modify: `backend/app/services/extraction_snapshot.py` (snapshot SQL)
- Modify: `backend/app/services/template_clone_service.py` (clone copy)
- Modify: `backend/app/services/template_diff.py`
  (`FIELD_ATTRIBUTE_DEFAULTS`, `ATTRIBUTE_TIERS`)
- Modify: `backend/app/schemas/template_structure.py` (create / update /
  response models and `_NON_NULLABLE_UPDATE_FIELDS`)
- Modify: `backend/app/schemas/template_portable.py`
- Modify: `backend/app/schemas/extraction.py`
- Modify: `backend/app/schemas/extraction_run.py`
- Modify: `backend/tests/integration/test_migration_roundtrip.py` (head pin)
- Test: `backend/tests/unit/test_seed_dispositions.py`

**Interfaces:**

- Produces: `ExtractionField.allows_no_information: bool` (non-null, default
  `True`), `_field(..., allows_no_information: bool = True)`, and the key
  `"allows_no_information"` in `FIELD_ATTRIBUTE_DEFAULTS` (default `True`) and
  `ATTRIBUTE_TIERS` (`ChangeTier.SEMANTIC`).

The default asymmetry is the trap: the two sibling flags default `False` in
the diff default map, this one defaults `True`, because an absent key in an
old snapshot means "the marker was universal", which is what `true` encodes.

- [ ] **Step 1: write the failing tests**

In `backend/tests/unit/test_seed_dispositions.py`:

```python
def test_field_defaults_to_allowing_no_information() -> None:
    f = _field(_SENTINEL_EID, "x", "X", "d", "text", 0, llm=None)
    assert f.allows_no_information is True


def test_field_can_opt_out_of_no_information() -> None:
    f = _field(_SENTINEL_EID, "x", "X", "d", "text", 0, llm=None,
               allows_no_information=False)
    assert f.allows_no_information is False
```

- [ ] **Step 2: run them and watch them fail**

Run: `cd backend && uv run pytest tests/unit/test_seed_dispositions.py -q`
Expected: `TypeError: _field() got an unexpected keyword argument`.

- [ ] **Step 3: add the column and thread it through**

Column on the model, mirroring its siblings:

```python
allows_no_information: Mapped[bool] = mapped_column(
    Boolean, nullable=False, server_default=text("true")
)
```

Migration, mirroring `0038_field_disposition_flags`:

```python
revision = "0062_allows_no_information"
down_revision = "0061_rls_initplan_config_reads"

def upgrade() -> None:
    op.add_column(
        "extraction_fields",
        sa.Column("allows_no_information", sa.Boolean(), nullable=False,
                  server_default=sa.text("true")),
        schema="public",
    )

def downgrade() -> None:
    op.drop_column("extraction_fields", "allows_no_information", schema="public")
```

Then the five touchpoints, each one line beside its sibling.

- [ ] **Step 4: run the unit gate**

Run:
`cd backend && uv run pytest tests/unit/test_seed_dispositions.py tests/unit/test_template_diff.py tests/unit/test_template_diff_read.py -q`
Expected: PASS. The diff partition tests are the built-in guard — they are
exhaustive over `FIELD_ATTRIBUTE_DEFAULTS` versus `ATTRIBUTE_TIERS`, so a
half-threaded key fails them.

- [ ] **Step 5: prove the migration round-trips**

Run: `cd backend && uv run alembic upgrade head && uv run alembic downgrade -1 && uv run alembic upgrade head`
Expected: three clean runs, and `alembic heads` reports
`0062_allows_no_information`.

- [ ] **Step 6: commit**

```bash
git commit -am "feat(extraction): add the allows_no_information field flag"
```

### Task 2: PROBAST+AI v2.1.0 seed content

**Files:**

- Modify: `backend/app/seed_probast_ai_data.py`
  (add `_PAI_SIGNALING`, `_PAI_SCOPE_RULES`)
- Modify: `backend/app/seed_probast_ai.py`
- Test: `backend/tests/unit/test_seed_probast_ai.py`,
  `backend/tests/unit/test_seed_dispositions.py`

**Interfaces:**

- Consumes: `_field(..., allows_no_information=...)` from Task 1.
- Produces: `_PAI_SIGNALING: list[Any]` — the five-answer list
  `["Y", "PY", "PN", "N", {"value": "NI", "label": "No information"}]` — and
  `_PAI_SCOPE_RULES: dict[str, Any]`, the `scope_rules` value.

- [ ] **Step 1: write the failing tests**

Rewrite `test_optionality` and add the new shape assertions:

```python
_REQUIRED_NAMES = {"study_type", "quality_concern", "risk_of_bias",
                   "applicability_concerns"}


@pytest.mark.asyncio
async def test_optionality_is_the_deliverable_not_the_scaffolding() -> None:
    session = await _seed()
    required = {
        (sec, f.name)
        for sec, rows in _fields_by_section(session).items()
        for f in rows
        if f.is_required
    }
    assert {name for _, name in required} == _REQUIRED_NAMES
    assert len(required) == 15  # classifier + 8 judgments + 6 applicability


@pytest.mark.asyncio
async def test_no_information_marker_is_off_on_every_field() -> None:
    session = await _seed()
    fields = _of(session, ExtractionField)
    assert len(fields) == 95
    assert not any(f.allows_no_information for f in fields)


@pytest.mark.asyncio
async def test_signaling_selects_carry_the_five_answer_scale() -> None:
    session = await _seed()
    sq = [f for f in _of(session, ExtractionField)
          if f.allowed_values == _PAI_SIGNALING]
    assert len(sq) == 42
    assert [o["value"] if isinstance(o, dict) else o for o in _PAI_SIGNALING] == [
        "Y", "PY", "PN", "N", "NI",
    ]
    assert _PAI_SIGNALING[-1] == {"value": "NI", "label": "No information"}
    assert _PROBAST_SIGNALING == ["Y", "PY", "PN", "N"]  # shared constant intact


@pytest.mark.asyncio
async def test_scope_rules_resolve_against_the_seeded_tree() -> None:
    session = await _seed()
    [tpl] = _of(session, ExtractionTemplateGlobal)
    rules = tpl.schema_["scope_rules"]
    seeded_sections = set(_fields_by_section(session))
    classifier = rules["classifier"]
    assert (classifier["section"], classifier["field"]) in {
        (sec, f.name) for sec, rows in _fields_by_section(session).items()
        for f in rows
    }
    for study_type, excluded in rules["excludes"].items():
        assert excluded, study_type
        for section in excluded:
            assert section in seeded_sections, (study_type, section)
        # a self-excluding classifier would collapse the form's entry point
        assert classifier["section"] not in excluded, study_type
    assert set(rules["excludes"]) == {"development_only", "evaluation_only"}


@pytest.mark.asyncio
async def test_instruction_tails_name_the_five_answer_scale() -> None:
    session = await _seed()
    for sec, rows in _fields_by_section(session).items():
        for f in rows:
            if f.allowed_values == _PAI_SIGNALING:
                assert "Answer Y, PY, PN, N or NI" in f.llm_description, (sec, f.name)
            if f.llm_description:
                assert "mark no information" not in f.llm_description, (sec, f.name)
```

Also update `test_template_row` to `2.1.0` and
`test_probast_ai_na_restricted_to_conditional_rows` in
`test_seed_dispositions.py` to select on `_PAI_SIGNALING`.

`test_no_seeded_field_carries_a_disposition_value` needs an explicit,
documented carve-out: `"NI"` is now the instrument's own fifth SQ answer for
PROBAST+AI v2, not an in-band disposition duplicating a marker, because
`allows_no_information=False` turns the marker off on exactly those fields —
one control, which is what ADR-0016 was protecting.

- [ ] **Step 2: run them and watch them fail**

Run: `cd backend && uv run pytest tests/unit/test_seed_probast_ai.py tests/unit/test_seed_dispositions.py -q`
Expected: FAIL — `KeyError: 'scope_rules'`, version `2.0.0`, optionality
mismatch.

- [ ] **Step 3: implement the seed content**

In `seed_probast_ai_data.py`:

```python
_PAI_SIGNALING: list[Any] = [
    "Y", "PY", "PN", "N",
    {"value": "NI", "label": "No information"},
]

_PAI_SCOPE_RULES: dict[str, Any] = {
    "classifier": {"section": _S_SCOPE, "field": "study_type"},
    "excludes": {
        "development_only": [
            _S_EVAL_D1, _S_EVAL_D2, _S_EVAL_D3,
            _S_EVAL_D4_A, _S_EVAL_D4_I, _S_EVAL_D4_E, _S_EVAL_D4_J,
        ],
        "evaluation_only": [_S_DEV_D1, _S_DEV_D2, _S_DEV_D3, _S_DEV_D4],
    },
}
```

In `seed_probast_ai.py`: rewrite the two answer instructions to
`" Answer Y, PY, PN, N or NI (no information)."` and its NA variant; make
`_sq` pass `_PAI_SIGNALING`, `is_required=False` and
`allows_no_information=False`; drop the marker tail from the applicability
prompt in favour of "answer Unclear when the article gives too little to
judge"; set `allows_no_information=False` on every builder; bump the version
and add `scope_rules` to `schema_`.

- [ ] **Step 4: run the unit gate**

Run: `cd backend && uv run pytest tests/unit/ -q -k "seed or signaling or disposition"`
Expected: PASS.

- [ ] **Step 5: commit**

```bash
git commit -am "feat(seed): PROBAST+AI 2.1.0 — scope rules, NI answer, optionality"
```

### Task 3: `_SIGNALING_MAP` learns `NI`

**Files:**

- Modify: `backend/app/services/derived_judgment_service.py`
- Test: `backend/tests/unit/test_derived_judgment_service.py`

**Interfaces:**

- Produces: `_SIGNALING_MAP["ni"] == "Unclear"`.

- [ ] **Step 1: write the failing test**

```python
def test_ni_answer_contributes_unclear_through_both_caller_shapes() -> None:
    # run-view shape: the raw jsonb envelope carrying the stored code
    assert _signaling_contribution({"value": "NI"}) == "Unclear"
    # export shape: resolve_value already collapsed it to the option label
    assert _signaling_contribution("No information") == "Unclear"
```

- [ ] **Step 2: run it and watch it fail**

Run: `cd backend && uv run pytest tests/unit/test_derived_judgment_service.py -q -k ni_answer`
Expected: FAIL — the raw shape returns `"missing"`.

- [ ] **Step 3: add the mapping**

```python
_SIGNALING_MAP: dict[str, Contribution] = {
    "y": "Low",
    "py": "Low",
    "pn": "High",
    "n": "High",
    # PROBAST+AI v2.1.0's fifth answer — the instrument's own NI, which the
    # scale encodes as Unclear (the same result the marker path produces).
    "ni": "Unclear",
    # QUADAS-2's third answer (§11 adoption) — same casefolded lookup.
    "unclear": "Unclear",
}
```

- [ ] **Step 4: run the gate**

Run: `cd backend && uv run pytest tests/unit/test_derived_judgment_service.py -q`
Expected: PASS.

- [ ] **Step 5: commit**

```bash
git commit -am "feat(derivation): map the PROBAST+AI NI answer to Unclear"
```

### Task 4: unconditional seed convergence

**Files:**

- Modify: `backend/app/seed_probast_ai.py`
- Modify: `backend/tests/unit/conftest.py`
- Test: `backend/tests/unit/test_seed_probast_ai.py`,
  `backend/tests/integration/test_seed_convergence.py` (new)

**Interfaces:**

- Consumes: `_SECTIONS`, `_PROBAST_AI_TEMPLATE_ID`.
- Produces: `seed_probast_ai(session)` that updates an existing row in place
  and replaces its entity types, instead of returning early.

- [ ] **Step 1: write the failing tests**

Unit, against a capturing double that reports an existing row and records the
`delete()` statement:

```python
@pytest.mark.asyncio
async def test_converges_onto_an_existing_row() -> None:
    session = ConvergingSession()
    await seed_probast_ai(session)
    # the template ROW is never re-added (deleting it would SET NULL every
    # clone's global_template_id); it is mutated in place
    assert not [o for o in session.added if isinstance(o, ExtractionTemplateGlobal)]
    assert session.existing.version == "2.1.0"
    assert "scope_rules" in session.existing.schema_
    # children are replaced, not merged
    assert len(session.deletes) == 1
    assert len(_of(session, ExtractionEntityType)) == 13
    assert len(_of(session, ExtractionField)) == 95
```

Integration, against the real database (the claim that matters — the unit
double cannot prove the DELETE actually scopes to the global template):

```python
@pytest.mark.asyncio
async def test_seed_is_idempotent_and_code_authoritative(db_session) -> None:
    await seed_probast_ai(db_session)
    await db_session.commit()
    first = await _snapshot(db_session)

    # a manual prod-style UPDATE is reverted by the next boot
    await db_session.execute(
        update(ExtractionTemplateGlobal)
        .where(ExtractionTemplateGlobal.id == _PROBAST_AI_TEMPLATE_ID)
        .values(version="9.9.9", schema_={})
    )
    await db_session.commit()

    await seed_probast_ai(db_session)
    await db_session.commit()
    assert await _snapshot(db_session) == first


@pytest.mark.asyncio
async def test_convergence_leaves_project_clones_untouched(db_session, ...) -> None:
    # clone the global template into a project, then re-seed
    # the clone's template row, entity types and fields are byte-identical
```

- [ ] **Step 2: run them and watch them fail**

Run: `cd backend && uv run pytest tests/unit/test_seed_probast_ai.py -q -k converge`
Expected: FAIL — the seed early-returns, so nothing is added.

- [ ] **Step 3: implement convergence**

```python
async def seed_probast_ai(session: AsyncSession) -> None:
    """Seeds the PROBAST+AI 2.1.0 template (13 sections, 95 fields).

    Converges UNCONDITIONALLY: an existing row is updated in place and its
    children replaced on every boot, so a corrected ``derived_judgments`` or
    ``scope_rules`` spec reaches an existing database without a version bump.
    ``version`` is display metadata, never a gate — gating on it would
    reintroduce the forgotten-bump silent no-op this replaces.

    The template ROW is never deleted: dropping it would SET NULL every
    clone's ``global_template_id`` and break clone dedupe. Global entity types
    are referenced by nothing but their own fields (clones copy; runs pin
    clone snapshots), so replacing them is safe.
    """
    template = await session.get(ExtractionTemplateGlobal, _PROBAST_AI_TEMPLATE_ID)
    if template is None:
        template = ExtractionTemplateGlobal(id=_PROBAST_AI_TEMPLATE_ID)
        session.add(template)
    else:
        await session.execute(
            delete(ExtractionEntityType).where(
                ExtractionEntityType.template_id == _PROBAST_AI_TEMPLATE_ID
            )
        )
        await session.flush()

    template.name = "PROBAST+AI"
    template.description = _DESCRIPTION
    template.framework = "CUSTOM"
    template.version = "2.1.0"
    template.kind = TemplateKind.QUALITY_ASSESSMENT.value
    template.schema_ = {
        "derived_judgments": _PAI_DERIVED_JUDGMENTS,
        "scope_rules": _PAI_SCOPE_RULES,
    }
    ...
```

Also grow `CapturingSession` with the `execute` and `flush` the new path
calls, and add a `ConvergingSession` double.

- [ ] **Step 4: run the gates**

Run: `cd backend && uv run pytest tests/unit/test_seed_probast_ai.py -q`
then `make test-backend` for the integration test.
Expected: PASS.

- [ ] **Step 5: retire the stale docstring caveat and commit**

```bash
git commit -am "feat(seed): converge the PROBAST+AI template on every boot"
```

### Task 5: harden the whole diff

- [ ] `/simplify`, `code-review`, `/security-review` on the diff.
- [ ] `make quality-scan` and read the output.
- [ ] `cd backend && make test-backend`.

---

## PR2–PR5 (queued, not shipped in this run)

- **PR2 — backend consumers.** `out_of_scope_sections(schema, values_by_coord)`
  and `scope_filtered_values` in `derived_judgment_service`; the AI-path guard
  at the single eligible-field assembly point in `section_extraction_service`,
  resolving the classifier from the run's newest proposal on the classifier
  coordinate; `state="out-of-scope"` stamped by `derived_judgment_payload`
  (wire contract — assert the literal); export parity via
  `scope_filtered_values` before `compute_derived_judgments`; the run view's
  nullable `general_instructions`, read through the same
  `general_instructions_for_version` the prompts call. This is the train's
  contract change: regenerate `frontend/types/api/*` and the hand-mirrored
  `hooks/runs/types.ts`.
- **PR3 — frontend.** `schema_` added to the template selects in
  `qaTemplateService` and the shared project-template query; `studyTypeScope`
  rewritten data-driven (`outOfScopeSections(scopeRules, studyTypeValue)`);
  progress filtered by filtering the `entityTypes` projection at the two QA
  call sites, with `computeRequiredFieldProgress` itself untouched; collapsed
  muted out-of-scope sections that stay editable; the "Not applicable" banner
  and chip state; the Step-1 PICOTS disclosure; flag-gated NI in `FieldInput`
  plus the config-editor toggle.
- **PR4 — finalize backstop.** `DivergenceRationaleError` raised in
  `RunLifecycleService.advance` at `target == FINALIZED`, from
  `build_derived_judgments_payload` over the published states.
- **PR5 — `useProjectQATemplate` to TanStack Query.**
