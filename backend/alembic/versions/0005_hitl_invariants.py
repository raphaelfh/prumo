"""HITL invariants: composite FK ties reviewer state to its run

Revision ID: 0005_hitl_invariants
Revises: 0004_template_active_version
Create Date: 2026-04-28

``extraction_reviewer_states.current_decision_id`` only had a simple FK
to ``extraction_reviewer_decisions(id)``. Nothing at the DB level
prevented a state row in run A from pointing at a decision that lives
in run B — the application layer was the only thing keeping the
coordinates aligned, and a single bad write would corrupt the
materialized current-decision view forever (the unique key on the
state table is per-run, so the bad pointer can never be repaired by
upsert).

Replace the simple FK with a composite ``(run_id, current_decision_id)``
FK that references ``extraction_reviewer_decisions(run_id, id)``. The
target needs a unique constraint covering those two columns, so we
add a unique index first. ``id`` is already PK so the index is just a
formality, but Postgres requires it for composite FK targets.
"""

from alembic import op

revision = "0005_hitl_invariants"
down_revision = "0004_template_active_version"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        ALTER TABLE public.extraction_reviewer_decisions
        ADD CONSTRAINT uq_extraction_reviewer_decisions_run_id
        UNIQUE (run_id, id);
        """
    )
    op.execute(
        """
        ALTER TABLE public.extraction_reviewer_states
        DROP CONSTRAINT extraction_reviewer_states_current_decision_id_fkey;
        """
    )
    op.execute(
        """
        ALTER TABLE public.extraction_reviewer_states
        ADD CONSTRAINT fk_extraction_reviewer_states_decision_run_match
        FOREIGN KEY (run_id, current_decision_id)
        REFERENCES public.extraction_reviewer_decisions (run_id, id)
        ON DELETE RESTRICT;
        """
    )


def downgrade() -> None:
    op.execute(
        """
        ALTER TABLE public.extraction_reviewer_states
        DROP CONSTRAINT fk_extraction_reviewer_states_decision_run_match;
        """
    )
    op.execute(
        """
        ALTER TABLE public.extraction_reviewer_states
        ADD CONSTRAINT extraction_reviewer_states_current_decision_id_fkey
        FOREIGN KEY (current_decision_id)
        REFERENCES public.extraction_reviewer_decisions (id)
        ON DELETE RESTRICT;
        """
    )
    op.execute(
        """
        ALTER TABLE public.extraction_reviewer_decisions
        DROP CONSTRAINT uq_extraction_reviewer_decisions_run_id;
        """
    )
