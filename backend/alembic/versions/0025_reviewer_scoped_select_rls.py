"""Reviewer-scope the workflow SELECT RLS policies (blind-review enforcement).

Closes the blind-review leak. Before this migration the SELECT policies on
``extraction_reviewer_decisions``, ``extraction_reviewer_states`` and
``extraction_proposal_records`` gated only on ``is_project_member`` — so any
project member could read every reviewer's in-flight decisions/values during
REVIEW. Blinding was enforced only in frontend JavaScript; a reviewer hitting
PostgREST directly (or opening devtools) saw their peers' values before
consensus.

The new policies self-scope each reviewer-attributable row: a member may SELECT
it only when (a) they authored it (``reviewer_id`` / ``source_user_id`` =
``auth.uid()``), (b) they are a project ``manager``/``consensus`` arbitrator
(who must see divergence to resolve consensus), or (c) the run is
``finalized``. AI/system proposals stay visible to all members.

A new ``is_project_arbitrator`` SECURITY DEFINER helper (manager OR consensus)
backs the carve-out, mirroring ``is_project_reviewer`` and hardened the same way
(``search_path = public, pg_catalog``; EXECUTE granted to ``authenticated`` —
load-bearing: RLS evaluates as the calling role, so without the GRANT every
reviewer-scoped SELECT would return zero rows for real users).

The backend reaches these tables as ``service_role`` (RLS bypassed), so the
service-layer read filter in ``extraction_run_read_service`` enforces the same
predicate for the API path; this migration closes the PostgREST/devtools path.
The two filters MUST encode the identical rule (own OR manager/consensus OR
finalized) or the read paths diverge.

Revision ID: 0025_reviewer_scoped_select_rls
Revises: 0024_consensus_fk_restrict
Create Date: 2026-06-07
"""

from alembic import op

revision = "0025_reviewer_scoped_select_rls"
down_revision = "0024_consensus_fk_restrict"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 1. Arbitrator helper (manager OR consensus). Hardened search_path to
    #    match the 0008 posture of the sibling is_project_* helpers.
    op.execute(
        """
        CREATE OR REPLACE FUNCTION public.is_project_arbitrator(
            p_project_id uuid, p_user_id uuid
        ) RETURNS boolean
            LANGUAGE plpgsql STABLE SECURITY DEFINER
            SET search_path = public, pg_catalog
            AS $$
                BEGIN
                    RETURN EXISTS (
                        SELECT 1 FROM project_members
                        WHERE project_id = p_project_id
                          AND user_id = p_user_id
                          AND role IN ('manager', 'consensus')
                    );
                END;
            $$;
        """
    )
    op.execute(
        "REVOKE EXECUTE ON FUNCTION public.is_project_arbitrator(uuid, uuid) FROM anon, PUBLIC;"
    )
    op.execute(
        "GRANT EXECUTE ON FUNCTION public.is_project_arbitrator(uuid, uuid) TO authenticated;"
    )

    # 2. Reviewer-scope the three SELECT policies. Join only extraction_runs —
    #    it carries project_id AND stage directly, and its own SELECT policy
    #    refs no workflow table, so the EXISTS introduces no policy cycle.
    op.execute(
        'DROP POLICY IF EXISTS "extraction_reviewer_decisions_select" '
        "ON public.extraction_reviewer_decisions;"
    )
    op.execute(
        """
        CREATE POLICY "extraction_reviewer_decisions_select"
            ON public.extraction_reviewer_decisions
            FOR SELECT USING (
                EXISTS (
                    SELECT 1 FROM public.extraction_runs r
                    WHERE r.id = extraction_reviewer_decisions.run_id
                      AND public.is_project_member(r.project_id, auth.uid())
                      AND (
                            r.stage = 'finalized'::public.extraction_run_stage
                         OR public.is_project_arbitrator(r.project_id, auth.uid())
                         OR extraction_reviewer_decisions.reviewer_id = auth.uid()
                      )
                )
            );
        """
    )

    op.execute(
        'DROP POLICY IF EXISTS "extraction_reviewer_states_select" '
        "ON public.extraction_reviewer_states;"
    )
    op.execute(
        """
        CREATE POLICY "extraction_reviewer_states_select"
            ON public.extraction_reviewer_states
            FOR SELECT USING (
                EXISTS (
                    SELECT 1 FROM public.extraction_runs r
                    WHERE r.id = extraction_reviewer_states.run_id
                      AND public.is_project_member(r.project_id, auth.uid())
                      AND (
                            r.stage = 'finalized'::public.extraction_run_stage
                         OR public.is_project_arbitrator(r.project_id, auth.uid())
                         OR extraction_reviewer_states.reviewer_id = auth.uid()
                      )
                )
            );
        """
    )

    # AI/system proposals stay visible to members; only human rows are
    # reviewer-scoped. `source <> 'human'` is first so AI/system short-circuit
    # without calling is_project_arbitrator.
    op.execute(
        'DROP POLICY IF EXISTS "extraction_proposal_records_select" '
        "ON public.extraction_proposal_records;"
    )
    op.execute(
        """
        CREATE POLICY "extraction_proposal_records_select"
            ON public.extraction_proposal_records
            FOR SELECT USING (
                EXISTS (
                    SELECT 1 FROM public.extraction_runs r
                    WHERE r.id = extraction_proposal_records.run_id
                      AND public.is_project_member(r.project_id, auth.uid())
                      AND (
                            extraction_proposal_records.source
                                <> 'human'::public.extraction_proposal_source
                         OR r.stage = 'finalized'::public.extraction_run_stage
                         OR public.is_project_arbitrator(r.project_id, auth.uid())
                         OR extraction_proposal_records.source_user_id = auth.uid()
                      )
                )
            );
        """
    )


