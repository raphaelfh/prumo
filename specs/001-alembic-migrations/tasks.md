# Tasks: Alembic Migration Management for Application Domain

**Input**: Design documents from `/specs/001-alembic-migrations/`
**Prerequisites**: plan.md ✅, spec.md ✅, research.md ✅, data-model.md ✅, quickstart.md ✅

**Tests**: Not requested in spec — no test tasks generated.

**Organization**: Tasks grouped by user story for independent implementation and testing.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: User story this task belongs to (US1, US2, US3)

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Add Alembic dependency and create the directory structure. No user story work can begin until these are
done.

- [X] T001 Add `"alembic>=1.13"` and `"psycopg[binary]>=3.1"` to `dependencies` in `backend/pyproject.toml` and run
  `uv sync` to update `uv.lock` — `psycopg[binary]` is the sync PostgreSQL driver required by the startup check's
  `create_engine()` call (the async `asyncpg` driver is incompatible with synchronous SQLAlchemy engines)
- [X] T002 Create directory `backend/alembic/versions/` (including `__init__.py` files in `backend/alembic/` and
  `backend/alembic/versions/`) to establish Alembic package structure

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Configure Alembic completely. All three user stories depend on this phase being complete.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [X] T003 [P] Add SQLAlchemy naming convention `MetaData(naming_convention={...})` to `Base` class in
  `backend/app/models/base.py` — use the convention from `research.md` Section 9; set
  `metadata = MetaData(naming_convention=_naming_convention)` on the `Base(DeclarativeBase)` class while keeping
  `__table_args__ = {"schema": "public"}` unchanged
- [X] T004 [P] Create `backend/alembic.ini` with: `script_location = alembic`,
  `file_template = %%(year)d%%(month).2d%%(day).2d_%%(rev)s_%%(slug)s`, `timezone = UTC`,
  `sqlalchemy.url = driver://user:pass@localhost/dbname` (placeholder — overridden in env.py), and standard Alembic
  logging config
- [X] T005 [P] Create `backend/alembic/script.py.mako` — standard Alembic migration template file (boilerplate:
  revision, down_revision, branch_labels, depends_on, upgrade(), downgrade() stubs)
- [X] T006 Create `backend/alembic/env.py` with: (1) async bridge using `asyncio.run()` +
  `connection.run_sync(do_run_migrations)`, (2) `include_object` filter that excludes any table not in `public` schema
  and excludes Supabase-injected tables (`spatial_ref_sys`, `geography_columns`, `geometry_columns`, `raster_columns`,
  `raster_overviews`), (3) import `from app.models import Base` so `target_metadata = Base.metadata`, (4) read DB URL
  from `settings.async_database_url` to override `config.set_main_option("sqlalchemy.url", ...)`, (5) offline mode
  support for SQL script generation, (6) `compare_type=True` in `context.configure()`

**Checkpoint**: Alembic is installed and fully configured. `cd backend && uv run alembic --help` should succeed. No
migration applied yet.

---

## Phase 3: User Story 1 — Developer Runs New Migration for Application Table (Priority: P1) 🎯 MVP

**Goal**: A developer can add a SQLAlchemy model, run `alembic revision --autogenerate`, get a correct migration file
containing only their change, and apply it — without any Supabase-managed tables appearing in the diff.

**Independent Test**: (1) Apply the initial migration. (2) Add a trivial test model to any SQLAlchemy models file. (3)
Run `alembic revision --autogenerate -m "test"`. (4) Confirm the generated file contains only the new table. (5) Confirm
no `auth.*`, `storage.*`, or extension tables appear. (6) Run `alembic upgrade head`. (7) Confirm the test table exists
in the database. (8) Undo the test model and migration.

### Implementation for User Story 1

- [X] T007 [US1] Create `backend/alembic/versions/0001_initial_public_schema.py` with boilerplate only: correct revision
  ID (generate with `alembic revision`), `down_revision = None`, `branch_labels = None`, `depends_on = None`, and empty
  `upgrade()` / `downgrade()` stubs with `pass`
