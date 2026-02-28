# Implementation Plan: Alembic Migration Management

**Branch**: `001-alembic-migrations` | **Date**: 2026-02-26 | **Spec**: [spec.md](./spec.md)

## Summary

Replace the project's exclusive reliance on Supabase CLI migrations with a split ownership model: Alembic manages all
application-domain tables in the `public` schema (tables, indexes, RLS policies, functions, triggers, views), while
Supabase CLI retains ownership of storage bucket configuration only. This is a full-replay migration: all existing
Supabase application-domain migration files are deleted and replaced by a single initial Alembic migration that
reproduces the complete `public` schema.

**Constitution note**: This plan constitutes a formal amendment to Constitution Principle III. See Complexity Tracking
below.

## Technical Context

**Language/Version**: Python 3.11+ (backend only — no frontend changes)
**Primary Dependencies**: SQLAlchemy 2.0 (async), asyncpg, FastAPI — adding `alembic>=1.13`
**Storage**: PostgreSQL 15 via Supabase (local: `postgresql://postgres:postgres@localhost:54322/postgres`)
**Testing**: pytest (existing); migration check via `alembic current` in CI
**Target Platform**: Linux server (production) + macOS (local dev)
**Project Type**: Web service (FastAPI backend)
**Performance Goals**: Migration apply time < 60s for full initial migration
**Constraints**: Must not touch `auth.*` or `storage.*` schemas; async SQLAlchemy must continue working unchanged
**Scale/Scope**: 30+ existing Supabase migration files → 1 Alembic initial migration + ongoing autogenerate

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle                                       | Status           | Notes                                                                   |
|-------------------------------------------------|------------------|-------------------------------------------------------------------------|
| I. Layered Architecture                         | ✅ Pass           | No changes to API/Service/Repository/Model layers                       |
| II. Dependency Injection                        | ✅ Pass           | Alembic config reads from `settings`; no new singletons                 |
| **III. Supabase Migrations as Source of Truth** | **⚠️ AMENDMENT** | This feature IS the amendment — see Complexity Tracking                 |
| IV. Security by Design                          | ✅ Pass           | RLS policies migrate to Alembic (same content, new tool). No weakening. |
| V. Typed Everything                             | ✅ Pass           | `env.py` and startup check use full type hints                          |
| VI. Frontend Conventions                        | ✅ Pass           | No frontend changes                                                     |
| VII. Async All The Way                          | ✅ Pass           | `env.py` uses `asyncio.run()` + `connection.run_sync()` bridge          |
| VIII. Standardized API Contract                 | ✅ Pass           | No new endpoints                                                        |

**Technology Table Amendment**: `Database migrations` row changes from `Supabase CLI` to
`Alembic (public schema) + Supabase CLI (storage/auth)`.

## Project Structure

### Documentation (this feature)

```text
specs/001-alembic-migrations/
├── plan.md              # This file
├── research.md          # Phase 0 — resolved decisions
├── data-model.md        # Phase 1 — ownership boundary + entity grouping
├── quickstart.md        # Phase 1 — developer workflow guide
└── tasks.md             # Phase 2 — /speckit.tasks output
```

### Source Code Changes

```text
backend/
├── alembic.ini                             # NEW — Alembic CLI configuration
├── alembic/
│   ├── env.py                              # NEW — async env + include_object filter
│   ├── script.py.mako                      # NEW — migration file template
│   └── versions/
│       └── 0001_initial_public_schema.py   # NEW — full public schema replay
├── app/
│   ├── main.py                             # MODIFIED — startup migration check
│   └── models/
│       └── base.py                         # MODIFIED — naming_convention in Base.metadata
└── pyproject.toml                          # MODIFIED — add alembic dependency

supabase/
└── migrations/
    ├── 0001_storage_bucket_articles.sql    # RETAINED (storage bucket config)
    ├── 0002_handle_new_user_trigger.sql    # NEW — handle_new_user() fn + trigger on auth.users
    └── [all other *.sql files]             # DELETED (36+ files)

.specify/memory/constitution.md             # MODIFIED — amend Principle III + tech table
Makefile                                    # MODIFIED — update db-migrate targets
docs/guias/FLUXO_ALTERACAO_DATABASE.md      # MODIFIED — update workflow guide
.github/workflows/ci.yml                    # MODIFIED — add alembic upgrade after supabase reset
[deployment config]                         # MODIFIED — add pre-start alembic migrate command
```

**Structure Decision**: Backend-only infrastructure change. No frontend files touched. All Alembic files live under
`backend/` alongside the existing Python package.

