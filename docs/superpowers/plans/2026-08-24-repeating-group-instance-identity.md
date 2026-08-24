---
status: approved
last_reviewed: 2026-08-24
owner: '@raphaelfh'
---

# Repeating-group instance identity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps
> use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop AI re-runs from creating a second instance for an entity
they already extracted, by giving every `cardinality='many'` entity type a
declared identity key.

**Architecture:** One new column, `extraction_fields.is_entity_key`,
declares which field identifies an instance within its
`(article, entity_type, parent_instance)` coordinate. Both AI paths
resolve that key, match their findings against the existing instances'
key values, and reuse rather than create. Because a free-text key drifts
between runs exactly as the label did, the model-identification prompt
also receives the existing key values so the LLM aligns to them — the two
halves are inseparable.

**Tech Stack:** SQLAlchemy 2.0 async, Alembic, Pydantic v2, pytest;
React 19 + TypeScript strict, Vitest.

## Global Constraints

- English only for code, comments, commits, docs and copy keys.
- SQLAlchemy model change ⇒ Alembic migration, revision id ≤ 32 chars.
- Adding a migration breaks `test_migration_roundtrip`'s head pin — bump it
  in the same change.
- Frontend tooling runs from the **repo root**; there is no
  `frontend/package.json`.
- All user-facing copy goes through `frontend/lib/copy/`.
- Never batch tests at the end — each task's test lands with its task.
- The local Supabase stack is SHARED. Do not `make db-fresh`. Build a
  throwaway DB with a UNIQUE name and override BOTH `DATABASE_URL` and
  `DIRECT_DATABASE_URL`.

## Reference: the four seeded coordinates

| Template | Repeating group | Key field | Type |
| --- | --- | --- | --- |
| CHARMS `000c…0001` | `prediction_models` | `model_name` | text |
| CHARMS `000c…0001` | `final_predictors` | `predictor_name` | text |
| CHARMS+MM `000e…0001` | `prediction_models` | `mdl_name` | text |
| CHARMS+MM `000e…0001` | `numeric_performance` | `pnum_validation_type` | select |

## File Structure

- `backend/app/models/extraction.py` — the column on `ExtractionField`.
- `backend/alembic/versions/0059_entity_key_field.py` — DDL + backfill.
- `backend/app/services/entity_key.py` — **new**, the whole identity
  concept: resolve the key field, read existing keys, match. One
  responsibility, no IO beyond its own queries, unit-testable.
- `backend/app/services/model_extraction_service.py` — call the matcher
  instead of creating unconditionally.
- `backend/app/services/section_extraction_service.py` — call the matcher
  instead of taking `instances[0]`.
- `backend/app/llm/prompts/model_identification.py` — prompt grounding.
- `backend/app/schemas/template_portable.py` — one field; export and
  import are already generic (`model_validate(from_attributes=True)` and
  `**f.model_dump()`).
- `backend/app/schemas/template_structure.py` +
  `backend/app/services/template_field_service.py` — let a manager set it.
- `frontend/components/extraction/template-config/TemplateInspectorSectionPane.tsx`
  — the key selector.

---

### Task 1: Column, one-key-per-section index, and backfill

**Files:**
- Modify: `backend/app/models/extraction.py` (class `ExtractionField`)
- Create: `backend/alembic/versions/0059_entity_key_field.py`
- Modify: `backend/tests/integration/test_migration_roundtrip.py` (head pin)
- Test: `backend/tests/integration/test_entity_key_migration.py`

**Interfaces:**
- Consumes: nothing.
- Produces: `ExtractionField.is_entity_key: Mapped[bool]`; partial unique
  index `uq_extraction_fields_one_entity_key`; revision
  `0059_entity_key_field` chained on `0058_scope_config_read_rls`.

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/integration/test_entity_key_migration.py
import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

pytestmark = pytest.mark.asyncio

CHARMS_MODELS = "000c0001-0000-0000-0000-000000000000"