- [X] T008 [US1] Add PostgreSQL extensions and all helper functions to `upgrade()` in
  `backend/alembic/versions/0001_initial_public_schema.py` via `op.execute()`:
  `CREATE EXTENSION IF NOT EXISTS pgcrypto/pg_trgm/btree_gin`, then `set_updated_at()` trigger function,
  `is_project_member()` and `is_project_manager()` functions (sourced from `supabase/migrations/0001_base_schema.sql`
  and `0003_core_tables.sql`); **do NOT include `handle_new_user()` — it fires ON `auth.users` and must remain in a
  Supabase migration file (see T031)**
- [X] T009 [US1] Add all 14 ENUM type definitions to `upgrade()` in
  `backend/alembic/versions/0001_initial_public_schema.py` via `op.execute("CREATE TYPE ... AS ENUM (...)")` for every
  key in `POSTGRESQL_ENUM_VALUES` in `backend/app/models/base.py` (sourced from `supabase/migrations/0002_enums.sql`)
- [X] T010 [US1] Add `profiles` and `projects` tables to `upgrade()` in
  `backend/alembic/versions/0001_initial_public_schema.py` via `op.execute()`: create `profiles` (with FK to
  `auth.users(id)` ON DELETE CASCADE), create `projects`, immediately followed by
  `ALTER TABLE profiles ENABLE ROW LEVEL SECURITY` and all profile + project RLS policies using `auth.uid()` and
  `is_project_member()` helpers (sourced from `0003_core_tables.sql` and `0012_rls_policies.sql`)
- [X] T011 [US1] Add `project_members` table and its RLS to `upgrade()` in
  `backend/alembic/versions/0001_initial_public_schema.py`: create `project_members` with FK to `projects` and
  `profiles`, then `ENABLE ROW LEVEL SECURITY` + project-member RLS policies; also add
  `CREATE OR REPLACE FUNCTION create_project_with_member()` (sourced from `0003_core_tables.sql`,
  `0012_rls_policies.sql`, `0020_add_project_delete_policy.sql`, `0023_add_create_project_with_member_function.sql`)
- [X] T012 [US1] Add `articles` and `article_files` tables with RLS to `upgrade()` in
  `backend/alembic/versions/0001_initial_public_schema.py`: create both tables, enable RLS, add all article and
  article_files policies (sourced from `0003_core_tables.sql` and `0012_rls_policies.sql`)
- [X] T013 [US1] Add annotation tables (`article_highlights`, `article_boxes`, `article_annotations`) with RLS to
  `upgrade()` in `backend/alembic/versions/0001_initial_public_schema.py` (sourced from `0004_annotations.sql` and
  `0012_rls_policies.sql`)
- [X] T014 [US1] Add extraction domain tables to `upgrade()` in
  `backend/alembic/versions/0001_initial_public_schema.py`: `extraction_templates_global`,
  `project_extraction_templates`, `extraction_entity_types`, `extraction_fields`, `extraction_instances`,
  `extracted_values`, `extraction_evidence`, `extraction_runs` — each immediately followed by
  `ENABLE ROW LEVEL SECURITY` and their RLS policies (sourced from `0005_extraction_templates.sql`,
  `0006_extraction_data.sql`, `0012_rls_policies.sql`)
- [X] T015 [US1] Add AI extraction and suggestion tables to `upgrade()` in
  `backend/alembic/versions/0001_initial_public_schema.py`: `ai_suggestions` with RLS, then all schema changes from
  `0007_extraction_ai.sql`, `0016_extraction_hierarchy_validation.sql`, `0017_charms_2_0_complete_template.sql`,
  `0018_fields_other_option.sql`; also `extraction_runs` FK additions from
  `0028_extend_ai_suggestions_for_assessments.sql`
