"""Add an expression GIN index for agent full-text search over article text.

Revision ID: 0080_article_text_fts
Revises: 0079_agent_actions
Create Date: 2026-09-24
"""

from alembic import op

revision = "0080_article_text_fts"
down_revision = "0079_agent_actions"


def upgrade() -> None:
    """The MCP tool search_project_text matches with exactly
    to_tsvector('simple', text) @@ websearch_to_tsquery('simple', :q); an
    expression index on the same expression keeps it off a sequential scan.
    'simple' neither stems nor strips accents (the tool description says so).
    Migration-only: env.py include_object ignores DB-only indexes, and a
    generated column would need a model Computed(). Plain, not CONCURRENTLY:
    Alembic runs transactional (0050 precedent), and the table is small
    (~6k rows, 4.2 MB in production on 2026-09-24), so the build is sub-second."""
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_article_text_blocks_fts "
        "ON public.article_text_blocks USING gin (to_tsvector('simple', text))"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS public.idx_article_text_blocks_fts")