async def test_backfill_stamps_charms_model_name(db_session: AsyncSession) -> None:
    """The seed early-returns on existing installs, so the MIGRATION is
    what stamps production. Pin that, not the seed."""
    flagged = (
        await db_session.execute(
            text(
                "SELECT f.is_entity_key FROM public.extraction_fields f "
                "WHERE f.entity_type_id = :et AND f.name = 'model_name'"
            ),
            {"et": CHARMS_MODELS},
        )
    ).scalar_one()
    assert flagged is True


async def test_only_one_key_per_entity_type(db_session: AsyncSession) -> None:
    et = (
        await db_session.execute(
            text(
                "SELECT entity_type_id FROM public.extraction_fields "
                "WHERE is_entity_key LIMIT 1"
            )
        )
    ).scalar_one()
    with pytest.raises(IntegrityError):
        await db_session.execute(
            text(
                "UPDATE public.extraction_fields SET is_entity_key = true "
                "WHERE entity_type_id = :et AND NOT is_entity_key"
            ),
            {"et": et},
        )
        await db_session.flush()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest tests/integration/test_entity_key_migration.py -q`
Expected: FAIL — `column "is_entity_key" does not exist`.

- [ ] **Step 3: Add the column to the model**

```python
# backend/app/models/extraction.py, class ExtractionField, beside allows_not_evaluated
    is_entity_key: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
