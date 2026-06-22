"""Per-reviewer 'ready' signal table (HITL Phase 2)

Revision ID: 0029_reviewer_ready_flag
Revises: 0028_run_stage_extract
Create Date: 2026-06-21

A new per-(run, reviewer) row recording that a reviewer has finished extracting.
Advisory only (the manager opens consensus manually); it does NOT gate any stage
transition. Grain is run+reviewer (one row per reviewer per run), distinct from the
per-coordinate extraction_reviewer_states. RLS: SELECT for any project member (knowing
someone is "done" leaks no values); INSERT/UPDATE self-scoped to the authoring reviewer
who must also be a project reviewer. The policy joins extraction_runs for project_id and
references no enum-typed column, so no enum drop/recreate dance is needed.
"""

from alembic import op

revision = "0029_reviewer_ready_flag"
down_revision = "0028_run_stage_extract"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE public.extraction_reviewer_ready (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            run_id uuid NOT NULL REFERENCES public.extraction_runs(id) ON DELETE CASCADE,
            reviewer_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
            is_ready boolean NOT NULL DEFAULT false,
            marked_ready_at timestamptz,
            created_at timestamptz NOT NULL DEFAULT now(),
            updated_at timestamptz NOT NULL DEFAULT now(),
            CONSTRAINT uq_extraction_reviewer_ready_run_reviewer UNIQUE (run_id, reviewer_id)
        );
        """
    )
    op.execute(
        "CREATE INDEX ix_extraction_reviewer_ready_run_id "
        "ON public.extraction_reviewer_ready (run_id);"
    )
    op.execute("ALTER TABLE public.extraction_reviewer_ready ENABLE ROW LEVEL SECURITY;")
    op.execute(
        """
        CREATE POLICY "extraction_reviewer_ready_select"
            ON public.extraction_reviewer_ready
            FOR SELECT USING (
                EXISTS (
                    SELECT 1 FROM public.extraction_runs r
                    WHERE r.id = extraction_reviewer_ready.run_id
                      AND public.is_project_member(r.project_id, auth.uid())
                )
            );
        """
    )
    op.execute(
        """
        CREATE POLICY "extraction_reviewer_ready_insert"
            ON public.extraction_reviewer_ready
            FOR INSERT WITH CHECK (
                extraction_reviewer_ready.reviewer_id = auth.uid()
                AND EXISTS (
                    SELECT 1 FROM public.extraction_runs r
                    WHERE r.id = extraction_reviewer_ready.run_id
                      AND public.is_project_reviewer(r.project_id, auth.uid())
                )
            );
        """
    )
    op.execute(
        """
        CREATE POLICY "extraction_reviewer_ready_update"
            ON public.extraction_reviewer_ready
            FOR UPDATE USING (
                extraction_reviewer_ready.reviewer_id = auth.uid()
                AND EXISTS (
                    SELECT 1 FROM public.extraction_runs r
                    WHERE r.id = extraction_reviewer_ready.run_id
                      AND public.is_project_reviewer(r.project_id, auth.uid())
                )
            );
        """
    )


def downgrade() -> None:
    op.execute(
        'DROP POLICY IF EXISTS "extraction_reviewer_ready_update" '
        "ON public.extraction_reviewer_ready;"
    )
    op.execute(
        'DROP POLICY IF EXISTS "extraction_reviewer_ready_insert" '
        "ON public.extraction_reviewer_ready;"
    )
    op.execute(
        'DROP POLICY IF EXISTS "extraction_reviewer_ready_select" '
        "ON public.extraction_reviewer_ready;"
    )
    op.execute("DROP TABLE IF EXISTS public.extraction_reviewer_ready;")
