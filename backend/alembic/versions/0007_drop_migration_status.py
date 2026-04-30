"""drop legacy migration_status table

Revision ID: 0007_drop_migration_status
Revises: 0006_article_text_blocks
Create Date: 2026-04-29

The ``migration_status`` table came in via the squashed ``baseline_v1.sql``
(it was created by an earlier project's bespoke migration tracker, before
the project standardised on Alembic). No application code reads or writes
it, so it's pure dead weight and triggers a ``rls_disabled_in_public``
advisor lint.
"""

from alembic import op

# revision identifiers, used by Alembic.
revision = "0007_drop_migration_status"
down_revision = "0006_article_text_blocks"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("DROP TABLE IF EXISTS public.migration_status CASCADE;")


def downgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS public.migration_status (
            id SERIAL PRIMARY KEY,
            migration_name VARCHAR NOT NULL UNIQUE,
            executed_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
            notes TEXT
        );
        """
    )
