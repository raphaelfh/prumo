"""Composite FK on consensus decisions: forbid cross-run selected_decision_id

Revision ID: 0012_consensus_decision_run_fk
Revises: 0011_proposal_fk_restrict
Create Date: 2026-05-16

``ExtractionConsensusDecision.selected_decision_id`` only had a simple
FK to ``extraction_reviewer_decisions(id)``. Nothing at the DB level
prevented a consensus row in run A from pointing at a reviewer
decision that belongs to a different run. The service layer guards
against this in normal flow, but a direct DB write (or any future
service path that omits the check) could corrupt the consensus stage.

Mirror migration 0005's fix for ``extraction_reviewer_states``: drop
the simple FK and replace it with a composite
``(run_id, selected_decision_id)`` FK that references
``extraction_reviewer_decisions(run_id, id)`` — the target unique
constraint already exists from 0005.
"""

from alembic import op

revision = "0012_consensus_decision_run_fk"
down_revision = "0011_proposal_fk_restrict"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        ALTER TABLE public.extraction_consensus_decisions
        DROP CONSTRAINT IF EXISTS extraction_consensus_decisions_selected_decision_id_fkey;
        """
    )
    op.execute(
        """
        ALTER TABLE public.extraction_consensus_decisions
        ADD CONSTRAINT fk_extraction_consensus_decisions_selected_run_match
        FOREIGN KEY (run_id, selected_decision_id)
        REFERENCES public.extraction_reviewer_decisions (run_id, id)
        ON DELETE SET NULL;
        """
    )


def downgrade() -> None:
    op.execute(
        """
        ALTER TABLE public.extraction_consensus_decisions
        DROP CONSTRAINT IF EXISTS fk_extraction_consensus_decisions_selected_run_match;
        """
    )
    op.execute(
        """
        ALTER TABLE public.extraction_consensus_decisions
        ADD CONSTRAINT extraction_consensus_decisions_selected_decision_id_fkey
        FOREIGN KEY (selected_decision_id)
        REFERENCES public.extraction_reviewer_decisions (id)
        ON DELETE SET NULL;
        """
    )
