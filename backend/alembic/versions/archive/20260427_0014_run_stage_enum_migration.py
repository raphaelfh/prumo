"""run stage enum migration: rebuild with new lifecycle values

Revision ID: 20260427_0014
Revises: 20260427_0013
Create Date: 2026-04-27
"""

from alembic import op

revision: str = "20260427_0014"
down_revision: str | None = "20260427_0013"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Rename the existing enum so we can build a fresh one with new values.
    op.execute("ALTER TYPE public.extraction_run_stage RENAME TO extraction_run_stage_old;")

    # Create the new enum with the lifecycle values.
    op.execute(
        """
        CREATE TYPE public.extraction_run_stage AS ENUM (
            'pending', 'proposal', 'review', 'consensus', 'finalized', 'cancelled'
        );
        """
    )

    # Drop default before changing the column type (PG requires no default during USING cast).
    op.execute("ALTER TABLE public.extraction_runs ALTER COLUMN stage DROP DEFAULT;")

    # Convert the column with explicit CASE-mapping from old labels to new ones.
    op.execute(
        """
        ALTER TABLE public.extraction_runs
            ALTER COLUMN stage TYPE public.extraction_run_stage
            USING (
                CASE stage::text
                    WHEN 'data_suggest' THEN 'proposal'
                    WHEN 'parsing' THEN 'proposal'
                    WHEN 'validation' THEN 'review'
                    WHEN 'consensus' THEN 'consensus'
                    ELSE 'pending'
                END::public.extraction_run_stage
            );
        """
    )

    # Restore a sensible default for new rows.
    op.execute("ALTER TABLE public.extraction_runs ALTER COLUMN stage SET DEFAULT 'pending';")

    # Drop the old enum now that nothing references it.
    op.execute("DROP TYPE public.extraction_run_stage_old;")


def downgrade() -> None:
    # Best-effort downgrade: rebuild the old enum and remap. Some new values
    # have no corresponding old value (`pending`, `finalized`, `cancelled`),
    # so we collapse them onto `data_suggest` to keep rows valid.
    op.execute("ALTER TYPE public.extraction_run_stage RENAME TO extraction_run_stage_new;")
    op.execute(
        """
        CREATE TYPE public.extraction_run_stage AS ENUM (
            'data_suggest', 'parsing', 'validation', 'consensus'
        );
        """
    )
    op.execute("ALTER TABLE public.extraction_runs ALTER COLUMN stage DROP DEFAULT;")
    op.execute(
        """
        ALTER TABLE public.extraction_runs
            ALTER COLUMN stage TYPE public.extraction_run_stage
            USING (
                CASE stage::text
                    WHEN 'pending' THEN 'data_suggest'
                    WHEN 'proposal' THEN 'data_suggest'
                    WHEN 'review' THEN 'validation'
                    WHEN 'consensus' THEN 'consensus'
                    WHEN 'finalized' THEN 'consensus'
                    WHEN 'cancelled' THEN 'data_suggest'
                END::public.extraction_run_stage
            );
        """
    )
    op.execute("ALTER TABLE public.extraction_runs ALTER COLUMN stage SET DEFAULT 'data_suggest';")
    op.execute("DROP TYPE public.extraction_run_stage_new;")