- [X] T016 [US1] Add assessment domain tables to `upgrade()` in
  `backend/alembic/versions/0001_initial_public_schema.py`: `assessment_instruments`, `assessment_items`, `assessments`,
  `assessment_responses`, `assessment_instances`, `project_assessment_instruments`, `ai_assessment_configs`,
  `ai_assessment_prompts`, `ai_assessments`, `ai_assessment_runs` — each with RLS immediately after (sourced from
  `0008_assessment.sql`, `0012_rls_policies.sql`, `0027_ai_assessment_runs.sql`, `0030_assessment_restructure.sql`,
  `0032_cleanup_legacy_assessment.sql`, `0033_ai_suggestions_assessment_support.sql`,
  `0034_project_assessment_instruments.sql`, `0035_add_target_mode_column.sql`)
- [X] T017 [US1] Add integration and feedback domain tables to `upgrade()` in
  `backend/alembic/versions/0001_initial_public_schema.py`: `zotero_integrations`, `user_api_keys`, `feedback_reports`
  with RLS; also add `find_user_by_email()` and `get_project_members()` functions (sourced from `0009_integrations.sql`,
  `0010_feedback.sql`, `0012_rls_policies.sql`, `0022_user_api_keys.sql`, `0025_add_find_user_by_email_function.sql`,
  `0026_add_get_project_members_function.sql`)
- [X] T018 [US1] Add remaining incremental schema changes to `upgrade()` in
  `backend/alembic/versions/0001_initial_public_schema.py`: all `ALTER TABLE`, `ALTER COLUMN`, new column additions and
  FK changes from `0015_fix_articles_rls_policy.sql`, `0019_migrate_charms_template_other_fields.sql`,
  `0024_add_missing_updated_at_columns.sql`, `0028_extend_ai_suggestions_for_assessments.sql`,
  `0036_rls_ai_suggestions_extraction_and_assessment.sql`, and all migrations from `20260219000000` and
  `20260219000001`; also add all AI suggestions extended RLS policies
- [X] T019 [US1] Add indexes, triggers, compatibility views, and seed data to `upgrade()` in
  `backend/alembic/versions/0001_initial_public_schema.py`: (1) all `CREATE INDEX` statements from `0011_indexes.sql`
  and `20251215_add_unique_constraints_and_indexes.sql`, (2) all `CREATE TRIGGER` statements from `0013_triggers.sql`, (
  3) compatibility views from `0031_assessment_compatibility_view.sql`,
  `20260129120420_restore_assessments_compatibility_view.sql`,
  `20260218000000_fix_assessments_view_project_instruments.sql`, (4) PROBAST instrument seed data
  `INSERT INTO assessment_instruments ...` from `0029_seed_probast_instrument.sql`
- [X] T020 [US1] Write `downgrade()` in `backend/alembic/versions/0001_initial_public_schema.py`: drop all objects in
  strict reverse dependency order — first drop views, then drop seed data (DELETE), then drop triggers, then drop
  indexes, then drop tables (most-dependent first: ai_assessments, ai_assessment_runs, ... down to profiles), then drop
  all 14 ENUM types, then drop extensions; use `op.execute("DROP TABLE IF EXISTS ... CASCADE")` for tables and
  `op.execute("DROP TYPE IF EXISTS ...")` for ENUMs
- [X] T021 [US1] Verify User Story 1 end-to-end: run `cd backend && uv run alembic upgrade head`, confirm
  `alembic current` shows `0001_initial_public_schema (head)`, run `alembic revision --autogenerate -m "verify_empty"`,
  confirm generated file's `upgrade()` body is empty (no tables to create/drop), delete the test revision file
- [X] T031 [US1] Create `supabase/migrations/0002_handle_new_user_trigger.sql` containing: (1)
  `CREATE OR REPLACE FUNCTION public.handle_new_user() RETURNS trigger` with the verbatim function body from
  `supabase/migrations/0001_base_schema.sql`, and (2)
  `CREATE OR REPLACE TRIGGER handle_new_user AFTER INSERT ON auth.users FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user()` —
  both MUST be in the same Supabase file because `CREATE TRIGGER` validates function existence at creation time and
  `supabase db reset` runs before `alembic upgrade head`; verify `supabase db reset` applies this file without error

**Checkpoint**: US1 complete. A developer can now generate and apply schema migrations via Alembic. Autogenerate
produces correct diffs against the baseline.

---