## Complexity Tracking

| Violation                                                       | Why Needed                                                                                                                                                                        | Simpler Alternative Rejected Because                                                                                                          |
|-----------------------------------------------------------------|-----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|-----------------------------------------------------------------------------------------------------------------------------------------------|
| Constitution Principle III amendment (Alembic MUST NOT be used) | Alembic provides autogenerate, typed migrations, downgrade paths, and standard Python tooling that Supabase CLI raw SQL lacks. The project has outgrown pure Supabase migrations. | Keeping Supabase CLI only: no autogenerate, no downgrade support, no schema diffing — every migration is hand-written SQL with no validation. |

---

## Phase 0: Research Summary

All findings documented in [`research.md`](./research.md). Key decisions:

1. **Async bridge**: `asyncio.run()` + `connection.run_sync()` in `env.py`
2. **auth.users FK**: SQL-only (no SQLAlchemy model FK declaration) — already the case in `user.py`
3. **RLS + functions**: `op.execute()` raw SQL, co-located with table definition
4. **ENUMs**: `op.execute("CREATE TYPE ...")` in initial migration; `PostgreSQLEnumType(create_type=False)` stays
   unchanged at runtime
5. **Startup check**: Sync engine in `lifespan()` startup; `SystemExit(1)` if pending migrations
6. **include_object**: Schema-based filter + static ignore list for Supabase-injected `public` tables
7. **Initial migration**: Single `0001_initial_public_schema.py` with all current SQL
8. **Supabase retained**: Only `0001_storage_bucket_articles.sql`
9. **Naming conventions**: Add to `Base.metadata` for deterministic constraint names

---

## Phase 1: Design

### Step 1 — Add Alembic Dependency

**File**: `backend/pyproject.toml`

Add `"alembic>=1.13"` to the `dependencies` list. Also add `"psycopg[binary]>=3.1"` — required by the startup check in
Step 6, which calls `sqlalchemy.create_engine()` with a standard `postgresql://` URL. The async `asyncpg` driver cannot
be used with a sync engine; without a sync driver, `create_engine()` will raise `ModuleNotFoundError` at startup.

---

### Step 2 — Update Base Metadata with Naming Convention

**File**: `backend/app/models/base.py`

Add SQLAlchemy naming convention to `Base.metadata`. This ensures all future Alembic-generated constraint names are
deterministic.

```python
from sqlalchemy import MetaData

_naming_convention = {
    "ix": "ix_%(column_0_label)s",
    "uq": "uq_%(table_name)s_%(column_0_name)s",
    "ck": "ck_%(table_name)s_%(constraint_name)s",
    "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
    "pk": "pk_%(table_name)s",
}

class Base(DeclarativeBase):
    metadata = MetaData(naming_convention=_naming_convention)
    __table_args__ = {"schema": "public"}
    ...
```

> **Note**: Naming convention only applies to NEW constraints created via Alembic autogenerate. Existing constraints in
> the initial migration keep their original names (they are created via raw SQL `op.execute()`).

---

### Step 3 — Create alembic.ini

**File**: `backend/alembic.ini`

Standard Alembic config file. The `sqlalchemy.url` is set to a placeholder — the actual URL is injected by `env.py` from
`settings.DATABASE_URL`.

Key settings:

- `script_location = alembic` (relative to `backend/`)
- `file_template = %%(year)d%%(month).2d%%(day).2d_%%(rev)s_%%(slug)s`
- `timezone = UTC`
- `sqlalchemy.url = driver://user:pass@localhost/dbname` (placeholder — overridden in env.py)

---

### Step 4 — Create alembic/env.py

**File**: `backend/alembic/env.py`

This is the critical configuration file. It must:

1. **Import all models** so autogenerate can diff them:
   ```python
   from app.models import Base  # triggers all model imports
   target_metadata = Base.metadata
   ```

2. **Override the DB URL** from settings:
   ```python
   from app.core.config import settings
   config.set_main_option("sqlalchemy.url", settings.async_database_url)
   ```

3. **Define `include_object`** to exclude non-public schemas and Supabase-injected tables:
   ```python
   SUPABASE_INJECTED_TABLES = {
       "spatial_ref_sys", "geography_columns", "geometry_columns",
       "raster_columns", "raster_overviews",
   }

   def include_object(object, name, type_, reflected, compare_to):
       if type_ == "table":
           schema = getattr(object, "schema", None)
           if schema is not None and schema != "public":
               return False
           if name in SUPABASE_INJECTED_TABLES:
               return False
       return True
   ```

