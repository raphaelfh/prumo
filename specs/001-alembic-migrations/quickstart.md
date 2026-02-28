# Developer Quickstart: Alembic Migration Workflow

**Feature**: 001-alembic-migrations | **Date**: 2026-02-26

---

## Migration Tool Ownership

| Change type                         | Tool             | Command location            |
|-------------------------------------|------------------|-----------------------------|
| Add/alter application table         | **Alembic**      | `backend/`                  |
| Add RLS policy on application table | **Alembic**      | Same migration as table     |
| Add PostgreSQL function or trigger  | **Alembic**      | `op.execute()` in migration |
| Add/modify storage bucket           | **Supabase CLI** | `supabase/migrations/`      |
| Add/modify storage RLS policies     | **Supabase CLI** | `supabase/migrations/`      |

---

## First-Time Setup (from scratch)

```bash
# 1. Start Supabase local (creates auth + storage infra)
supabase start

# 2. Apply storage configuration (buckets + storage RLS)
supabase db reset     # applies the ONE remaining Supabase migration

# 3. Apply application schema via Alembic
cd backend
uv run alembic upgrade head

# 4. Start the app
uv run uvicorn app.main:app --reload --port 8000
```

---

## Creating a New Application Table Migration

```bash
cd backend

# 1. Modify your SQLAlchemy model (backend/app/models/<entity>.py)

# 2. Auto-generate migration from model diff
uv run alembic revision --autogenerate -m "add_my_table"

# 3. Review the generated file in backend/alembic/versions/
#    Add op.execute() blocks for RLS policies if needed

# 4. Apply
uv run alembic upgrade head
```

> **Note**: The generated file will NOT include RLS policies — add them manually via `op.execute()`.

---

## Applying Migrations in CI

CI runs a full reset on every pull request:

```bash
# In CI pipeline:
supabase db reset                      # Supabase infra reset + 0014_storage migration
cd backend && uv run alembic upgrade head   # Full schema from scratch
pytest                                 # Tests run against clean schema
```

---

## Checking Migration Status

```bash
cd backend

# View current revision
uv run alembic current

# View full history
uv run alembic history --verbose

# View pending migrations
uv run alembic heads
```

---

## Rolling Back

```bash
cd backend

# Roll back one step
uv run alembic downgrade -1

# Roll back to specific revision
uv run alembic downgrade <revision_id>

# Roll back to empty (full teardown)
uv run alembic downgrade base
```

---

## Production Deployments

Migrations run automatically in the deployment pipeline before the application server starts. No manual intervention is
required.

If the app starts and pending migrations exist, it will **refuse to start** and log the pending revision IDs. Run
`alembic upgrade head` to resolve.

---

## Common Mistakes

| Mistake                                         | Correct approach                                                                    |
|-------------------------------------------------|-------------------------------------------------------------------------------------|
| Adding a new table via `supabase migration new` | Use `alembic revision --autogenerate` instead                                       |
| Forgetting RLS after creating a table           | Add `op.execute("ALTER TABLE ... ENABLE ROW LEVEL SECURITY")` in the same migration |
| Creating a storage bucket in Alembic            | Use `supabase migration new` — storage is Supabase's domain                         |
| Modifying `auth.*` tables in Alembic            | Never — auth schema is managed by Supabase exclusively                              |