def downgrade() -> None:
    # Restore the baseline is_project_member-only SELECT policies (joined
    # through project_extraction_templates), then drop the helper last so no
    # policy references it at drop time.
    op.execute(
        'DROP POLICY IF EXISTS "extraction_reviewer_decisions_select" '
        "ON public.extraction_reviewer_decisions;"
    )
    op.execute(
        """
        CREATE POLICY "extraction_reviewer_decisions_select"
            ON public.extraction_reviewer_decisions
            FOR SELECT USING ((EXISTS ( SELECT 1
               FROM (public.extraction_runs r
                 JOIN public.project_extraction_templates t ON ((t.id = r.template_id)))
              WHERE ((r.id = extraction_reviewer_decisions.run_id)
                     AND public.is_project_member(t.project_id, auth.uid())))));
        """
    )

    op.execute(
        'DROP POLICY IF EXISTS "extraction_reviewer_states_select" '
        "ON public.extraction_reviewer_states;"
    )
    op.execute(
        """
        CREATE POLICY "extraction_reviewer_states_select"
            ON public.extraction_reviewer_states
            FOR SELECT USING ((EXISTS ( SELECT 1
               FROM (public.extraction_runs r
                 JOIN public.project_extraction_templates t ON ((t.id = r.template_id)))
              WHERE ((r.id = extraction_reviewer_states.run_id)
                     AND public.is_project_member(t.project_id, auth.uid())))));
        """
    )

    op.execute(
        'DROP POLICY IF EXISTS "extraction_proposal_records_select" '
        "ON public.extraction_proposal_records;"
    )
    op.execute(
        """
        CREATE POLICY "extraction_proposal_records_select"
            ON public.extraction_proposal_records
            FOR SELECT USING ((EXISTS ( SELECT 1
               FROM (public.extraction_runs r
                 JOIN public.project_extraction_templates t ON ((t.id = r.template_id)))
              WHERE ((r.id = extraction_proposal_records.run_id)
                     AND public.is_project_member(t.project_id, auth.uid())))));
        """
    )

    op.execute("DROP FUNCTION IF EXISTS public.is_project_arbitrator(uuid, uuid);")
