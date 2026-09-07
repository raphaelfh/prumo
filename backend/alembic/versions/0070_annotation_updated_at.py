"""Give article_boxes and article_highlights the ``updated_at`` their model declares.

The three PDF-annotation tables are siblings from the same Supabase era, and
``article_annotations`` is the only one that came out with ``updated_at`` — the
other two carry ``created_at`` alone. Every model in this codebase inherits
``TimestampMixin``, so ``ArticleBox`` and ``ArticleHighlight`` have always
declared a column the schema does not have. ``alembic check`` reported it; the
tables have no server-side reader yet, which is why nothing broke.

The model is the correct side here, not the database: dropping the column from
the two models would make them the only tables in the schema without
``updated_at``, and would leave them out of step with the sibling they were
written alongside.

Trigger included for the same reason. These tables are written by the browser
through PostgREST, which sends no ``updated_at``; ``article_annotations`` keeps
its column honest with ``trg_article_annotations_updated_at``, so these two get
the same one rather than a column frozen at insert time.

Revision ID: 0070_annotation_updated_at
Revises: 0069_entry_group_trees
"""

from alembic import op

revision = "0070_annotation_updated_at"
down_revision = "0069_entry_group_trees"
branch_labels = None
depends_on = None

_TABLES = ("article_boxes", "article_highlights")


def upgrade() -> None:
    for table in _TABLES:
        op.execute(
            f"ALTER TABLE public.{table} "
            f"ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now()"
        )
        # CREATE OR REPLACE: re-running against a database that already has the
        # trigger is a no-op, matching how the baseline declares the sibling's.
        op.execute(
            f"CREATE OR REPLACE TRIGGER trg_{table}_updated_at "
            f"BEFORE UPDATE ON public.{table} "
            f"FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column()"
        )


def downgrade() -> None:
    for table in _TABLES:
        op.execute(f"DROP TRIGGER IF EXISTS trg_{table}_updated_at ON public.{table}")
        op.execute(f"ALTER TABLE public.{table} DROP COLUMN IF EXISTS updated_at")