4. **Configure `run_migrations_online()`** with async bridge:
   ```python
   def do_run_migrations(connection):
       context.configure(
           connection=connection,
           target_metadata=target_metadata,
           include_object=include_object,
           include_schemas=False,
           compare_type=True,
       )
       with context.begin_transaction():
           context.run_migrations()

   async def run_async_migrations():
       connectable = async_engine_from_config(
           config.get_section(config.config_ini_section),
           prefix="sqlalchemy.",
       )
       async with connectable.connect() as connection:
           await connection.run_sync(do_run_migrations)
       await connectable.dispose()

   def run_migrations_online() -> None:
       asyncio.run(run_async_migrations())
   ```

5. **Support offline mode** for SQL script generation (no DB connection required).

---

### Step 5 — Create Initial Alembic Migration

**File**: `backend/alembic/versions/0001_initial_public_schema.py`

This migration contains the full `public` schema as raw SQL via `op.execute()`. Content is sourced from all deleted
Supabase migration files.

**Structure of `upgrade()`** (in dependency order):

```python
def upgrade() -> None:
    # ── Extensions ───────────────────────────────────────────
    op.execute("CREATE EXTENSION IF NOT EXISTS pgcrypto")
    op.execute("CREATE EXTENSION IF NOT EXISTS pg_trgm")
    op.execute("CREATE EXTENSION IF NOT EXISTS btree_gin")

    # ── Helper functions ──────────────────────────────────────
    op.execute("""CREATE OR REPLACE FUNCTION set_updated_at() ...""")
    # NOTE: handle_new_user() is excluded — it fires ON auth.users and must stay in Supabase migrations (see Step 5a)
    # ... all functions from 0003, 0023, 0025, 0026 (is_project_member, is_project_manager, etc.) ...

    # ── ENUM types ────────────────────────────────────────────
    op.execute("CREATE TYPE review_type AS ENUM (...)")
    op.execute("CREATE TYPE project_member_role AS ENUM (...)")
    # ... all 14 ENUMs from 0002 ...

    # ── Core tables (in FK dependency order) ──────────────────
    op.execute("""CREATE TABLE profiles (..., FOREIGN KEY (id) REFERENCES auth.users(id) ...)""")
    op.execute("""CREATE TABLE projects (...)""")
    op.execute("""CREATE TABLE project_members (...)""")
    # ... articles, article_files, extraction_*, assessment_*, ai_*, integrations, feedback ...

    # ── All later schema changes (0015 through 20260219...) ───
    # (inline, not as separate migrations)

    # ── Indexes ───────────────────────────────────────────────
    op.execute("CREATE INDEX ...")  # all from 0011 + 20251215

    # ── RLS policies ──────────────────────────────────────────
    op.execute("ALTER TABLE profiles ENABLE ROW LEVEL SECURITY")
    op.execute("""CREATE POLICY "Users can view own profile" ON profiles ...""")
    # ... all policies from 0012, 0015, 0020, 0036 ...

    # ── Triggers ──────────────────────────────────────────────
    op.execute("CREATE TRIGGER ...")  # all from 0013

    # ── Compatibility views ───────────────────────────────────
    op.execute("CREATE VIEW ...")  # 0031, 20260129..., 20260218...

    # ── Seed data ─────────────────────────────────────────────
    op.execute("INSERT INTO assessment_instruments ...")  # 0029
```

**`downgrade()`**: Drops all tables in reverse FK order, drops all types, drops all extensions. Full teardown.

> **Implementation note**: The initial migration is intentionally one large file. It is the baseline and is never
> modified after the initial cutover. All future migrations are small, targeted, autogenerate-based files.

---

### Step 5a — Create Supabase Migration for auth.users Trigger

**File**: `supabase/migrations/0002_handle_new_user_trigger.sql`

The `handle_new_user()` function and its trigger on `auth.users` cannot be managed by Alembic — the trigger fires on a
Supabase-owned table. Additionally, `CREATE TRIGGER` validates that the referenced function exists at creation time, and
since `supabase db reset` runs **before** `alembic upgrade head`, both the function AND the trigger must live in the
same Supabase migration file.

```sql
-- Kept in Supabase migrations: trigger fires ON auth.users (Supabase-managed table).
-- CREATE TRIGGER validates function existence at creation time, so both must be co-located.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
  -- (copy function body verbatim from supabase/migrations/0001_base_schema.sql)
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE TRIGGER handle_new_user
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();
```