## Phase 4: User Story 2 — Developer Sets Up Local Environment from Scratch (Priority: P2)

**Goal**: A developer with a blank database runs two commands (`supabase db reset` then `alembic upgrade head`) and gets
a fully working environment. The application refuses to start if migrations are pending.

**Independent Test**: (1) Drop and recreate the local database. (2) Run `supabase db reset`. (3) Run
`cd backend && uv run alembic upgrade head`. (4) Confirm all application tables exist in `public` schema. (5) Confirm
`alembic current` shows `(head)`. (6) Confirm app starts successfully (`uvicorn app.main:app`). (7) Comment out the
initial migration revision and re-start the app — confirm it refuses with a clear error.

### Implementation for User Story 2

- [X] T022 [P] [US2] Add `check_pending_migrations()` async function to `backend/app/main.py`: creates a disposable sync
  engine using `create_engine(settings.DATABASE_URL.unicode_string())` — `PostgresDsn.unicode_string()` returns a plain
  `postgresql://` URL; **do NOT use `str(settings.DATABASE_URL).replace("+asyncpg", "")` because `DATABASE_URL` contains
  no `+asyncpg` in the first place** — uses `alembic.script.ScriptDirectory` +
  `alembic.runtime.migration.MigrationContext` to find pending revisions, logs
  `logger.error("unapplied_migrations_detected", pending_revisions=list(pending))` and calls `raise SystemExit(1)` if
  any are pending; call `await check_pending_migrations()` as the first line inside the `lifespan()` startup block (
  before `logger.info("application_startup")`)
- [X] T023 [P] [US2] Delete all Supabase application migration files from `supabase/migrations/`: keep
  `0001_storage_bucket_articles.sql` (storage bucket) and `0002_handle_new_user_trigger.sql` (created in T031 — do NOT
  delete this one); delete all original application migration files including `0001` through `0013`,
  `0015_fix_articles_rls_policy.sql` through `0036_rls_ai_suggestions_extraction_and_assessment.sql`,
  `20251215_add_unique_constraints_and_indexes.sql`, `20260129120420_restore_assessments_compatibility_view.sql`,
  `20260218000000_fix_assessments_view_project_instruments.sql`,
  `20260219000000_fix_ai_suggestions_nullable_extraction_run_id.sql`,
  `20260219000001_ai_suggestions_project_assessment_item.sql` (audit for any `0021_*.sql` file and include its content
  in the initial migration before deleting)
- [X] T024 [US2] Update `Makefile` migration targets: add `db-migrate` (runs
  `cd backend && uv run alembic upgrade head`), `db-rollback` (runs `alembic downgrade -1`), `db-history` (runs
  `alembic history --verbose`), `db-current` (runs `alembic current`), `db-generate MSG=...` (runs
  `alembic revision --autogenerate -m "$(MSG)"`), `db-setup` (runs `db-reset` then `db-migrate`); remove or rename any
  old `supabase db push` / `supabase migration new` targets for application tables
- [X] T025 [US2] Verify User Story 2 end-to-end: run `make db-setup` from scratch (full reset + migrate), confirm all
  30+ expected tables exist in `public` schema via `psql` or Supabase Studio, start the app and confirm it boots
  cleanly, verify the startup check fires correctly when the `alembic_version` table is empty
- [X] T032 [P] [US2] Update CI workflow (`.github/workflows/ci.yml` or equivalent): after `supabase db reset`, add
  `cd backend && uv run alembic upgrade head` before the `pytest` step — the complete CI sequence must be:
  `supabase db reset` → `alembic upgrade head` → `pytest`; satisfies SC-006 (CI applies full schema before tests run)
- [X] T033 [P] [US2] Update deployment pipeline configuration (`render.yaml`, `Procfile`, Dockerfile, or equivalent):
  add `cd backend && uv run alembic upgrade head` as a pre-start command that executes before `uvicorn` launches —
  satisfies FR-012 (migrations run automatically on every deployment without manual intervention)

**Checkpoint**: US2 complete. Any developer can fully reproduce the application database from scratch using two
commands, and the app refuses to start if migrations lag.

