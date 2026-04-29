"""Squashed baseline v1 — captures the full ``public`` schema at HEAD

Revision ID: 0001_baseline_v1
Revises:
Create Date: 2026-04-28

This single migration replaces the original 18-migration trail (now in
``versions/archive/``). It reproduces the exact schema that ``alembic
upgrade head`` produced after migrations 0001 through 20260428_0019,
captured via ``supabase db dump --local --schema=public`` and lightly
cleaned (OWNER statements + alembic_version stripped).

**For existing dev databases** (already at 20260428_0019): run
``alembic stamp 0001_baseline_v1`` once. Do NOT ``alembic upgrade`` —
the schema already exists; this baseline is purely declarative.

**For fresh databases**: ``alembic upgrade head`` runs this baseline
and produces the same schema as the previous 18 migrations would have
produced.

The raw DDL lives in ``baseline_v1.sql`` next to this file. Keeping it
as a separate ``.sql`` file (instead of inline in Python) keeps the
diff readable and lets the schema be inspected directly without
running Python.

See ``docs/architecture/migrations.md`` for the squash strategy.
"""

from pathlib import Path

from alembic import op

# revision identifiers, used by Alembic.
revision = "0001_baseline_v1"
down_revision = None
branch_labels = None
depends_on = None


_BASELINE_SQL_PATH = Path(__file__).parent / "baseline_v1.sql"


def upgrade() -> None:
    """Replay the baseline DDL against the connection bound to alembic.

    The dump produced by ``supabase db dump`` contains multiple
    semicolon-separated statements. asyncpg (the driver wired through
    ``alembic/env.py``) refuses prepared statements with multiple
    commands, so we drop down to the raw asyncpg connection's
    ``execute()`` (no prepare) which accepts a script verbatim.

    PL/pgSQL function bodies are checked at CREATE time by default
    (``check_function_bodies = on``); the dump intersperses CREATE
    FUNCTION before the tables those bodies reference, so we disable
    body validation for the duration of the script. The setting is
    session-local — no persistent effect on the database.
    """
    sql = _BASELINE_SQL_PATH.read_text(encoding="utf-8")
    # `supabase db dump --schema=public` strips CREATE EXTENSION lines,
    # but `idx_articles_trgm_title` references `public.gin_trgm_ops`.
    # Re-create the extension defensively (a no-op when Supabase already
    # provisioned it) so a fresh DB can replay the baseline.
    preamble = (
        "CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;\n"
        "SET check_function_bodies = false;\n"
    )
    script = preamble + sql

    bind = op.get_bind()
    raw_connection = bind.connection
    asyncpg_connection = raw_connection.driver_connection
    awaitable_runner = raw_connection.await_

    awaitable_runner(asyncpg_connection.execute(script))


def downgrade() -> None:
    """Reset the public schema. Destructive — only meaningful in dev."""
    bind = op.get_bind()
    raw_connection = bind.connection
    asyncpg_connection = raw_connection.driver_connection
    awaitable_runner = raw_connection.await_

    awaitable_runner(
        asyncpg_connection.execute("DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;")
    )