```

- [ ] **Step 4: Write the migration**

Revision `0059_entity_key_field`, `down_revision =
"0058_scope_config_read_rls"`. The docstring must record WHY the backfill
exists (`app.seed` early-returns at `seed.py:241` / `:2030`, so the seed
cannot reach any existing database, production included).

```python
def upgrade() -> None:
    op.add_column(
        "extraction_fields",
        sa.Column("is_entity_key", sa.Boolean(), nullable=False, server_default=sa.false()),
        schema="public",
    )
    op.execute(
        "CREATE UNIQUE INDEX uq_extraction_fields_one_entity_key "
        "ON public.extraction_fields (entity_type_id) WHERE is_entity_key"
    )
    # Backfill BOTH lineages by NAME — a project clone has fresh ids.
    op.execute(
        """
        UPDATE public.extraction_fields f
           SET is_entity_key = true
          FROM public.extraction_entity_types et
         WHERE et.id = f.entity_type_id
           AND et.cardinality = 'many'
           AND (et.name, f.name) IN (
                 ('prediction_models',   'model_name'),
                 ('prediction_models',   'mdl_name'),
                 ('final_predictors',    'predictor_name'),
                 ('numeric_performance', 'pnum_validation_type')
               )
           AND f.is_entity_key IS DISTINCT FROM true
           AND NOT EXISTS (
                 SELECT 1 FROM public.extraction_fields other
                  WHERE other.entity_type_id = f.entity_type_id
                    AND other.is_entity_key
               );
        """
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS public.uq_extraction_fields_one_entity_key")
    op.drop_column("extraction_fields", "is_entity_key", schema="public")
```

- [ ] **Step 5: Bump the head pin**

In `test_migration_roundtrip.py::test_alembic_head_is_expected_revision`
replace `0058_scope_config_read_rls` with `0059_entity_key_field` in both
the assertion and its message.

- [ ] **Step 6: Run the tests**

Run: `uv run alembic upgrade head && uv run pytest tests/integration/test_entity_key_migration.py tests/integration/test_migration_roundtrip.py -q`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add backend/app/models/extraction.py backend/alembic/versions/0059_entity_key_field.py backend/tests/integration/
git commit -m "feat(extraction): declare an identity key on repeating-group fields"
```

---

### Task 2: The seed declares the keys for fresh installs

**Files:**
- Modify: `backend/app/seed.py` (`_field` at :1341, and the four call sites)
- Test: `backend/tests/unit/test_seed_entity_keys.py`

**Interfaces:**
- Consumes: `ExtractionField.is_entity_key` (Task 1).
- Produces: `_field(..., is_entity_key: bool = False)`.

- [ ] **Step 1: Write the failing test**

The four coordinates must live in ONE place. Today they would be spelled
in the seed's call sites AND in the migration's backfill SQL, which can
drift silently. Introduce a module-level constant and assert against it —
this also keeps the test out of the "assumes the seed ran" trap, because
it reads the declaration, not the database.

```python
# backend/tests/unit/test_seed_entity_keys.py
"""The seed's key declarations, read WITHOUT touching a database.

``app.seed`` early-returns on an existing template (seed.py:241, :2030),
so a DB-backed assertion would be testing whichever seed happened to run.
Assert the declaration instead; migration 0059 pins the backfill.
"""

from app.seed import ENTITY_KEY_FIELDS


def test_the_four_repeating_groups_declare_their_key() -> None:
    assert ENTITY_KEY_FIELDS == frozenset(
        {
            ("prediction_models", "model_name"),
            ("prediction_models", "mdl_name"),
            ("final_predictors", "predictor_name"),
            ("numeric_performance", "pnum_validation_type"),
        }
    )


def test_no_repeating_group_declares_two_keys() -> None:
    groups = [et for et, _ in ENTITY_KEY_FIELDS]
    assert len(groups) == len(set(groups)) or set(groups) == {"prediction_models"}, (
        "prediction_models legitimately appears twice — once per lineage, "
        "with a different field name; any OTHER repeat is a bug"
    )
```

- [ ] **Step 2: Run it and watch it fail**

Run: `uv run pytest tests/unit/test_seed_entity_keys.py -q`
Expected: FAIL — `cannot import name 'ENTITY_KEY_FIELDS'`.

- [ ] **Step 3: Declare the constant and thread the flag through `_field`**

```python
# backend/app/seed.py, module level
ENTITY_KEY_FIELDS: frozenset[tuple[str, str]] = frozenset(
    {
        ("prediction_models", "model_name"),          # CHARMS 000c
        ("prediction_models", "mdl_name"),            # CHARMS + Multimodal 000e
        ("final_predictors", "predictor_name"),       # CHARMS 000c
        ("numeric_performance", "pnum_validation_type"),  # CHARMS + MM 000e
    }
)
```

```python
def _field(
    eid: UUID, name: str, label: str, desc: str, ftype: str, sort: int,
    *, llm: str, allowed: list[str] | None = None, unit: str | None = None,
    allows_not_applicable: bool = False, allows_not_evaluated: bool = False,
    is_entity_key: bool = False,
) -> ExtractionField:
    ...
    return ExtractionField(..., is_entity_key=is_entity_key)
```

Then pass `is_entity_key=True` at exactly the four call sites: `model_name`
(`seed.py:459`), `predictor_name` (`:857`), `mdl_name` (`:2583`),
`pnum_validation_type` (`:2888`).

- [ ] **Step 4: Pin the migration against the same constant**

Add to `backend/tests/integration/test_entity_key_migration.py`:

```python
def test_migration_backfill_matches_the_seed_declaration() -> None:
    """The backfill SQL and the seed must name the same coordinates."""
    from app.seed import ENTITY_KEY_FIELDS

    sql = (
        pathlib.Path("alembic/versions/0059_entity_key_field.py").read_text()
    )
    for entity_type, field in ENTITY_KEY_FIELDS:
        assert f"('{entity_type}'" in sql and f"'{field}')" in sql, (
            f"migration backfill is missing ({entity_type}, {field})"
        )
```

- [ ] **Step 5: Run both, then commit**

Run: `uv run pytest tests/unit/test_seed_entity_keys.py tests/integration/test_entity_key_migration.py -q`
Expected: PASS.

```bash
git add backend/app/seed.py backend/tests/unit/test_seed_entity_keys.py backend/tests/integration/test_entity_key_migration.py
git commit -m "feat(seed): declare entity keys on the CHARMS repeating groups"
```

---

### Task 3: The portable bundle round-trips the key

**Files:**
- Modify: `backend/app/schemas/template_portable.py` (class `PortableField`)
- Test: `backend/tests/unit/test_template_portable_schema.py` (extend)

**Interfaces:**
- Consumes: Task 1's column.
- Produces: `PortableField.is_entity_key: bool`.

Export (`model_validate(f, from_attributes=True)`) and import
(`_field_row` → `**f.model_dump()`) are both generic, so the schema line
is the entire change. Without it `extra="forbid"` would make an exported
bundle fail to re-import, and the key would be silently dropped.

- [ ] **Step 1: Write the failing test**

```python
def test_portable_field_round_trips_entity_key() -> None:
    doc = PortableField.model_validate(
        {"name": "model_name", "label": "Model Name", "type": "text", "is_entity_key": True}
    )
    assert doc.is_entity_key is True
    assert doc.model_dump()["is_entity_key"] is True
```

- [ ] **Step 2: Run it, watch it fail** (`extra="forbid"` rejects the key).

- [ ] **Step 3: Add the field**

```python
    allows_not_evaluated: bool = False
    is_entity_key: bool = False
```

- [ ] **Step 4: Run, then commit**

```bash
git add backend/app/schemas/template_portable.py backend/tests/unit/test_template_portable_schema.py
git commit -m "feat(templates): carry is_entity_key through the portable bundle"
```

---

### Task 4: The matcher — resolve key, read existing, match

**Files:**
- Create: `backend/app/services/entity_key.py`
- Test: `backend/tests/integration/test_entity_key_matching.py`

**Interfaces:**
- Consumes: Task 1's column.
- Produces:

```python
class MissingEntityKeyError(Exception):
    """A cardinality='many' entity type declares no is_entity_key field."""

def normalize_key(value: str) -> str: ...

async def resolve_key_field(db: AsyncSession, entity_type_id: UUID) -> ExtractionField: ...

async def existing_keys(
    db: AsyncSession, *, article_id: UUID, entity_type_id: UUID,
    parent_instance_id: UUID | None,
) -> dict[str, UUID]:
    """normalized ``metadata_->>'entity_key'`` -> instance_id for the live
    coordinate. Reads instances only — never a reviewer-scoped value."""

def stamp(metadata: dict[str, Any], key_value: str) -> dict[str, Any]:
    """Return metadata with the normalized key materialized on it."""

async def match_or_none(
    db: AsyncSession, *, article_id: UUID, entity_type_id: UUID,
    parent_instance_id: UUID | None, key_value: str,
) -> UUID | None: ...
```

- [ ] **Step 1: Write the failing tests**

```python
def test_normalize_trims_casefolds_and_collapses_whitespace() -> None:
    assert normalize_key("  XGBoost  ") == normalize_key("xgboost")
    assert normalize_key("Gradient  Boosting") == normalize_key("gradient boosting")


async def test_match_returns_the_existing_instance(db_session) -> None:
    # build one instance whose key field value is "XGBoost"
    found = await match_or_none(db_session, article_id=a, entity_type_id=et,
                                parent_instance_id=None, key_value=" xgboost ")
    assert found == instance_id


async def test_missing_key_declaration_raises(db_session) -> None:
    with pytest.raises(MissingEntityKeyError):
        await resolve_key_field(db_session, unkeyed_repeating_entity_type_id)
```

- [ ] **Step 2: Run, watch them fail** (module does not exist).

- [ ] **Step 3: Implement `entity_key.py`**

Read the key from `ExtractionInstance.metadata_->>'entity_key'` ONLY.

Do **not** read the key field's value. `resolve_caller_current_values`
(`extraction_run_read_service.py:261`) is caller-scoped and is the 4th
lockstep copy of migration 0025's blind predicate: read it scoped and a
second reviewer cannot see the first reviewer's value, so the duplicate is
created anyway; read it unscoped and reviewer judgment leaks across the
blind boundary. The instance row is already shared, so materializing the
key there sidesteps both (spec 5.1.1).

```python
STORE_KEY = "entity_key"

def normalize_key(value: str) -> str:
    return " ".join(value.split()).casefold()

def stamp(metadata: dict[str, Any], key_value: str) -> dict[str, Any]:
    return {**metadata, STORE_KEY: normalize_key(key_value)}
```
- [ ] **Step 4: Run, then commit**

```bash
git add backend/app/services/entity_key.py backend/tests/integration/test_entity_key_matching.py
git commit -m "feat(extraction): entity-key resolution and instance matching"
```

---

### Task 5: The model-container AI path reuses instead of creating

**Files:**
- Modify: `backend/app/services/model_extraction_service.py`
  (`_create_model_instances`, ~:556)
- Test: `backend/tests/integration/test_model_extraction_rerun.py`

**Interfaces:**
- Consumes: Task 4's `match_or_none`, `resolve_key_field`,
  `MissingEntityKeyError`.
- Produces: no new signature; `_create_model_instances` returns the same
  tuple, now containing reused instances.

- [ ] **Step 1: Write the failing test — this is THE regression**

```python
async def test_second_ai_run_reuses_the_existing_model_instance(db_session) -> None:
    first = await service._create_model_instances(..., models=[{"name": "XGBoost"}], run=run)
    second = await service._create_model_instances(..., models=[{"name": "XGBoost"}], run=run)
    assert count_instances() == 1
    assert second[0][0].id == first[0][0].id
```

- [ ] **Step 2: Run it — it must FAIL with 2 instances.** A test that
  passes before the change proves nothing.

- [ ] **Step 3: Match before creating.** On a hit reuse the instance id; on
  a miss create with `metadata_=stamp({...}, key_value)` so the NEXT run can
  match it. On `MissingEntityKeyError` raise the typed refusal rather than
  duplicating.

- [ ] **Step 4: Run, then commit**

```bash
git add backend/app/services/model_extraction_service.py backend/tests/integration/test_model_extraction_rerun.py
git commit -m "fix(extraction): reuse the matching model instance on an AI re-run"
```

---

### Task 6: The repeating-section AI path fills repeats 2..N

**Files:**
- Modify: `backend/app/services/section_extraction_service.py`
  (`_get_or_create_instance` ~:1482, `_find_instance_for_entity_type` ~:767)
- Test: `backend/tests/integration/test_section_extraction_repeats.py`

**Interfaces:**
- Consumes: Task 4.
- Produces: both helpers take an optional `key_value: str | None`.

Today both take `instances[0]`, which for a repeating section is the
mirror bug: it always writes the first repeat and never fills the rest.

- [ ] **Step 1: Write the failing test** — a repeating section with an
  enum key (`pnum_validation_type`) and two repeats (`apparent`,
  `external`); extracting `external` must land on the `external` instance,
  not on `instances[0]`.

- [ ] **Step 2: Run it — must FAIL** (writes the first repeat).

- [ ] **Step 3: Route both helpers through the matcher.**

- [ ] **Step 4: Run, then commit**

```bash
git add backend/app/services/section_extraction_service.py backend/tests/integration/test_section_extraction_repeats.py
git commit -m "fix(extraction): route repeating-section extraction to the matching repeat"
```

---

### Task 7: Ground the identification prompt in the existing keys

**Files:**
- Modify: `backend/app/llm/prompts/model_identification.py`
- Modify: `backend/app/services/model_extraction_service.py` (`_identify_models` ~:360)
- Test: `backend/tests/unit/test_model_identification_prompt.py`

**Interfaces:**
- Consumes: Task 4's `existing_keys`.
- Produces: `render(*, container_label, article_text, general_instructions=None,
  existing_keys: list[str] | None = None)`.

Without this the free-text keys drift and Task 5 never fires: run 2 writes
"Gradient Boosting" where run 1 wrote "XGBoost", the keys differ, and the
duplicate returns. `VERSION` is a content hash of the template, so it
bumps itself.

- [ ] **Step 1: Write the failing test**

```python
def test_prompt_lists_existing_keys_and_asks_for_reuse() -> None:
    out = render(container_label="prediction models", article_text="…",
                 existing_keys=["XGBoost"])
    assert "XGBoost" in out


def test_prompt_omits_the_section_when_nothing_exists() -> None:
    out = render(container_label="prediction models", article_text="…", existing_keys=[])
    assert "already been identified" not in out
```

- [ ] **Step 2: Run, watch it fail** (unexpected keyword argument).

- [ ] **Step 3: Add the block** — instruct: return the EXACT existing name
  when a finding is one of these, otherwise a new name.

- [ ] **Step 4: Run, then commit**

```bash
git add backend/app/llm/prompts/model_identification.py backend/app/services/model_extraction_service.py backend/tests/unit/test_model_identification_prompt.py
git commit -m "feat(llm): ground model identification in the already-extracted keys"
```

---

### Task 8: A manager can set the key through the API

**Files:**
- Modify: `backend/app/schemas/template_structure.py` (`TemplateFieldUpdateRequest`, :120)
- Modify: `backend/app/services/template_field_service.py` (`update_field`, :214)
- Test: `backend/tests/integration/test_template_field_entity_key.py`

**Interfaces:**
- Consumes: Task 1.
- Produces: `is_entity_key: bool | None` on the field-update payload.

- [ ] **Step 1: Write the failing tests** — setting it on a repeating
  section's field succeeds; setting a SECOND one on the same section
  returns the typed duplicate error rather than a raw 23505.

- [ ] **Step 2: Run, watch them fail** (`extra="forbid"` rejects the key).

- [ ] **Step 3: Add the field and map 23505 on
  `uq_extraction_fields_one_entity_key` to a typed error**, the way
  `template_field_service` already remaps the name-uniqueness 23505.

- [ ] **Step 4: Add a DIRECT endpoint-coroutine unit test**

Diff-cover has an ASGI blind spot: handler lines exercised through
`httpx.ASGITransport` do not register, so an integration test alone leaves
this endpoint uncovered and can fail the 80 gate. Call the endpoint
coroutine directly with a stub session, as the existing
`tests/unit/test_*_endpoints_unit.py` files do.

- [ ] **Step 5: Run, then commit**

```bash
git add backend/app/schemas/template_structure.py backend/app/services/template_field_service.py backend/tests/integration/test_template_field_entity_key.py backend/tests/unit/
git commit -m "feat(templates): let a manager declare a section's entity key"
```

---

### Task 9: The inspector exposes the key selector

**Files:**
- Modify: `frontend/components/extraction/template-config/TemplateInspectorSectionPane.tsx`
- Modify: `frontend/lib/copy/` (new keys)
- Test: `frontend/components/extraction/template-config/TemplateInspectorSectionPane.test.tsx`

**Interfaces:**
- Consumes: Task 8's payload key.
- Produces: none.

Without this, a hand-built repeating section hits Task 5's refusal with no
way to satisfy it. The pane already renders a `groupChild` cardinality
select (:168-190); the key selector sits directly under it and renders
only when `cardinality === 'many'`.

- [ ] **Step 1: Write the failing test** — render a `groupChild` section
  with `cardinality='many'` and assert the key `<select>` lists that
  section's fields; render one with `cardinality='one'` and assert it is
  absent.

- [ ] **Step 2: Run it and watch it fail**

Run (from repo root): `npm run test:run -- TemplateInspectorSectionPane`

- [ ] **Step 3: Add the native `<select>`**, matching the cardinality
  control's classes and copy conventions (no inline strings — all copy
  through `frontend/lib/copy/`).

- [ ] **Step 4: Run, then commit**

```bash
git add frontend/components/extraction/template-config/ frontend/lib/copy/
git commit -m "feat(template-config): declare a repeating section's entity key"
```
