# Phase 1D: Synthetic Runs Migration + Drop 008 Stack

> Subagent-driven. `- [ ]` checkboxes.

**Goal:** Migrate legacy `extracted_values` data into the new HITL stack as `extraction_published_states` rows under synthetic finalized Runs, then drop the 008 evaluation_* tables and enums.

## Spec
`docs/superpowers/specs/2026-04-27-extraction-hitl-and-qa-design.md` §5 step 6 (synthetic Runs) + step 7 (drop 008 tables) + `docs/unified-evaluation-clean-slate.md` for the exact 008 drop list.

---

## Task 1: Migration `0015` — synthetic Runs for existing `extracted_values`

**File:** `backend/alembic/versions/20260427_0015_synthetic_runs_for_extracted_values.py`

For each existing `(article_id, template_id)` pair in `extracted_values`:
1. Find or create a Run with `stage='finalized'`, `status='completed'`, `kind='extraction'`, `version_id=` the active TemplateVersion for that template, `hitl_config_snapshot={}`, `created_by=` the most recent value's `reviewer_id` if any, else any project admin.
2. For each `extracted_values` row tied to this `(article_id, template_id)`, INSERT into `extraction_published_states` with `version=1`, `value=ev.value`, `published_by=ev.reviewer_id` if any else the synthetic Run's creator.

Idempotent (`WHERE NOT EXISTS`). Reversible: `downgrade()` deletes synthetic Runs (those whose `parameters->>'_synthetic'` flag = true) + their cascaded `extraction_published_states`.

Set `parameters = '{"_synthetic": true, "_origin": "0015_migration"}'::jsonb` on synthetic Runs to make them identifiable.

### Migration tests

`backend/tests/integration/test_synthetic_runs_migration.py`:
- Pre-migration count of `extracted_values` × post-migration count of `extraction_published_states` matches per (article, template).
- Every existing `(article_id, template_id)` in `extracted_values` has a synthetic Run.
- Synthetic Runs are `stage='finalized'`, `status='completed'`.
- Synthetic Runs have the `_synthetic: true` flag in `parameters`.

```bash
cd backend && set -a && . /Users/raphael/PycharmProjects/prumo/backend/.env && set +a && uv run alembic upgrade head
```

Then run the tests, verify reversibility (`alembic downgrade -1 && alembic upgrade head`).

Commit: `feat(extraction): migration 0015 — synthetic finalized Runs wrap legacy extracted_values`

---

## Task 2: Migration `0016` — drop 008 stack

**File:** `backend/alembic/versions/20260427_0016_drop_008_stack.py`

Drop tables in dependency order, then enums. Per `docs/unified-evaluation-clean-slate.md`:

Tables to drop (CASCADE):
- `evidence_records`
- `published_states`
- `consensus_decision_records`
- `reviewer_states`
- `reviewer_decision_records`
- `proposal_records`
- `evaluation_run_targets`
- `evaluation_runs`
- `evaluation_items`
- `evaluation_schema_versions`
- `evaluation_schemas`

Enums to drop:
- `evaluation_schema_version_status`
- `evaluation_item_type`
- `evaluation_run_status`
- `evaluation_run_stage`
- `evaluation_proposal_source_type`
- `reviewer_decision_type`
- `consensus_decision_mode`
- `published_state_status`
- `evidence_entity_type`

Pre-drop sanity: `SELECT 1 FROM pg_constraint WHERE confrelid IN (regclass list of 008 tables) AND conrelid NOT IN (those tables)` should return zero rows (no FKs from outside 008 reference 008).

`downgrade()`: re-create the tables/enums (full DDL from `0008_unified_evaluation_model_skeleton.py` reused via copy-paste OR — **simpler** — make `downgrade` a no-op with a clear message that downgrade past this point is unsupported. Document in spec.

### Drop the SQLAlchemy models

After the migration, delete:
- `backend/app/models/evaluation_decision.py`
- `backend/app/models/evaluation_run.py`
- `backend/app/models/evaluation_schema.py`
- Their imports/exports in `backend/app/models/__init__.py`
- Their entries in `backend/app/models/base.py:POSTGRESQL_ENUM_VALUES` (the 008-specific enums)
- Their entries in `backend/tests/unit/test_enum_types.py`

### Migration tests

`backend/tests/integration/test_drop_008_stack.py`:
- After migration, none of the 008 tables exist (`to_regclass` returns NULL).
- None of the 008 enums exist (`pg_type` lookup returns NULL).
- Existing extraction tables (`extraction_runs`, `extraction_proposal_records`, etc.) are untouched.
- `extraction_published_states` count is unchanged after this migration.

```bash
cd backend && set -a && . /Users/raphael/PycharmProjects/prumo/backend/.env && set +a && uv run alembic upgrade head
```

Verify reversibility skip is acceptable (downgrade is no-op with documented message). Or full reversibility if implementer chooses.

Commit: `feat(extraction): migration 0016 — drop 008 evaluation_* tables and enums`

---

## Task 3: Drop 008 SQLAlchemy models + registry entries

**Modify:**
- `backend/app/models/__init__.py` — remove all `from app.models.evaluation_* import ...` and corresponding `__all__` entries
- `backend/app/models/base.py` — remove these enum entries from `POSTGRESQL_ENUM_VALUES`:
  - `evaluation_schema_version_status`
  - `evaluation_item_type`
  - `evaluation_run_status`
  - `evaluation_run_stage`
  - `evaluation_proposal_source_type`
  - `reviewer_decision_type`
  - `consensus_decision_mode`
  - `published_state_status`
  - `evidence_entity_type`
- `backend/tests/unit/test_enum_types.py` — remove the same names from `expected_enums`

**Delete:**
- `backend/app/models/evaluation_decision.py`
- `backend/app/models/evaluation_run.py`
- `backend/app/models/evaluation_schema.py`

### Smoke tests

```bash
cd backend && uv run python -c "from app.main import app; print('ok')"
cd backend && uv run python -c "from app.models import *; print('ok')"
cd backend && uv run pytest tests/unit/test_enum_types.py -v
```

Commit: `chore(extraction): drop 008 SQLAlchemy models + their enum registry entries`

---

## Task 4: Full backend suite + lint + format

```bash
cd backend && set -a && . /Users/raphael/PycharmProjects/prumo/backend/.env && set +a && uv run pytest -q
cd backend && uv run ruff check . && uv run ruff format --check .
```

Expect green. Apply `ruff format` if needed.

Commit (only if changes): `chore(extraction): apply ruff format to Plan 1D files`

---

## Out of scope

- Refactor `model_extraction_service` and `section_extraction_service` (still deferred from 1C-2).
- Frontend changes (Plan 1E).
- QA seed (Plan 2).
