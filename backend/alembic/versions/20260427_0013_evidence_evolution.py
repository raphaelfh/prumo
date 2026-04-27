"""extraction_evidence evolution: add workflow FKs + drop legacy NOT NULL

Revision ID: 20260427_0013
Revises: 20260427_0012
Create Date: 2026-04-27
"""

from alembic import op

revision: str = "20260427_0013"
down_revision: str | None = "20260427_0012"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Add 4 nullable workflow FK columns.
    op.execute(
        "ALTER TABLE public.extraction_evidence "
        "ADD COLUMN IF NOT EXISTS run_id uuid REFERENCES public.extraction_runs(id) ON DELETE CASCADE;"
    )
    op.execute(
        "ALTER TABLE public.extraction_evidence "
        "ADD COLUMN IF NOT EXISTS proposal_record_id uuid REFERENCES public.extraction_proposal_records(id) ON DELETE SET NULL;"
    )
    op.execute(
        "ALTER TABLE public.extraction_evidence "
        "ADD COLUMN IF NOT EXISTS reviewer_decision_id uuid REFERENCES public.extraction_reviewer_decisions(id) ON DELETE SET NULL;"
    )
    op.execute(
        "ALTER TABLE public.extraction_evidence "
        "ADD COLUMN IF NOT EXISTS consensus_decision_id uuid REFERENCES public.extraction_consensus_decisions(id) ON DELETE SET NULL;"
    )

    # Drop NOT NULL on legacy target_type / target_id so new rows can omit them.
    op.execute("ALTER TABLE public.extraction_evidence ALTER COLUMN target_type DROP NOT NULL;")
    op.execute("ALTER TABLE public.extraction_evidence ALTER COLUMN target_id DROP NOT NULL;")

    # Helper index for run-scoped queries.
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_extraction_evidence_run_id "
        "ON public.extraction_evidence (run_id);"
    )

    # CHECK constraint: at least one of the workflow FKs (with run_id), OR legacy target.
    op.execute(
        """
        ALTER TABLE public.extraction_evidence
            ADD CONSTRAINT ck_extraction_evidence_workflow_or_legacy_target
            CHECK (
                (run_id IS NOT NULL
                 AND (proposal_record_id IS NOT NULL
                      OR reviewer_decision_id IS NOT NULL
                      OR consensus_decision_id IS NOT NULL))
                OR (target_type IS NOT NULL AND target_id IS NOT NULL)
            );
        """
    )


def downgrade() -> None:
    op.execute(
        "ALTER TABLE public.extraction_evidence "
        "DROP CONSTRAINT IF EXISTS ck_extraction_evidence_workflow_or_legacy_target;"
    )
    op.execute("DROP INDEX IF EXISTS public.idx_extraction_evidence_run_id;")

    # Note: we intentionally do NOT re-apply NOT NULL on target_type/target_id
    # because rows inserted while NULL was allowed may exist; trying to re-add
    # NOT NULL would fail. The columns remain nullable on downgrade.

    op.execute(
        "ALTER TABLE public.extraction_evidence "
        "DROP COLUMN IF EXISTS consensus_decision_id;"
    )
    op.execute(
        "ALTER TABLE public.extraction_evidence "
        "DROP COLUMN IF EXISTS reviewer_decision_id;"
    )
    op.execute(
        "ALTER TABLE public.extraction_evidence "
        "DROP COLUMN IF EXISTS proposal_record_id;"
    )
    op.execute(
        "ALTER TABLE public.extraction_evidence "
        "DROP COLUMN IF EXISTS run_id;"
    )
