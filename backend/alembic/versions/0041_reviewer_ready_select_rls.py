"""Reviewer-scope the extraction_reviewer_ready SELECT policy

Revision ID: 0041_reviewer_ready_select_rls
Revises: 0040_published_state_restrict
Create Date: 2026-07-02

Closes the residual blind-participation leak found by the 2026-07-02 security
review (finding 2). 0029 created the table with a project-member-scoped SELECT
on the rationale that "knowing someone is 'done' leaks no values"; the review
reversed that judgment — WHO marked ready is peer-attributable participation
metadata under the blind contract (ADR-0012), so a blind reviewer hitting
PostgREST directly could learn which peers marked ready even after the API
scrub (``ExtractionReviewerReadyService.ready_summary_from``) landed.

The new policy self-scopes exactly like 0025 does for the workflow tables: a
member may SELECT a ready row only when (a) they authored it (``reviewer_id =
auth.uid()``), (b) they are a project ``manager``/``consensus`` arbitrator
(``is_project_arbitrator``, from 0025 — RLS deliberately stays looser than the
API's per-kind manager toggle, ADR-0012's API-stricter-than-RLS split), or
(c) the run is ``finalized``. INSERT/UPDATE policies were already self-scoped
in 0029 and are untouched. The backend reads this table as ``service_role``
(RLS bypassed) and the frontend never reads it via PostgREST, so the change is
behavior-neutral for the app — it closes the devtools path only.
"""

from alembic import op

revision = "0041_reviewer_ready_select_rls"
down_revision = "0040_published_state_restrict"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Same shape as 0025: join only extraction_runs (carries project_id AND
    # stage; no policy cycle). is_project_arbitrator exists since 0025 with
    # EXECUTE granted to authenticated.
    op.execute(
        'DROP POLICY IF EXISTS "extraction_reviewer_ready_select" '
        "ON public.extraction_reviewer_ready;"
    )
    op.execute(
        """
        CREATE POLICY "extraction_reviewer_ready_select"
            ON public.extraction_reviewer_ready
            FOR SELECT USING (
                EXISTS (
                    SELECT 1 FROM public.extraction_runs r
                    WHERE r.id = extraction_reviewer_ready.run_id
                      AND public.is_project_member(r.project_id, auth.uid())
                      AND (
                            r.stage = 'finalized'::public.extraction_run_stage
                         OR public.is_project_arbitrator(r.project_id, auth.uid())
                         OR extraction_reviewer_ready.reviewer_id = auth.uid()
                      )
                )
            );
        """
    )


def downgrade() -> None:
    # Restore the 0029 project-member-scoped SELECT verbatim.
    op.execute(
        'DROP POLICY IF EXISTS "extraction_reviewer_ready_select" '
        "ON public.extraction_reviewer_ready;"
    )
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