---

## Phase 5: User Story 3 — Developer Understands Which Tool to Use (Priority: P3)

**Goal**: Any developer can look up which migration tool to use for any type of database change, with zero ambiguity
between Alembic and Supabase CLI.

**Independent Test**: Ask a developer unfamiliar with the change to make three modifications — (1) add a column to an
application table, (2) create a new storage bucket, (3) update a storage RLS policy — and verify they independently
choose the correct tool for each.

### Implementation for User Story 3

- [X] T026 [P] [US3] Amend `constitution.md` at `.specify/memory/constitution.md`: (1) Replace the body of Principle III
  with the new wording: Alembic owns `public` schema (tables, RLS, functions, triggers, views), Supabase CLI owns
  storage buckets and storage RLS only, `auth.*` and `storage.*` schemas are never touched by Alembic; (2) Update the
  Technology table `Database migrations` row from `Supabase CLI` to
  `Alembic (public schema) + Supabase CLI (storage)`; (3) Update File Location Conventions `Migration` row from
  `supabase/migrations/` to `backend/alembic/versions/` for application tables; (4) increment constitution version (
  MAJOR bump for NON-NEGOTIABLE amendment)
- [X] T027 [P] [US3] Update `docs/guias/FLUXO_ALTERACAO_DATABASE.md`: replace all Supabase-migration-focused
  instructions for application tables with Alembic instructions; add a clear ownership table matching `quickstart.md` (
  which tool owns which type of change); add the command reference from `quickstart.md`; keep the Supabase CLI section
  for storage bucket changes only
- [X] T034 [P] [US3] Create `scripts/validate_migration_boundaries.sh` that scans all `*.py` files in
  `backend/alembic/versions/` for references to `auth.` or `storage.` schemas (regex: `(auth|storage)\.`) and exits
  non-zero with a clear error message if any Alembic migration attempts to CREATE/DROP/ALTER objects in those schemas;
  add this script as a CI gate that runs before `alembic upgrade head` — satisfies US3 acceptance scenario 3 (
  cross-schema contamination caught automatically before any migration is applied)

**Checkpoint**: All three user stories are complete and independently testable.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Final verification, cleanup, and documentation consistency.

- [X] T028 Run all quickstart.md verification steps end-to-end: full fresh setup (`supabase db reset` +
  `alembic upgrade head`), new migration generation and application, autogenerate empty-diff check, startup refusal
  test, rollback test (`alembic downgrade -1` then `alembic upgrade head`)
- [X] T029 [P] Update `CLAUDE.md` "Current Git Status" and any database migration references to reflect the Alembic
  split (remove references to Alembic being removed; replace with the new ownership model); update
  `docs/guias/FLUXO_ADICIONAR_FEATURE.md` step for "Create migration" to reference Alembic
- [X] T030 [P] Add `alembic.ini` to `.gitignore` exclusions check — confirm it IS committed (not ignored); confirm
  `backend/alembic/versions/` IS tracked by git; confirm the deleted Supabase migration files no longer appear in
  `git status`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately
- **Foundational (Phase 2)**: Depends on Phase 1 — BLOCKS all user stories
- **US1 (Phase 3)**: Depends on Phase 2 — BLOCKS US2 (US2 needs the initial migration applied)
- **US2 (Phase 4)**: Depends on Phase 3 (initial migration must exist and apply cleanly before cleanup)
- **US3 (Phase 5)**: Depends on Phase 2 only — can start after Foundational is done (documentation doesn't require
  migration to be applied)
- **Polish (Phase 6)**: Depends on all user story phases

### User Story Dependencies

- **US1 (P1)**: Can start after Foundational (Phase 2)
- **US2 (P2)**: Depends on US1 completion (needs the initial migration to exist before deleting Supabase files)
- **US3 (P3)**: Can start after Foundational (Phase 2) — parallel with US1

### Within Each User Story

- T008–T020 are sequential (each section of the migration builds on the previous — table FKs depend on earlier tables
  being created)