> **Execution order**: `supabase db reset` applies 0014 (storage bucket) then 0015 (handle_new_user function + trigger).
`alembic upgrade head` then creates `public.profiles` and all other application tables. New user sign-ups only happen at
> runtime — by which time both steps are complete and the function body can INSERT into `public.profiles`.

---

### Step 6 — Add Startup Migration Check

**File**: `backend/app/main.py`

Add `check_pending_migrations()` as an async function called at the top of the `lifespan()` startup block.

```python
from alembic.config import Config
from alembic.script import ScriptDirectory
from alembic.runtime.migration import MigrationContext
from sqlalchemy import create_engine

async def check_pending_migrations() -> None:
    """Check for unapplied Alembic migrations. Exit if any are pending."""
    alembic_cfg = Config("alembic.ini")
    script = ScriptDirectory.from_config(alembic_cfg)

    def _get_pending(conn):
        ctx = MigrationContext.configure(conn)
        current_heads = set(ctx.get_current_heads())
        target_heads = set(script.get_heads())
        return target_heads - current_heads

    sync_url = settings.DATABASE_URL.unicode_string()  # PostgresDsn → plain postgresql:// URL (no +asyncpg)
    engine = create_engine(sync_url)
    try:
        with engine.connect() as conn:
            pending = _get_pending(conn)
    finally:
        engine.dispose()

    if pending:
        logger.error(
            "unapplied_migrations_detected",
            pending_revisions=list(pending),
            action="refusing_to_start",
        )
        raise SystemExit(1)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    configure_logging()
    await check_pending_migrations()   # ← ADD THIS LINE
    logger.info("application_startup", ...)
    yield
    logger.info("application_shutdown")
```

---

### Step 7 — Delete Supabase Application Migrations

**Directory**: `supabase/migrations/`

Delete all migration files **except** `0001_storage_bucket_articles.sql` and `0002_handle_new_user_trigger.sql` (created
in Step 5a).

> **Important**: The existing `0015_fix_articles_rls_policy.sql` IS deleted (its content is absorbed into the initial
> Alembic migration). The new `0002_handle_new_user_trigger.sql` (created in Step 5a) is a different file and must NOT be
> deleted.

Files to delete (36 files):

```
0001_base_schema.sql
0002_enums.sql
0003_core_tables.sql
0004_annotations.sql
0005_extraction_templates.sql
0006_extraction_data.sql
0007_extraction_ai.sql
0008_assessment.sql
0009_integrations.sql
0010_feedback.sql
0011_indexes.sql
0012_rls_policies.sql
0013_triggers.sql
0015_fix_articles_rls_policy.sql
0016_extraction_hierarchy_validation.sql
0017_charms_2_0_complete_template.sql
0018_fields_other_option.sql
0019_migrate_charms_template_other_fields.sql
0020_add_project_delete_policy.sql
0022_user_api_keys.sql
0023_add_create_project_with_member_function.sql
0024_add_missing_updated_at_columns.sql
0025_add_find_user_by_email_function.sql
0026_add_get_project_members_function.sql
0027_ai_assessment_runs.sql
0028_extend_ai_suggestions_for_assessments.sql
0029_seed_probast_instrument.sql
0030_assessment_restructure.sql
0031_assessment_compatibility_view.sql
0032_cleanup_legacy_assessment.sql
0033_ai_suggestions_assessment_support.sql
0034_project_assessment_instruments.sql
0035_add_target_mode_column.sql
0036_rls_ai_suggestions_extraction_and_assessment.sql
20251215_add_unique_constraints_and_indexes.sql
20260129120420_restore_assessments_compatibility_view.sql
20260218000000_fix_assessments_view_project_instruments.sql
20260219000000_fix_ai_suggestions_nullable_extraction_run_id.sql
20260219000001_ai_suggestions_project_assessment_item.sql
```

> **Note on 0021**: The listing showed a gap at 0021. If this file exists, audit before deleting.

---

### Step 8 — Update Makefile

**File**: `Makefile`

Update database-related targets:

```makefile
# Database - Supabase (auth + storage infra)
db-reset:
    supabase db reset

# Database - Alembic (application schema)
db-migrate:
    cd backend && uv run alembic upgrade head

db-rollback:
    cd backend && uv run alembic downgrade -1

db-history:
    cd backend && uv run alembic history --verbose

db-current:
    cd backend && uv run alembic current

db-generate:
    cd backend && uv run alembic revision --autogenerate -m "$(MSG)"

# Full local setup (first time or after reset)
db-setup: db-reset db-migrate
```

