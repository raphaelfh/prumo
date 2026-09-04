---
status: in_progress
last_reviewed: 2026-09-03
owner: '@raphaelfh'
---

# The entry noun on every repeating section — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every repeating section (`cardinality='many'`, container included) is created with a non-blank entry noun; no surface assumes `model`; legacy rows with a null noun read as `entry` everywhere; the two seeded groups that shipped without a noun carry theirs on fresh databases (seed) and on existing ones (migration 0068, global catalogue rows only).

**Architecture:** PR 2 of the entry-group follow-up train ([spec §5](../specs/2026-09-03-entry-group-followup-train-design.md)). The backend rule lives in `SectionCreateRequest`'s model validator (one place, every role); the one backend fallback is `app.models.extraction.DEFAULT_ENTRY_LABEL = "entry"`, which the exports, the portable importer, the model pipeline and the entry-group pipeline all import (the service-local `DEFAULT_ENTRY_NOUN` duplicate is deleted). The frontend mirrors it with one constant, `DEFAULT_ENTRY_NOUN` in `frontend/lib/extraction/entryKey.ts`, replacing every literal fallback (the ten `'model'` sites plus the four `'entry'` literals that already existed) and serving as the noun input's placeholder, so the word is spelled once per side. `AddSectionDialog` shows and requires the noun whenever the form's cardinality is `many`. The Undo-after-delete replay posts the fallback noun for a legacy repeating section whose row carried NULL, so the new rule cannot strand a deleted subtree. `template_diff._DEFAULT_ENTRY_LABEL` stays `model` on purpose: it reproduces the B-8 default that pre-B-8 snapshots omit (the trees spec deletes it with those snapshots).

**Panel reconciliation (2026-09-03):** five lenses reviewed the first draft; every blocking finding is folded in below — no production constant for the seeded nouns (a test-only constant is a new vulture finding; the test derives the set from the seed run instead), the undo-replay fallback, migration-test counts scoped to fixture rows (the UPDATE is table-wide and the shared local DB holds real NULL-noun rows), two more export tests that pin the old fallback, the Radix pointer-capture stubs jsdom lacks, the architecture reference's migration-head line, and four stale comments.

**Tech Stack:** FastAPI + Pydantic v2 (schema validator), SQLAlchemy 2.0 async + Alembic (data migration 0068), pytest; React 19 + react-hook-form + zod v3 + Vitest; the in-house copy module `frontend/lib/copy/`.

## Global Constraints

- Migration revision id ≤ 32 chars: `0068_seeded_entry_nouns` (23). Idempotent; downgrade is a no-op. Global rows only (`template_id IS NOT NULL`), never a clone (versioned config; the 0067 lesson).
- `test_alembic_head_is_expected_revision` head-pin bumped in the same change as the migration; it runs on a per-pid scratch database, so the shared local DB is never stamped by this work (a peer session is live on it).
- Migration touching `extraction_*` ⇒ bump the migration-head line in `docs/reference/extraction-hitl-architecture.md` (`.claude/rules/backend.md` § Migrations).
- No hardcoded UI copy: every string through `frontend/lib/copy/`; `python3 scripts/fitness/check_copy_keys.py` must stay green (every key referenced; deleted keys removed from the file).
- `bash scripts/generate_api_types.sh` after any schema docstring/field change, output committed (CI `API Contract` job diffs it).
- knip (`npx knip --no-tag-hints` and `npx knip --production --no-tag-hints`) at zero findings; vulture baseline never grows (vulture scans `app/` only, so a constant read solely by tests is a finding); mypy ratchet green; `make lint-backend` green.
- React Compiler rules: `useWatch`, not `form.watch`; no `try/finally`/`throw` in component bodies.
- TDD: each task writes its failing test first and quotes the red run before the implementation. No task commits a red test.
- Commits are conventional; the PR targets `dev` and squash-merges; one armed auto-merge at a time.

---

### Task 1: The noun is required at creation on every repeating section (backend schema)

**Files:**

- Modify: `backend/app/schemas/template_structure.py:266-274` (`SectionEntryLabel` comment), `:285-340` (`SectionCreateRequest` docstring + `_enforce_container_rules` → `_enforce_entry_label_rules`), `:386-393` (`SectionRead` comment); `backend/app/services/template_section_service.py:172-173` (stale comment)
- Test: `backend/tests/integration/test_template_section_service.py:216-263` (schema-level class), `:404-446` (integration payloads), `:630-648`

**Interfaces:**

- Produces: `SectionCreateRequest` refuses `cardinality='many'` without a non-blank `entry_label` (message `entry_label is required on a repeating section`); trims it otherwise; still refuses a noun on `cardinality='one'` (`entry_label is only valid for a repeating section`); the container still requires `cardinality='many'`.

- [ ] **Step 1: Rewrite the schema-level tests to the new rule**

Replace the `TestCreateRequestContainerRules` class (and its header comment) in `backend/tests/integration/test_template_section_service.py` with:

