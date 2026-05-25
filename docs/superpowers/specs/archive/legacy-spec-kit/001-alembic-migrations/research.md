# Research: Alembic Migration Management

**Feature**: 001-alembic-migrations | **Date**: 2026-02-26

---

## 1. Alembic Async Setup with asyncpg + SQLAlchemy 2.0

**Decision**: Use `asyncio.run()` in `env.py` wrapping `connection.run_sync(context.run_migrations)`.

**Rationale**: SQLAlchemy 2.0 async sessions use `AsyncEngine`, but Alembic's migration context requires a synchronous
connection interface. The `run_sync` bridge provides this without changing async models.

**Pattern**:

```python
# env.py
import asyncio
from sqlalchemy.ext.asyncio import async_engine_from_config

def run_migrations_online() -> None:
    connectable = async_engine_from_config(config.get_section(config.config_ini_section))

    async def run_async() -> None:
        async with connectable.connect() as connection:
            await connection.run_sync(do_run_migrations)

    asyncio.run(run_async())
```

**Alternatives considered**:

- Sync engine in env.py only (separate from async app engine): Would work but requires maintaining two connection
  configs. Rejected in favor of sharing the same `DATABASE_URL`.
- `alembic-utils`: External library for managing PG-specific objects. Rejected — adds dependency, raw SQL in
  `op.execute()` is simpler and more transparent.

---

## 2. Cross-Schema Foreign Keys (auth.users)

**Decision**: Declare FKs to `auth.users` only in raw migration SQL via `op.execute()`. Do NOT declare them in
SQLAlchemy model metadata.

**Rationale**: SQLAlchemy's `include_schemas` would cause Alembic to reflect the `auth` schema and detect all
Supabase-managed tables as "missing" from metadata. Keeping the FK only in SQL bypasses this entirely. The `profiles`
model already does this (no FK in the Python model definition — confirmed in `user.py`).

**Alternatives considered**:

- `include_schemas=True` + per-schema include_object filter: Works but adds complexity. The filter already exists for
  schema-based isolation.
- Declaring FK in Python with `ForeignKey("auth.users.id")` + `include_schemas=True`: Requires telling Alembic to
  reflect auth schema but not manage it. Too fragile.

---

## 3. RLS Policies and PostgreSQL Functions in Alembic

**Decision**: Use `op.execute()` for raw SQL in migration files for: `ALTER TABLE ENABLE ROW LEVEL SECURITY`,
`CREATE POLICY`, `CREATE FUNCTION`, `CREATE TRIGGER`, `CREATE OR REPLACE FUNCTION`.

**Rationale**: Alembic does not natively model RLS policies or PG functions. `op.execute()` is the standard Alembic
escape hatch for database-specific DDL. All RLS and function SQL goes in the same migration as the table it belongs to.

**Convention**:

```python
def upgrade() -> None:
    # 1. Create table
    op.create_table("projects", ...)

    # 2. Enable RLS
    op.execute("ALTER TABLE projects ENABLE ROW LEVEL SECURITY")

    # 3. Create policies
    op.execute("""
        CREATE POLICY "Users can view accessible projects"
        ON projects FOR SELECT
        USING (is_project_member(id, auth.uid()))
    """)
```

**Downgrade**: Drop policies before dropping table (or rely on table cascade).

---

## 4. ENUM Type Handling

**Decision**: Create PostgreSQL ENUM types via `op.execute("CREATE TYPE ... AS ENUM (...)")` in the initial migration.
Keep `PostgreSQLEnumType(create_type=False)` in Python models at runtime (types already exist in DB).

**Rationale**: `create_type=False` in `PostgreSQLEnumType` is correct for runtime — the type exists in the DB. For
Alembic autogenerate, native `sa.Enum` objects with `create_type=True` would be needed, but since enums are created as
raw SQL in the initial migration, future enum changes will also use `op.execute("ALTER TYPE ... ADD VALUE ...")`. This
avoids needing `alembic-utils` or the `--autogenerate` enum detection path.