Remove or rename old `supabase db push` / `supabase migration` targets that no longer apply.

---

### Step 8a — Update CI Workflow

**File**: `.github/workflows/ci.yml` (or equivalent CI configuration)

After the `supabase db reset` step, add `alembic upgrade head` so the full application schema is applied before tests
run:

```yaml
- name: Reset Supabase infra (auth + storage)
  run: supabase db reset

- name: Apply application schema (Alembic)
  run: cd backend && uv run alembic upgrade head

- name: Run tests
  run: cd backend && uv run pytest
```

This satisfies SC-006 (CI applies both Supabase infra and Alembic application schema on every run). Without this step,
`pytest` runs against a database with `auth` and `storage` infra only — no application tables.

---

### Step 8b — Update Deployment Pipeline

**File**: Deployment configuration (`render.yaml`, `Procfile`, Dockerfile, or CI/CD pipeline)

Add `alembic upgrade head` as a pre-start step before the application server launches. This satisfies FR-012 (migrations
run automatically on every deployment):

```yaml
# render.yaml example
services:
  - type: web
    buildCommand: cd backend && uv sync
    startCommand: cd backend && uv run alembic upgrade head && uv run uvicorn app.main:app --host 0.0.0.0 --port $PORT
```

> **Note**: The `check_pending_migrations()` startup check in `main.py` (Step 6) guards against starts with a stale
> schema, but the pre-start command ensures migrations run automatically without manual intervention.

---

### Step 9 — Amend Constitution

**File**: `.specify/memory/constitution.md`

**Principle III** — Change from:
> "The database schema MUST be defined exclusively in `supabase/migrations/` SQL files. Alembic MUST NOT be used."

To:
> "Application domain tables (in the `public` schema) MUST be managed via Alembic. Supabase CLI manages only storage
> buckets and storage RLS policies. The `auth.*` and `storage.*` schemas are never touched by Alembic."

**Technology Table** — Change `Database migrations` row from:
> `Supabase CLI` / `` `supabase migration new`, `supabase db reset` ``

To:
> `Alembic (public schema) + Supabase CLI (storage)` / `` `alembic revision --autogenerate`, `alembic upgrade head` ``

**File Location Conventions Table** — Change `Migration` row from:
> `supabase/migrations/{NNNN}_{description}.sql`

To:
> `backend/alembic/versions/{rev}_{description}.py` (application tables) or `supabase/migrations/` (storage buckets
> only)

---

### Step 10 — Update Developer Guide

**File**: `docs/guias/FLUXO_ALTERACAO_DATABASE.md`

Update the migration workflow guide to reflect the new split ownership model. Reference `quickstart.md` for command
reference. Replace all Supabase-migration-focused guidance for application tables with Alembic instructions.

---

### Step 11 — Verify and Test

After all steps:

1. `supabase db reset` — applies Supabase infra (auth + `0001_storage_bucket_articles.sql`)
2. `cd backend && uv run alembic upgrade head` — applies full application schema from scratch
3. `uv run alembic current` — should show `0001_initial_public_schema (head)`
4. `uv run alembic revision --autogenerate -m "test_autogenerate"` — generated file should be empty (no diff)
5. `uv run pytest` — full test suite passes
6. `uv run uvicorn app.main:app --port 8000` — app starts without migration errors
7. Simulate pending migration: comment out initial migration → app should refuse to start

---

## Constitution Check: Post-Design

| Principle                                   | Status    | Notes                                                             |
|---------------------------------------------|-----------|-------------------------------------------------------------------|
| I. Layered Architecture                     | ✅ Pass    | Migration infrastructure is outside the layer model               |
| II. Dependency Injection                    | ✅ Pass    | Alembic reads settings; startup check disposed after use          |
| III. Supabase Migrations as Source of Truth | ✅ Amended | New principle: Alembic owns `public`, Supabase CLI owns storage   |
| IV. Security by Design                      | ✅ Pass    | RLS policies identically reproduced in Alembic initial migration  |
| V. Typed Everything                         | ✅ Pass    | `env.py` and `check_pending_migrations()` fully typed             |
| VI. Frontend Conventions                    | ✅ Pass    | Not applicable                                                    |
| VII. Async All The Way                      | ✅ Pass    | Startup check uses sync engine (disposable); app engine unchanged |
| VIII. Standardized API Contract             | ✅ Pass    | Not applicable                                                    |