```python
# =================== SCHEMA-LEVEL ENTRY-NOUN CREATE RULES ===================


class TestCreateRequestEntryLabelRules:
    def test_container_with_cardinality_one_is_rejected(self) -> None:
        with pytest.raises(ValidationError, match="cardinality"):
            make_create(role="model_container", cardinality="one", entry_label="model")

    def test_container_without_entry_label_is_rejected(self) -> None:
        """The container no longer defaults its noun to 'model'."""
        with pytest.raises(ValidationError, match="entry_label is required"):
            make_create(role="model_container", cardinality="many")

    def test_container_blank_entry_label_is_rejected(self) -> None:
        with pytest.raises(ValidationError, match="entry_label is required"):
            make_create(role="model_container", cardinality="many", entry_label="   ")

    def test_container_entry_label_is_kept_trimmed(self) -> None:
        req = make_create(role="model_container", cardinality="many", entry_label=" algorithm ")
        assert req.entry_label == "algorithm"

    def test_entry_label_on_a_non_repeating_study_section_is_rejected(self) -> None:
        with pytest.raises(ValidationError, match="only valid for a repeating"):
            make_create(entry_label="model")

    def test_entry_label_on_a_non_repeating_model_section_is_rejected(self) -> None:
        with pytest.raises(ValidationError, match="only valid for a repeating"):
            make_create(
                role="model_section",
                parent_entity_type_id=str(uuid.uuid4()),
                entry_label="model",
            )

    def test_entry_label_on_a_repeating_section_is_kept_trimmed(self) -> None:
        """Every repeating section is an entry group: the noun rides any
        ``cardinality='many'`` section, not only the container."""
        req = make_create(cardinality="many", entry_label=" predictor ")
        assert req.entry_label == "predictor"
        child = make_create(
            role="model_section",
            parent_entity_type_id=str(uuid.uuid4()),
            cardinality="many",
            entry_label="validation",
        )
        assert child.entry_label == "validation"

    @pytest.mark.parametrize("entry_label", [None, "", "   "])
    def test_repeating_section_without_entry_label_is_rejected_on_every_role(
        self, entry_label: str | None
    ) -> None:
        """A repeating section is created WITH its noun — blank is refused,
        never 'unset': the identification prompt has to name the entry."""
        with pytest.raises(ValidationError, match="entry_label is required"):
            make_create(cardinality="many", entry_label=entry_label)
        with pytest.raises(ValidationError, match="entry_label is required"):
            make_create(
                role="model_section",
                parent_entity_type_id=str(uuid.uuid4()),
                cardinality="many",
                entry_label=entry_label,
            )
```

Then fix the integration payloads in the same file: the `OneContainerError` payload (`name="second_container"`, around line 414) gains `entry_label="model"`; delete `test_create_container_carries_default_entry_label` (its premise — a server default — is gone; the schema class above covers the refusal); in `test_update_entry_label_on_repeating_study_section_accepted` (around line 639) the create payload gains `entry_label="participant"` and `assert created.entry_label is None` becomes `assert created.entry_label == "participant"`.

- [ ] **Step 2: Run the schema class to verify it fails**

Run: `cd backend && uv run pytest tests/integration/test_template_section_service.py -k "TestCreateRequestEntryLabelRules" -q`
Expected: FAIL — `test_container_without_entry_label_is_rejected`, `test_container_blank_entry_label_is_rejected` and every parametrization of `test_repeating_section_without_entry_label_is_rejected_on_every_role` raise no `ValidationError` (the current validator defaults or accepts).

- [ ] **Step 3: Implement the rule**

In `backend/app/schemas/template_structure.py`, replace the `entry_label` paragraph of the `SectionCreateRequest` docstring with:

```python
    ``entry_label`` is a repeating section's entry noun (B-8, D3 — unlocked
    from the container in the entry-group train): REQUIRED, non-blank, on
    every ``cardinality='many'`` section, container included, and refused
    on a section that does not repeat. Rows created before the noun was
    required may still carry NULL; every reader falls back to
    :data:`app.models.extraction.DEFAULT_ENTRY_LABEL` for them.
```

and replace `_enforce_container_rules` with:

```python
    @model_validator(mode="after")
    def _enforce_entry_label_rules(self) -> "SectionCreateRequest":
        """A repeating section is created WITH its entry noun — the
        identification prompt and the run form read it — so a blank one is
        refused on every role; a section that does not repeat cannot carry
        one. The container always repeats ('many' is enforced, never chosen)."""
        if self.role == "model_container" and self.cardinality != "many":
            raise ValueError("model_container cardinality must be 'many'")
        if self.cardinality == "many":
            noun = (self.entry_label or "").strip()
            if not noun:
                raise ValueError("entry_label is required on a repeating section")
            self.entry_label = noun
        elif self.entry_label is not None:
            raise ValueError("entry_label is only valid for a repeating section")
        return self
```

Comments that describe the old default, rewritten in the same step:

- `SectionEntryLabel` (`template_structure.py:266-270`): `# The entry noun on updates: when provided it must survive a trim (a blanked input is a frontend no-op, never an API write). The create side enforces the same non-blank rule in ``_enforce_entry_label_rules``.`
- `SectionRead`: `# Entry noun (B-8): every repeating section is created with one; legacy rows may be NULL.`
- `template_section_service.py:172-173`: `# Post-validator value: the trimmed noun on a repeating section, None on every other (the schema refuses it there).`

- [ ] **Step 4: Run the file to verify it passes**

Run: `cd backend && uv run pytest tests/integration/test_template_section_service.py tests/unit/test_template_structure_endpoints.py -q`
Expected: PASS (the endpoint unit tests build a `cardinality="one"` body and are untouched).

- [ ] **Step 5: Commit**

```bash
git add backend/app/schemas/template_structure.py backend/app/services/template_section_service.py backend/tests/integration/test_template_section_service.py
git commit -m "feat(templates): the entry noun is required at creation on every repeating section"
```

### Task 2: One backend fallback — `entry` — for legacy rows

**Files:**

- Modify: `backend/app/models/extraction.py:64-67` (`DEFAULT_ENTRY_LABEL`), `backend/app/services/entry_group_extraction.py:42-44,156` (delete `DEFAULT_ENTRY_NOUN`), `backend/app/services/template_portable_service.py:235-239` (import default)
- Test: `backend/tests/unit/test_model_extraction_service.py:1011-1024`, `backend/tests/unit/test_extraction_export_tidy_model_section.py:118-142,195-210`, `backend/tests/unit/test_extraction_export_tidy_tables_projection.py:83-103`, `backend/tests/integration/test_template_portable_service.py:190-200`

**Interfaces:**

- Produces: `app.models.extraction.DEFAULT_ENTRY_LABEL == "entry"`; `entry_group_extraction` imports it (no `DEFAULT_ENTRY_NOUN`); the portable importer writes `entry_label or DEFAULT_ENTRY_LABEL` on every repeating section (group or `repeats: true`), `None` otherwise.

- [ ] **Step 1: Update the tests that pin the fallback**