- T031 must run after T008 (handle_new_user function body is confirmed in 0001_base_schema.sql context); it is part of
  the T007–T021 sequence
- T022, T023, T032, T033 within US2 can all run in
  parallel [T022 modifies main.py; T023 deletes Supabase files; T032 modifies CI YAML; T033 modifies deployment config — no mutual dependencies]
- T026, T027, T034 within US3 can run in parallel [different files]

### Parallel Opportunities

Within Phase 2: T003, T004, T005 are fully parallel (different files)
Within US2: T022, T023, T032, T033 are fully parallel (different files, no mutual dependencies)
Within US3: T026, T027, T034 are fully parallel (different files)
Within Polish: T029, T030 are fully parallel (different files)

---

## Parallel Example: Phase 2 (Foundational)

```bash
# These three can run simultaneously (different files, no interdependence):
Task: "T003 — Update Base.metadata naming convention in backend/app/models/base.py"
Task: "T004 — Create backend/alembic.ini"
Task: "T005 — Create backend/alembic/script.py.mako"

# Then, sequentially after T003/T004/T005:
Task: "T006 — Create backend/alembic/env.py"
```

## Parallel Example: US2 (Environment Setup)

```bash
# These four can run simultaneously (different files, no mutual dependencies):
Task: "T022 — Add check_pending_migrations() to backend/app/main.py"
Task: "T023 — Delete application Supabase migration files (keep 0014 + 0015)"
Task: "T032 — Update CI workflow YAML"
Task: "T033 — Update deployment pipeline configuration"
```

## Parallel Example: US3 (Documentation)

```bash
# These three can run simultaneously (different files):
Task: "T026 — Amend constitution.md"
Task: "T027 — Update docs/guias/FLUXO_ALTERACAO_DATABASE.md"
Task: "T034 — Create scripts/validate_migration_boundaries.sh"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup (T001–T002)
2. Complete Phase 2: Foundational (T003–T006)
3. Complete Phase 3: US1 — initial migration + autogenerate verification (T007–T021)
4. **STOP and VALIDATE**: Confirm `alembic revision --autogenerate` produces clean diffs
5. Continue to US2 before deleting Supabase migrations

### Incremental Delivery

1. Phase 1 + Phase 2 → Alembic infrastructure ready
2. Phase 3 (US1) → Initial migration applied, autogenerate working (MVP — migration workflow functional)
3. Phase 4 (US2) → Supabase migrations cleaned up, startup check active (environment is now clean)
4. Phase 5 (US3) → Documentation and constitution updated (team is aligned on the new workflow)
5. Phase 6 (Polish) → Verified end-to-end

> **⚠️ Important**: Do NOT delete Supabase migration files (T023) until the initial Alembic migration (T007–T020) is
> verified to apply cleanly and produce an empty autogenerate diff (T021). Once deleted, the Supabase migration files are
> gone — ensure the Alembic migration reproduces the full schema before proceeding.

---

## Notes

- [P] tasks touch different files with no incomplete task dependencies
- [US#] label maps each task to a user story for traceability
- The initial migration (T007–T020) is the highest-risk task — work through it section by section, validating each SQL
  block compiles before proceeding
- `op.execute()` does not validate SQL at generation time — test by actually applying with `alembic upgrade head` after
  completing the full upgrade() function
- After T023 (deleting Supabase files), `supabase db reset` will only apply `0001_storage_bucket_articles.sql` and
  `0002_handle_new_user_trigger.sql` — this is expected and correct
- The `0021` migration number is absent from the existing file list — audit the `supabase/migrations/` directory for any
  file matching `0021_*.sql` before executing T023
- T022 sync URL: use `settings.DATABASE_URL.unicode_string()` — `PostgresDsn.unicode_string()` returns a plain
  `postgresql://` URL suitable for `create_engine()`; the `DATABASE_URL` setting never contains `+asyncpg` (that is only
  in the `async_database_url` property)
- T023 distinction: the existing `0015_fix_articles_rls_policy.sql` IS deleted; the new
  `0002_handle_new_user_trigger.sql` (created in T031) is NOT deleted — these are different files with different names
