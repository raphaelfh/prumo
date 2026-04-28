"""drop legacy target_type/target_id from extraction_evidence

Revision ID: 20260428_0017
Revises: 20260427_0016
Create Date: 2026-04-28
"""

from alembic import op

# revision identifiers, used by Alembic.
revision = "20260428_0017"
down_revision = "20260427_0016"
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Drop the polymorphic legacy target columns and tighten the CHECK.

    Migration 0013 made `target_type`/`target_id` nullable so the workflow
    path (run_id + proposal_record_id/decision_id/consensus_decision_id)
    could coexist. The 008 stack that wrote those columns is gone, no live
    rows reference them, and the only remaining external reader was the
    SQLAlchemy mapping itself. Drop the columns and replace the OR-CHECK
    with a workflow-only invariant.
    """
    op.execute(
        """
        ALTER TABLE public.extraction_evidence
            DROP CONSTRAINT IF EXISTS workflow_or_legacy_target;
        """
    )
    op.execute(
        """
        ALTER TABLE public.extraction_evidence
            DROP COLUMN IF EXISTS target_type,
            DROP COLUMN IF EXISTS target_id;
        """
    )
    op.execute(
        """
        ALTER TABLE public.extraction_evidence
            ADD CONSTRAINT workflow_target_present
            CHECK (
                run_id IS NOT NULL
                AND (
                    proposal_record_id IS NOT NULL
                    OR reviewer_decision_id IS NOT NULL
                    OR consensus_decision_id IS NOT NULL
                )
            );
        """
    )


def downgrade() -> None:
    op.execute(
        """
        ALTER TABLE public.extraction_evidence
            DROP CONSTRAINT IF EXISTS workflow_target_present;
        """
    )
    op.execute(
        """
        ALTER TABLE public.extraction_evidence
            ADD COLUMN target_type text,
            ADD COLUMN target_id uuid;
        """
    )
    op.execute(
        """
        ALTER TABLE public.extraction_evidence
            ADD CONSTRAINT workflow_or_legacy_target CHECK (
                (run_id IS NOT NULL
                 AND (proposal_record_id IS NOT NULL
                      OR reviewer_decision_id IS NOT NULL
                      OR consensus_decision_id IS NOT NULL))
                OR (target_type IS NOT NULL AND target_id IS NOT NULL)
            );
        """
    )