`backend/tests/unit/test_model_extraction_service.py`: rename `test_old_snapshot_without_entry_label_falls_back_to_model` → `..._falls_back_to_entry` and `test_empty_pinned_tree_falls_back_to_model` → `..._falls_back_to_entry`; both expect `"Entry 1"`; comments say the one legacy fallback is `entry` (the explicit-`"model"` test `test_unnamed_model_label_default_noun_matches_legacy` is unchanged — it passes the noun).

`backend/tests/unit/test_extraction_export_tidy_model_section.py`: the no-container test at :118-142 (sections tuple `(section,)`) now expects `"Gaca, 2011 — Entry 1"` / `"Gaca, 2011 — Entry 2"`; rename `test_model_section_stem_falls_back_to_model_without_entry_label` (:195) → `test_model_section_stem_falls_back_to_entry_without_entry_label`, docstring `Pre-0051 snapshots carry no entry_label key (None) — the stem falls back to the one legacy noun, 'entry'.`, expected labels `"Gaca, 2011 — Entry 1"`, `"Gaca, 2011 — Entry 2"`.

`backend/tests/unit/test_extraction_export_tidy_tables_projection.py:83-103`: the `(model,)`-only projection expects a label ending in `"Entry 1"`.

`backend/tests/integration/test_template_portable_service.py` (`test_import_derives_roles_and_template_wide_sort_order`): the `grp` tuple expects `"entry"` instead of `"model"`, and add after the `child` assertion:

```python
    # A repeating section imported without a noun is created with the one
    # fallback noun — never left NULL, never 'model'.
    assert by_name["child"].entry_label == "entry"
    assert by_name["tail"].entry_label is None
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd backend && uv run pytest tests/unit/test_model_extraction_service.py -k "falls_back_to_entry" tests/unit/test_extraction_export_tidy_model_section.py tests/unit/test_extraction_export_tidy_tables_projection.py tests/integration/test_template_portable_service.py -k "derives_roles or falls_back_to_entry or stem or projection" -q`
Expected: FAIL — `"Model 1"` / `"Gaca, 2011 — Model 1"` / `"model"` and `None` where `"entry"` is expected.

- [ ] **Step 3: Implement**

`backend/app/models/extraction.py`:

```python
# The noun a repeating section's entries read as when ``entry_label`` is
# NULL — rows created before the noun was required at creation and pre-B-8
# snapshots. New sections are created with a noun (SectionCreateRequest)
# and the seeded groups carry theirs (seed + 0068); the AI instance label,
# the export record stem, the portable importer and the entry-group
# pipeline all fall back to this one value, so it lives here once.
DEFAULT_ENTRY_LABEL = "entry"
```

`backend/app/services/entry_group_extraction.py`: delete the `DEFAULT_ENTRY_NOUN` constant and its `#:` comment; add `from app.models.extraction import DEFAULT_ENTRY_LABEL` to the runtime imports (the `ExtractionRun` import stays under `TYPE_CHECKING`); line 156 becomes `entry_label = getattr(entity_type, "entry_label", None) or DEFAULT_ENTRY_LABEL`.

`backend/app/services/template_portable_service.py`:

```python
        entry_label=(
            (section.entry_label or DEFAULT_ENTRY_LABEL) if (is_group or section.repeats) else None
        ),
```

- [ ] **Step 4: Run the affected suites**

Run: `cd backend && uv run pytest tests/unit/test_model_extraction_service.py tests/unit/test_extraction_export_tidy_model_section.py tests/unit/test_extraction_export_tidy_tables_projection.py tests/unit/test_extraction_export_snapshot_sections.py tests/unit/test_extraction_export_load_sections.py tests/integration/test_template_portable_service.py tests/integration/test_entry_group_extraction.py -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/models/extraction.py backend/app/services/entry_group_extraction.py backend/app/services/template_portable_service.py backend/tests
git commit -m "refactor(extraction): one backend fallback noun, entry, for legacy repeating sections"
```

### Task 3: Seeds carry the nouns, pinned without a database

**Files:**

- Modify: `backend/app/seed.py:87-88` (`_EntitySpec` comment), `:395-403` (final_predictors spec), `:2266-2280` (numeric_performance spec)
- Create: `backend/tests/unit/test_seed_entry_nouns.py`

**Interfaces:**

- Consumes: `tests.unit.conftest.CapturingSession` (records `add`, `get` → `None`; both seeds call only `get` + `add`), `app.llm.prompts.entry_identification.render(...)` keyword-only.
- Produces: the seeded repeating sections carry `{("prediction_models", "model"), ("final_predictors", "predictor"), ("numeric_performance", "validation")}` — derived from the seed run in the test, no production constant (vulture scans `app/` only; a test-only constant is a new finding and spec §9 forbids a new baseline entry). Task 4 appends the migration pin to this test file.

- [ ] **Step 1: Write the failing test**

`backend/tests/unit/test_seed_entry_nouns.py`:

```python
"""The seed's entry-noun declarations, read WITHOUT touching a database.

``app.seed`` early-returns on an existing template, so a DB-backed assertion
would test whichever seed happened to run against the shared stack (the
``test_seed_entity_keys`` argument). The seeds run against the recording
session instead; migration 0068's own test pins the database state.
"""

from __future__ import annotations

import pytest

from app.llm.prompts import entry_identification
from app.models.extraction import ExtractionEntityType
from app.seed import seed_charms, seed_charms_mm
from tests.unit.conftest import CapturingSession

# One pair covers both containers: CHARMS and CHARMS + Multimodal name the
# section identically. The container's noun rode B-8's 0051 backfill; the
# other two are what migration 0068 stamps onto existing global rows.
EXPECTED_NOUNS = frozenset(
    {
        ("prediction_models", "model"),
        ("final_predictors", "predictor"),
        ("numeric_performance", "validation"),
    }
)
BACKFILLED_BY_0068 = EXPECTED_NOUNS - {("prediction_models", "model")}


async def seeded_entity_types() -> list[ExtractionEntityType]:
    rows: list[ExtractionEntityType] = []
    for seed in (seed_charms, seed_charms_mm):
        session = CapturingSession()
        await seed(session)
        rows.extend(o for o in session.added if isinstance(o, ExtractionEntityType))
    return rows


@pytest.mark.asyncio
async def test_every_seeded_repeating_section_carries_its_noun() -> None:
    rows = await seeded_entity_types()
    repeating = {(r.name, r.entry_label) for r in rows if r.cardinality == "many"}
    assert repeating == EXPECTED_NOUNS
    assert all(r.entry_label is None for r in rows if r.cardinality != "many")


@pytest.mark.asyncio
async def test_seeded_noun_reaches_the_identification_prompt() -> None:
    predictors = next(r for r in await seeded_entity_types() if r.name == "final_predictors")
    assert predictors.entry_label is not None
    prompt = entry_identification.render(
        group_label=predictors.label,
        entry_label=predictors.entry_label,
        key_label="Predictor name",
        article_text="…",
    )
    assert "identify every predictor it describes" in prompt
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd backend && uv run pytest tests/unit/test_seed_entry_nouns.py -q`
Expected: FAIL — the repeating set holds `("final_predictors", None)` and `("numeric_performance", None)`; the prompt test fails its `is not None` assertion.