**Naming convention in initial migration**: All 14 ENUM types defined in `POSTGRESQL_ENUM_VALUES` (base.py) are created
in the first migration section, before any tables reference them.

---

## 5. Startup Migration Check

**Decision**: Add a migration check to FastAPI's `lifespan()` startup phase. If pending migrations exist, raise
`SystemExit(1)` with structured log output.

**Rationale**: Fail-fast at startup prevents runtime errors from missing columns/tables. Using
`alembic.script.ScriptDirectory` + `alembic.runtime.migration.MigrationContext` gives a reliable check without running
migrations.

**Pattern**:

```python
from alembic.config import Config
from alembic.script import ScriptDirectory
from alembic.runtime.migration import MigrationContext
from sqlalchemy import create_engine, text

async def check_migrations() -> None:
    alembic_cfg = Config("alembic.ini")
    script = ScriptDirectory.from_config(alembic_cfg)

    def _check(conn):
        context = MigrationContext.configure(conn)
        current = set(context.get_current_heads())
        target = set(script.get_heads())
        return target - current

    engine = create_engine(settings.DATABASE_URL.unicode_string())
    with engine.connect() as conn:
        pending = _check(conn)

    if pending:
        logger.error("unapplied_migrations", pending=list(pending))
        raise SystemExit(1)
```

**Note**: Uses a sync engine for the check (simpler, no async bridge needed). Engine is created and discarded — not the
app's main async engine.

---

## 6. include_object Filter Configuration

**Decision**: Filter by schema AND a static ignore list for known Supabase-injected `public` tables.

**Pattern**:

```python
SUPABASE_INJECTED_TABLES = {
    "spatial_ref_sys",
    "geography_columns",
    "geometry_columns",
    "raster_columns",
    "raster_overviews",
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

---

## 7. Initial Migration Strategy

**Decision**: Single initial migration (`0001_initial_public_schema.py`) using raw `op.execute()` for the complete SQL,
structured in this order:

1. Extensions (`pgcrypto`, `pg_trgm`, `btree_gin`)
2. Helper functions (`set_updated_at`, `handle_new_user`, etc.)
3. ENUM types (all 14 from `POSTGRESQL_ENUM_VALUES`)
4. Tables (in dependency order: profiles → projects → project_members → articles → ...)
5. Indexes (from `0011_indexes.sql` + `20251215_add_unique_constraints_and_indexes.sql`)
6. RLS policies (all application table policies)
7. Triggers
8. Views (compatibility views from `0031`, `0032`, `20260129...`, `20260218...`)
9. Seed data (instruments from `0029_seed_probast_instrument.sql`)
10. Additional schema changes from all later migrations (0015 through 20260219...)

**Rationale**: All current SQL content becomes one baseline. Future schema changes use autogenerate + manual
op.execute() for RLS/functions.

**Supabase migrations that STAY** (only): `0001_storage_bucket_articles.sql` — because it references `storage.objects`
which is owned by Supabase. All other migration files are deleted.

---

## 8. Alembic.ini Connection URL

**Decision**: `alembic.ini` stores a placeholder URL (`driver://user:pass@host/dbname`). The actual URL is read from
`settings.DATABASE_URL` in `env.py`, overriding the ini value at runtime.

**Rationale**: Secrets must not be in config files. The pattern of reading settings in `env.py` is standard for
FastAPI + Alembic.

---

## 9. Naming Conventions in Base Metadata

**Decision**: Add SQLAlchemy naming conventions to `Base.metadata` to ensure constraint names in Alembic migrations are
deterministic and consistent.

**Pattern**:

```python
from sqlalchemy import MetaData

convention = {
    "ix": "ix_%(column_0_label)s",
    "uq": "uq_%(table_name)s_%(column_0_name)s",
    "ck": "ck_%(table_name)s_%(constraint_name)s",
    "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
    "pk": "pk_%(table_name)s",
}

class Base(DeclarativeBase):
    metadata = MetaData(naming_convention=convention)
```

**Note**: Naming conventions only affect NEW constraints created via Alembic. Existing constraints from the initial
migration retain their original names.
