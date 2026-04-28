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
    sql = _BASELINE_SQL_PATH.read_text(encoding="utf-8")
    op.execute(sql)


def downgrade() -> None:
    """Reset the public schema. Destructive — only meaningful in dev."""
    op.execute("DROP SCHEMA IF EXISTS public CASCADE;")
    op.execute("CREATE SCHEMA public;")