- [ ] **Step 3: Implement the seed side**

`backend/app/seed.py` — `_EntitySpec` field comment: `# Entry noun of a repeating section (cardinality 'many'); None otherwise. Reaches only a FRESH database (both seeds early-return on an existing template); migration 0068 stamps the two non-container nouns onto existing global rows, and test_seed_entry_nouns pins the two mechanisms together.`

The CHARMS `final_predictors` `_EntitySpec(...)` (positional, ends with its sort_order) gains a trailing `entry_label="predictor",`; the Multimodal `numeric_performance` spec (keyword style) gains `entry_label="validation",` after `sort_order=13,`.

- [ ] **Step 4: Run the seed tests**

Run: `cd backend && uv run pytest tests/unit/test_seed_entry_nouns.py tests/unit/test_seed_entity_keys.py tests/unit/test_seed_charms_mm.py -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/seed.py backend/tests/unit/test_seed_entry_nouns.py
git commit -m "feat(seed): final_predictors and numeric_performance carry their entry noun"
```

### Task 4: Migration 0068 stamps the two nouns onto global catalogue rows

**Files:**

- Create: `backend/alembic/versions/0068_seeded_entry_nouns.py`
- Create: `backend/tests/integration/test_migration_0068_seeded_entry_nouns.py`
- Modify: `backend/tests/unit/test_seed_entry_nouns.py` (append the migration pin), `backend/tests/integration/test_migration_roundtrip.py:1325` (head pin), `docs/reference/extraction-hitl-architecture.md:137` (migration head line) and `:200` (`extraction_entity_types` row)

**Interfaces:**

- Produces: module constant `UPGRADE_SQL` (one `UPDATE … FROM (VALUES …)`, rows rendered exactly as `('final_predictors', 'predictor')` and `('numeric_performance', 'validation')`), `revision = "0068_seeded_entry_nouns"`, `down_revision = "0067_snapshot_entity_key"`.

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/unit/test_seed_entry_nouns.py`:

```python
def test_migration_0068_stamps_the_same_nouns() -> None:
    """The migration is the only thing that reaches an existing install; a
    noun added to the seed without it would reach fresh databases only."""
    sql = (
        pathlib.Path(__file__).parents[2] / "alembic" / "versions" / "0068_seeded_entry_nouns.py"
    ).read_text()
    for entity_type, noun in BACKFILLED_BY_0068:
        assert f"('{entity_type}', '{noun}')" in sql, (entity_type, noun)
```

(add `import pathlib` to the file's imports.)

`backend/tests/integration/test_migration_0068_seeded_entry_nouns.py` — the UPDATE is table-wide and the shared local database holds the real seeded rows (possibly still NULL-nouned), so every count is scoped to the fixture template and every value assertion is per row:

```python
"""Migration 0068 — the two seeded nouns stamped onto global catalogue rows.

Runs the migration's UPDATE inside the savepoint-isolated ``db_session``.
The statement is table-wide, so the shared local database's own seeded
rows are touched too (and rolled back); every assertion here is scoped to
the rows this test creates.
"""

from __future__ import annotations

import importlib.util
from pathlib import Path
from uuid import UUID, uuid4

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.extraction import ExtractionEntityType, ExtractionTemplateGlobal
from tests.integration.conftest import SEED, clean_project_clones, clone_charms

_MIG_PATH = (
    Path(__file__).resolve().parents[2] / "alembic" / "versions" / "0068_seeded_entry_nouns.py"
)
_spec = importlib.util.spec_from_file_location("mig0068", _MIG_PATH)
assert _spec is not None and _spec.loader is not None
_mig = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_mig)


async def _global_template(db: AsyncSession) -> UUID:
    template = ExtractionTemplateGlobal(
        id=uuid4(), name="0068 fixture", framework="CUSTOM", kind="extraction"
    )
    db.add(template)
    await db.flush()
    return template.id


async def _add(db: AsyncSession, **cols: object) -> UUID:
    row = ExtractionEntityType(
        **{"id": uuid4(), "label": "x", "role": "study_section", "cardinality": "many", **cols}
    )
    db.add(row)
    await db.flush()
    return row.id


async def _noun(db: AsyncSession, row_id: UUID) -> str | None:
    return (
        await db.execute(
            text("SELECT entry_label FROM public.extraction_entity_types WHERE id = :id"),
            {"id": str(row_id)},
        )
    ).scalar_one()


async def _stamped_in(db: AsyncSession, template_id: UUID) -> int:
    return (
        await db.execute(
            text(
                "SELECT count(*) FROM public.extraction_entity_types "
                "WHERE template_id = :tid AND entry_label IS NOT NULL"
            ),
            {"tid": str(template_id)},
        )
    ).scalar_one()


async def _upgrade(db: AsyncSession) -> int:
    result = await db.execute(text(_mig.UPGRADE_SQL))
    await db.flush()
    return result.rowcount


