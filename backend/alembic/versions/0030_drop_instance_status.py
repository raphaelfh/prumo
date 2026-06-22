"""drop legacy extraction_instances.status column + enum

Revision ID: 0030_drop_instance_status
Revises: 0029_reviewer_ready_flag
Create Date: 2026-06-22

HITL Phase 3. The ``extraction_instances.status`` column (PG enum
``extraction_instance_status``: pending/in_progress/completed/reviewed/archived)
is legacy with no remaining writers or readers. The pre-HITL header
``handleFinalize`` path that wrote ``status='completed'`` was unwired in Phase 2
(ADR-0015), and extraction progress now derives solely from field-completeness.
The run lifecycle is owned entirely by ``extraction_runs``
(pending → extract → consensus → finalized; ADR-0014/0015).

This drops the column and the now-orphaned enum type. The data loss is
intentional and accepted: the column carried no load-bearing state. The
``downgrade`` restores the *schema* (enum + nullable column) but NOT the data —
the original per-row values are gone, so every restored row is ``NULL``.
"""

from alembic import op

# revision identifiers, used by Alembic.
revision = "0030_drop_instance_status"
down_revision = "0029_reviewer_ready_flag"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Drop the column first — the enum type cannot be dropped while a column
    # still depends on it.
    op.execute("ALTER TABLE public.extraction_instances DROP COLUMN IF EXISTS status;")
    op.execute("DROP TYPE IF EXISTS public.extraction_instance_status;")


def downgrade() -> None:
    # Recreate the enum, then re-add the column as nullable. Data is NOT
    # restored — the dropped per-row values are gone, so every row is NULL.
    op.execute(
        """
        CREATE TYPE public.extraction_instance_status AS ENUM (
            'pending', 'in_progress', 'completed', 'reviewed', 'archived'
        );
        """
    )
    op.execute(
        "ALTER TABLE public.extraction_instances "
        "ADD COLUMN status public.extraction_instance_status;"
    )
