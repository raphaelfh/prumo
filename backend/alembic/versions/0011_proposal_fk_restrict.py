"""align proposal_record_id FK with the accept_has_proposal CHECK

Revision ID: 0011_proposal_fk_restrict
Revises: 0010_lock_handle_new_user
Create Date: 2026-05-16

``extraction_reviewer_decisions.proposal_record_id`` previously declared
``ON DELETE SET NULL``, but the table also enforces a CHECK constraint
``accept_has_proposal`` (decision <> 'accept_proposal' OR
proposal_record_id IS NOT NULL).

For any reviewer decision with ``decision='accept_proposal'``, PostgreSQL
cannot perform the FK's SET NULL action without violating the CHECK
constraint, so a DELETE on the referenced proposal would surface as a
confusing CHECK-constraint violation instead of the expected RESTRICT
error.

Align the FK with the de-facto behaviour by switching it to RESTRICT —
this preserves the data-integrity guarantee but produces clear,
diagnosable error messages.
"""

from alembic import op

revision = "0011_proposal_fk_restrict"
down_revision = "0010_lock_handle_new_user"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        ALTER TABLE public.extraction_reviewer_decisions
        DROP CONSTRAINT extraction_reviewer_decisions_proposal_record_id_fkey;
        """
    )
    op.execute(
        """
        ALTER TABLE public.extraction_reviewer_decisions
        ADD CONSTRAINT extraction_reviewer_decisions_proposal_record_id_fkey
        FOREIGN KEY (proposal_record_id)
        REFERENCES public.extraction_proposal_records (id)
        ON DELETE RESTRICT;
        """
    )


def downgrade() -> None:
    op.execute(
        """
        ALTER TABLE public.extraction_reviewer_decisions
        DROP CONSTRAINT extraction_reviewer_decisions_proposal_record_id_fkey;
        """
    )
    op.execute(
        """
        ALTER TABLE public.extraction_reviewer_decisions
        ADD CONSTRAINT extraction_reviewer_decisions_proposal_record_id_fkey
        FOREIGN KEY (proposal_record_id)
        REFERENCES public.extraction_proposal_records (id)
        ON DELETE SET NULL;
        """
    )