@pytest.mark.asyncio
async def test_stamps_the_two_seeded_groups_on_global_rows(db_session: AsyncSession) -> None:
    tid = await _global_template(db_session)
    predictors = await _add(db_session, template_id=tid, name="final_predictors")
    validations = await _add(db_session, template_id=tid, name="numeric_performance")

    await _upgrade(db_session)

    assert await _noun(db_session, predictors) == "predictor"
    assert await _noun(db_session, validations) == "validation"
    assert await _stamped_in(db_session, tid) == 2


@pytest.mark.asyncio
async def test_skips_clones_named_rows_and_non_repeating_rows(db_session: AsyncSession) -> None:
    """Versioned config on a clone is never touched; a noun a manager typed
    wins; a name match alone (a non-repeating row) is not enough."""
    tid = await _global_template(db_session)
    await clean_project_clones(db_session, SEED.secondary_project)
    clone_tid = (
        await clone_charms(db_session, SEED.secondary_project, SEED.primary_profile)
    ).project_template_id
    clone = await _add(db_session, project_template_id=clone_tid, name="final_predictors")
    named = await _add(db_session, template_id=tid, name="final_predictors", entry_label="feature")
    single = await _add(
        db_session, template_id=tid, name="numeric_performance", cardinality="one"
    )

    await _upgrade(db_session)

    assert await _noun(db_session, clone) is None
    assert await _noun(db_session, named) == "feature"
    assert await _noun(db_session, single) is None
    assert await _stamped_in(db_session, tid) == 1  # only the row that already had a noun


@pytest.mark.asyncio
async def test_is_idempotent(db_session: AsyncSession) -> None:
    tid = await _global_template(db_session)
    predictors = await _add(db_session, template_id=tid, name="final_predictors")

    await _upgrade(db_session)
    assert await _upgrade(db_session) == 0  # nothing left to stamp anywhere

    assert await _noun(db_session, predictors) == "predictor"
```

In `backend/tests/integration/test_migration_roundtrip.py`, change `expected_head = "0067_snapshot_entity_key"` to `expected_head = "0068_seeded_entry_nouns"` (this test runs on a per-pid scratch database; the shared local DB is not stamped).

- [ ] **Step 2: Run them to verify they fail**

Run: `cd backend && uv run pytest tests/integration/test_migration_0068_seeded_entry_nouns.py tests/unit/test_seed_entry_nouns.py -q`
Expected: FAIL at collection — `FileNotFoundError` for the migration path (both files).

- [ ] **Step 3: Write the migration**

`backend/alembic/versions/0068_seeded_entry_nouns.py`:

```python
"""Stamp the entry noun on the two seeded groups that shipped without one.

Every ``cardinality='many'`` section is an entry group whose noun
(``entry_label``) names one of its entries in the identification prompt
and on the run form. CHARMS' ``final_predictors`` and CHARMS +
Multimodal's ``numeric_performance`` shipped before the noun reached
non-container sections, so their global catalogue rows carry NULL and read
as the ``entry`` fallback. ``seed_charms`` / ``seed_charms_mm``
early-return on an existing template, so the seed can never repair an
installation that already holds them — this UPDATE is the only path to
existing databases, prod's global catalogue included
(``test_seed_entry_nouns`` pins it against the seed's declaration).

Global rows only (``template_id IS NOT NULL``; the ``template_xor`` CHECK
makes that the global lineage exactly): the noun is versioned config since
#798, so stamping a project clone without patching its published snapshot
would surface a phantom unpublished change, and Discard would write NULL
back (the 0067 lesson). Global templates carry no snapshot, and a clone
copies every column, so clones made after this migration carry the noun
while earlier clones keep the ``entry`` fallback until a manager names it
in the inspector.

Idempotent: ``entry_label IS NULL`` skips rows already stamped, by an
earlier run or by hand. Downgrade is a no-op: a noun written here is
indistinguishable from one a manager typed, and no reader treats it as
an error.

Revision ID: 0068_seeded_entry_nouns
Revises: 0067_snapshot_entity_key
"""

from alembic import op

revision = "0068_seeded_entry_nouns"
down_revision = "0067_snapshot_entity_key"
branch_labels = None
depends_on = None

UPGRADE_SQL = """
UPDATE public.extraction_entity_types AS et
SET entry_label = nouns.noun
FROM (VALUES ('final_predictors', 'predictor'), ('numeric_performance', 'validation'))
     AS nouns(name, noun)
WHERE et.name = nouns.name
  AND et.template_id IS NOT NULL
  AND et.cardinality = 'many'
  AND et.entry_label IS NULL
"""


def upgrade() -> None:
    op.execute(UPGRADE_SQL)


def downgrade() -> None:
    """Intentionally empty — see the module docstring."""
```

`docs/reference/extraction-hitl-architecture.md`: the migration head line becomes `` `0068_seeded_entry_nouns` `` (keep the surrounding sentence); append to the `extraction_entity_types` row: `0068 stamps the entry noun (`predictor`, `validation`) onto the two seeded global groups that shipped without one; clones are untouched (versioned config).` `last_reviewed` already reads today's date.

- [ ] **Step 4: Run the migration tests and the pins**

Run: `cd backend && uv run pytest tests/integration/test_migration_0068_seeded_entry_nouns.py tests/unit/test_seed_entry_nouns.py tests/integration/test_migration_roundtrip.py -k "history_chain or expected_revision" -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/alembic/versions/0068_seeded_entry_nouns.py backend/tests/integration/test_migration_0068_seeded_entry_nouns.py backend/tests/unit/test_seed_entry_nouns.py backend/tests/integration/test_migration_roundtrip.py docs/reference/extraction-hitl-architecture.md
git commit -m "feat(migrations): 0068 stamps the seeded entry nouns on global catalogue rows"
```

### Task 5: One frontend fallback noun — `DEFAULT_ENTRY_NOUN` — and an undo replay that survives it

**Files:**

- Modify: `frontend/lib/extraction/entryKey.ts` (add the constant), `frontend/components/extraction/ModelSection.tsx:150-151`, `frontend/components/extraction/hierarchy/ModelSelector.tsx:9,91`, `frontend/components/extraction/hierarchy/AddModelDialog.tsx:43`, `frontend/components/extraction/hierarchy/RemoveModelDialog.tsx:53`, `frontend/components/extraction/template-config/templateTree.ts:147-150,320`, `frontend/pages/ExtractionFullScreen.tsx:804,1292,1300,1320`, `frontend/components/extraction/InstanceCard.tsx:77`, `frontend/components/extraction/SectionAccordion.tsx:83`, `frontend/hooks/extraction/useAddEntry.ts:147`, `frontend/components/extraction/template-config/sectionRestore.ts:195-205`, `frontend/types/extraction.ts:88-93` (comment)
- Test: `frontend/components/extraction/template-config/templateTree.test.ts:245-283`, `frontend/components/extraction/hierarchy/entryLabelNoun.test.tsx:45-48`, `frontend/components/extraction/template-config/sectionRestore.test.ts`

**Interfaces:**

- Produces: `export const DEFAULT_ENTRY_NOUN = 'entry'` from `@/lib/extraction/entryKey`; every `entry_label ?? …` fallback and every `entryLabel = …` default parameter reads it; `replaySection` posts `section.cardinality === 'many' ? (section.entryLabel ?? DEFAULT_ENTRY_NOUN) : null` so a deleted legacy repeating section (NULL noun on every pre-0068 clone) is recreated instead of 422-ing — B-9d deletes without confirm, so a failed replay would strand its fields.

- [ ] **Step 1: Flip the two tests that pin `'model'` and add the replay case**

`templateTree.test.ts`: the two test names become `falls back entryNoun to "entry" when entry_label is null or absent` and `gives root sections the total fallback entryNoun "entry" (unused but total)`; the four `toBe('model')` assertions become `toBe('entry')`.

`entryLabelNoun.test.tsx`: the fallback test becomes

```tsx
  it('ModelSelector falls back to the "entry" noun without the prop', () => {
    render(<ModelSelector {...selectorBase} models={[]} activeModelId={null} />);
    expect(screen.getByText('No entry added yet')).toBeInTheDocument();
  });
```

`sectionRestore.test.ts`, inside `describe('replaySection')`:

```tsx
  it('posts the fallback noun for a legacy repeating section whose row carried none', async () => {
    // Every clone made before 0068 still has NULL on final_predictors /
    // numeric_performance; the create rule now requires a noun, so the
    // replay must supply the one every reader already falls back to.
    const legacy = {
      ...GROUP,
      id: 'legacy',
      name: 'final_predictors',
      role: 'model_section',
      parent_entity_type_id: null,
      entry_label: null,
      fields: [],
    } as unknown as TemplateEntityTypeWithFields;
    const snapshot = captureSection([legacy], 'legacy')!;
    const d = deps();
    vi.mocked(d.createSection).mockResolvedValue({ok: true, data: {id: 'new-legacy'}});

    await replaySection(snapshot, d);

    expect(d.createSection).toHaveBeenCalledWith(
      expect.objectContaining({cardinality: 'many', entryLabel: 'entry'}),
    );
  });
```

(`captureSection`'s first argument is the entity-type list the existing tests pass as `TREE`; match its signature.)

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run frontend/components/extraction/template-config/templateTree.test.ts frontend/components/extraction/hierarchy/entryLabelNoun.test.tsx frontend/components/extraction/template-config/sectionRestore.test.ts`
Expected: FAIL — `'model'` received where `'entry'` is expected; `No entry added yet` not found; the replay posts `entryLabel: null`.

- [ ] **Step 3: Add the constant and replace the sites**

Append to `frontend/lib/extraction/entryKey.ts`:

```ts
/**
 * The noun a repeating section's entries read as when its `entry_label` is
 * null — rows created before the noun was required at creation. Mirrors the
 * backend's `DEFAULT_ENTRY_LABEL`; every `{{noun}}` fallback and the noun
 * input's placeholder resolve here.
 */
export const DEFAULT_ENTRY_NOUN = 'entry';
```

Then, importing `DEFAULT_ENTRY_NOUN` from `@/lib/extraction/entryKey` in each file:

- `ModelSection.tsx`: `entryLabel={modelContainer.entry_label ?? DEFAULT_ENTRY_NOUN}`; the comment reads `(fallback DEFAULT_ENTRY_NOUN)`.
- `ModelSelector.tsx`: `entryLabel = DEFAULT_ENTRY_NOUN,`; the header comment `(default 'model')` → `(default DEFAULT_ENTRY_NOUN)`.
- `AddModelDialog.tsx`: `entryLabel = DEFAULT_ENTRY_NOUN,`.
- `RemoveModelDialog.tsx`: `entryLabel = DEFAULT_ENTRY_NOUN`.
- `templateTree.ts`: `const entryNoun = (isGroup ? entityType.entry_label : null) ?? DEFAULT_ENTRY_NOUN;` and the `entryNoun` doc comment: ``a group's own `entry_label ?? DEFAULT_ENTRY_NOUN`; a groupChild inherits the PARENT group's resolved noun; roots carry the fallback (unused but total).``
- `ExtractionFullScreen.tsx`: lines 804, 1292, 1300, 1320 → `?? DEFAULT_ENTRY_NOUN`.
- `InstanceCard.tsx:77`: `entryLabel = DEFAULT_ENTRY_NOUN,`.
- `SectionAccordion.tsx:83`: `const entryLabel = entityType.entry_label ?? DEFAULT_ENTRY_NOUN;`.
- `useAddEntry.ts:147`: `entryLabel: entityType?.entry_label ?? DEFAULT_ENTRY_NOUN,`.
- `sectionRestore.ts` (`replaySection`): `entryLabel: section.cardinality === 'many' ? (section.entryLabel ?? DEFAULT_ENTRY_NOUN) : null,` with the comment `// The create rule requires a noun on a repeating section; a legacy row that carried none is replayed with the fallback every reader already uses.`
- `frontend/types/extraction.ts:88-93` comment: `Entry noun (B-8, entry-group train): set on every repeating section created since the noun became required; NULL on legacy rows, which consumers read through DEFAULT_ENTRY_NOUN. Required (not optional) so hand-written mirrors and adapters cannot silently drop it.`

- [ ] **Step 4: Run the tests, the typecheck and the literal sweep**

Run: `npx vitest run frontend/components/extraction frontend/hooks && npm run typecheck && grep -rn "?? 'model'\|?? 'entry'\|= 'model'\|= 'entry'" frontend --include='*.ts' --include='*.tsx' | grep -v "\.test\.\|lib/copy\|schema.d.ts\|e2e/\|AiConfigDialog\|GenerationDetailsDialog"`
Expected: vitest PASS, tsc clean, and the grep prints only `frontend/lib/extraction/entryKey.ts` (the constant's own definition) plus `AddSectionDialog.tsx:123`, which Task 6 removes.

- [ ] **Step 5: Commit**

```bash
git add frontend/lib/extraction/entryKey.ts frontend/components frontend/pages frontend/hooks frontend/types/extraction.ts
git commit -m "refactor(extraction): one frontend fallback noun, entry, replaces the model default"
```

### Task 6: `AddSectionDialog` asks for the noun whenever the section repeats; strings through copy

**Files:**

- Modify: `frontend/components/extraction/dialogs/AddSectionDialog.tsx`, `frontend/lib/copy/extraction.ts:565-567`, `frontend/lib/copy/templateConfig.ts:191-198`, `frontend/components/extraction/template-config/TemplateInspectorSectionPane.tsx:219-223`, `frontend/services/templateService.ts:527-528` (comment)
- Test: `frontend/components/extraction/dialogs/AddSectionDialog.test.tsx`, `frontend/components/extraction/template-config/TemplateInspectorSectionPane.test.tsx:103-114`

**Interfaces:**

- Consumes: `DEFAULT_ENTRY_NOUN` (Task 5), `createSection({… entryLabel?: string …})`.
- Produces: copy keys `extraction.sectionLabelHint`, `extraction.sectionNameLabel`, `extraction.sectionNameHint`, `extraction.sectionNameAutoGenerated`, `extraction.sectionRequiredHint`, `templateConfig.entryLabelRequired`; `templateConfig.entryLabelPlaceholder` and `templateConfig.entryLabelPlaceholderEntry` are deleted — the noun input's placeholder is `DEFAULT_ENTRY_NOUN` itself (the fallback a legacy blank reads as, spelled once); `extraction.creating` reused.

- [ ] **Step 1: Write the failing tests**

In `AddSectionDialog.test.tsx`, add after the imports the pointer-capture stubs Radix Select needs in jsdom (mirrors `FieldInput.clearedDisplay.test.tsx`):

```tsx
// Radix Select drives its listbox through pointer-capture APIs jsdom does not
// implement; without these the trigger never opens. Scoped to this file.
beforeAll(() => {
  Element.prototype.hasPointerCapture = vi.fn(() => false);
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
  Element.prototype.scrollIntoView = vi.fn();
});
```

(import `beforeAll` from vitest.) Then:

- group mode: `screen.getByPlaceholderText('model')` → `screen.getByPlaceholderText('entry')`; replace the test `omits a BLANK entry label so the server defaults the noun` with

```tsx
  it('refuses a blank entry label — there is no server default to fall back to', async () => {
    renderDialog({kind: 'group'});
    await userEvent.type(labelInput(), 'Models compared');
    await submit();
    expect(
      await screen.findByText('Entry label is required for a repeating section'),
    ).toBeInTheDocument();
    expect(createSection).not.toHaveBeenCalled();
  });
```

- root mode: add

```tsx
  it('asks for the entry label once the section repeats, requires it, and posts it', async () => {
    const user = userEvent.setup();
    renderDialog({kind: 'root'});
    expect(screen.queryByText('Entry label')).toBeNull();
    await user.click(screen.getByRole('combobox'));
    await user.click(screen.getByRole('option', {name: /Multiple sections/}));
    const entryLabel = await screen.findByPlaceholderText('entry');
    await user.type(labelInput(), 'Study arms');
    await submit();
    expect(
      await screen.findByText('Entry label is required for a repeating section'),
    ).toBeInTheDocument();
    expect(createSection).not.toHaveBeenCalled();
    await user.type(entryLabel, ' arm ');
    await submit();
    await waitFor(() => expect(createSection).toHaveBeenCalledTimes(1));
    expect(createSection).toHaveBeenCalledWith(
      expect.objectContaining({role: 'study_section', cardinality: 'many', entryLabel: 'arm'}),
    );
  });

  it('renders the technical-name hints through copy', () => {
    renderDialog({kind: 'root'});
    expect(screen.getByText('Technical name *')).toBeInTheDocument();
    expect(screen.getByText(/Unique internal name \(snake_case\)\./)).toBeInTheDocument();
    expect(screen.getByText(/Auto-generated\./)).toBeInTheDocument();
  });
```

In `TemplateInspectorSectionPane.test.tsx`, the placeholder test keeps `expect(input.placeholder).toBe('entry')`; in the group test (`ownEntryLabel: 'validation', entryNoun: 'model'`, line 103) add `expect(input.placeholder).toBe('entry');` — the group no longer advertises `model`.

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run frontend/components/extraction/dialogs/AddSectionDialog.test.tsx frontend/components/extraction/template-config/TemplateInspectorSectionPane.test.tsx`
Expected: FAIL — placeholder `entry` not found in group mode; no required message; `Entry label` never appears in root mode; the group placeholder is still `model`.

- [ ] **Step 3: Copy keys**

`frontend/lib/copy/extraction.ts`, after `sectionCreateError`:

```ts
    sectionLabelHint: 'Name shown in the UI for users',
    sectionNameLabel: 'Technical name *',
    sectionNameHint: 'Unique internal name (snake_case).',
    sectionNameAutoGenerated: 'Auto-generated.',
    sectionRequiredHint: 'When enabled, this section must be filled for all articles',
```

`frontend/lib/copy/templateConfig.ts`, replacing the `entryLabelHint` … `entryLabelPlaceholderEntry` block (both placeholder keys deleted):

```ts
  entryLabelHint: 'What reviewers call one entry of this section (e.g. model, arm, validation).',
  entryLabelLabel: 'Entry label',
  entryLabelMax50: 'Entry label must have at most 50 characters',
  entryLabelRequired: 'Entry label is required for a repeating section',
```

`TemplateInspectorSectionPane.tsx:219-223`: `placeholder={DEFAULT_ENTRY_NOUN}` (import from `@/lib/extraction/entryKey`).

`frontend/services/templateService.ts:527-528` comment: `/** Entry noun (B-8 D3, entry-group train): required by the server on every repeating section, refused on one that does not repeat. */`

- [ ] **Step 4: The dialog**

In `AddSectionDialog.tsx`:

- import `DEFAULT_ENTRY_NOUN` from `@/lib/extraction/entryKey`; `const noun = mode.kind === 'perModel' ? mode.entryNoun : DEFAULT_ENTRY_NOUN;`
- schema: keep the object, append

```ts
}).superRefine((data, ctx) => {
  // A repeating section is created WITH its entry noun (the server 422s a
  // blank one); a section that repeats once carries none.
  if (data.cardinality === 'many' && !data.entry_label?.trim()) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['entry_label'],
      message: t('templateConfig', 'entryLabelRequired'),
    });
  }
});
```

- watch: `const cardinality = useWatch({control: form.control, name: 'cardinality'});` and `const repeats = cardinality === 'many';` (group mode's default is `'many'`).
- submit: `cardinality: data.cardinality,` and `entryLabel: data.cardinality === 'many' ? data.entry_label?.trim() : undefined,` (drop the "omit so the server defaults" comment).
- layout: move the cardinality `FormField` block above the description block; render the entry-label block right after it, guarded by `repeats` (in group mode there is no cardinality block, so the noun follows the technical name as today), with `placeholder={DEFAULT_ENTRY_NOUN}`. Comment: `Entry label — every repeating section is created with its noun: what one entry is called in the prompts and on the run form; the placeholder is the fallback a legacy blank reads as.`
- strings: `Name shown in the UI for users` → `{t('extraction', 'sectionLabelHint')}`; `Technical name *` → `{t('extraction', 'sectionNameLabel')}`; `Unique internal name (snake_case). {autoGenerateName && 'Auto-generated.'}` → `{t('extraction', 'sectionNameHint')} {autoGenerateName && t('extraction', 'sectionNameAutoGenerated')}`; `When enabled, this section must be filled for all articles` → `{t('extraction', 'sectionRequiredHint')}`; `Creating...` → `{t('extraction', 'creating')}`.
- header comment: group mode `Label + Entry label + Description`; root and per-model modes `the entry label appears once the cardinality select says many`, and the schema requires it then.

- [ ] **Step 5: Run the tests and the copy-key gate**

Run: `npx vitest run frontend/components/extraction/dialogs frontend/components/extraction/template-config && python3 scripts/fitness/check_copy_keys.py && npm run typecheck && npm run lint`
Expected: PASS, copy-key gate green (no unreferenced key), tsc and eslint clean.

- [ ] **Step 6: Commit**

```bash
git add frontend/components/extraction/dialogs/AddSectionDialog.tsx frontend/components/extraction/dialogs/AddSectionDialog.test.tsx frontend/components/extraction/template-config frontend/lib/copy frontend/services/templateService.ts
git commit -m "feat(templates): the add-section dialog asks for the entry noun on every repeating section"
```

### Task 7: Contract, gates, spec and plan registration

**Files:**

- Modify: `frontend/types/api/openapi.json`, `frontend/types/api/schema.d.ts` (regenerated), `.markdownlintignore` (this plan), `docs/superpowers/specs/2026-09-03-entry-group-followup-train-design.md` §5 (record the reconciled deltas)

- [ ] **Step 1: Regenerate the API contract**

Run: `bash scripts/generate_api_types.sh && git diff --stat frontend/types/api/`
Expected: only the `SectionCreateRequest` description text changes (the docstring rewrite in Task 1).

- [ ] **Step 2: Register the plan with docs-ci and record the deltas in the spec**

Append `docs/superpowers/plans/2026-09-03-entry-noun-every-repeating-section.md` to `.markdownlintignore` (the workflow reads it via `--ignore-path`).

In spec §5, amend: the seeded-noun pin derives the set from the seed run instead of a `SEEDED_ENTRY_NOUNS` constant (a test-only constant is a vulture finding); the containers share one `(prediction_models, model)` pair, so there are three distinct pairs; `entry_group_extraction.DEFAULT_ENTRY_NOUN` is deleted in favour of `app.models.extraction.DEFAULT_ENTRY_LABEL` (one fallback, one name); the dialog had five hardcoded strings, not two; the noun placeholder is the frontend fallback constant; the undo replay posts the fallback noun for a legacy repeating section; docs: the architecture reference's migration-head line and `extraction_entity_types` row.

- [ ] **Step 3: Run every gate and read the output**

```bash
make lint-backend
cd backend && uv run mypy app --ignore-missing-imports > mypy.out || true; uv run python ../scripts/mypy_baseline.py --baseline .mypy_baseline --input mypy.out; cd ..
npx knip --no-tag-hints && npx knip --production --no-tag-hints
python3 scripts/fitness/check_copy_keys.py
make test-backend
npm run test:run
npm run typecheck && npm run lint
make quality-scan
```

Expected: all exit 0; `make quality-scan` reports every gate `exit=0` (vulture baseline unchanged or smaller; playwright skipped when the local stack is down, non-blocking).

- [ ] **Step 4: Commit**

```bash
git add frontend/types/api .markdownlintignore docs/superpowers/plans/2026-09-03-entry-noun-every-repeating-section.md docs/superpowers/specs/2026-09-03-entry-group-followup-train-design.md
git commit -m "chore(contract): regenerate API types for the required entry noun; record the reconciled deltas"
```
