"""Collapse extraction_run_stage proposal+review into extract

Revision ID: 0028_run_stage_extract
Revises: 0027_api_key_llama_cloud
Create Date: 2026-06-21

HITL lifecycle alignment Phase 1 (spec 2026-06-21): the run lifecycle becomes
pending -> extract -> consensus -> finalized. `proposal` and `review` collapse
into a single `extract` value (existing rows in either map to `extract`).

Three RLS SELECT policies on child tables reference
`r.stage = 'finalized'::extraction_run_stage`. Postgres rejects ALTER COLUMN
TYPE when any policy depends on the column type, so we drop all three before
the type change and recreate them afterwards (the cast is still valid because
'finalized' exists in both old and new enum).
"""

from alembic import op

revision = "0028_run_stage_extract"
down_revision = "0027_api_key_llama_cloud"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 1. Drop the three RLS SELECT policies that reference stage::extraction_run_stage.
    op.execute(
        "DROP POLICY extraction_reviewer_decisions_select ON public.extraction_reviewer_decisions;"
    )
    op.execute(
        "DROP POLICY extraction_reviewer_states_select ON public.extraction_reviewer_states;"
    )
    op.execute(
        "DROP POLICY extraction_proposal_records_select ON public.extraction_proposal_records;"
    )

    # 2. Rename old enum, create new one, convert column, drop old enum.
    op.execute("ALTER TYPE public.extraction_run_stage RENAME TO extraction_run_stage_old;")
    op.execute(
        """
        CREATE TYPE public.extraction_run_stage AS ENUM (
            'pending', 'extract', 'consensus', 'finalized', 'cancelled'
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
                    WHEN 'proposal' THEN 'extract'
                    WHEN 'review'   THEN 'extract'
                    WHEN 'consensus' THEN 'consensus'
                    WHEN 'finalized' THEN 'finalized'
                    WHEN 'cancelled' THEN 'cancelled'
                    ELSE 'pending'
                END::public.extraction_run_stage
            );
        """
    )
    op.execute("ALTER TABLE public.extraction_runs ALTER COLUMN stage SET DEFAULT 'pending';")
    op.execute("DROP TYPE public.extraction_run_stage_old;")

    # 3. Recreate the three RLS SELECT policies against the new enum type.
    op.execute(
        """
        CREATE POLICY extraction_reviewer_decisions_select
            ON public.extraction_reviewer_decisions
            AS PERMISSIVE
            FOR SELECT
            TO PUBLIC
            USING (
                EXISTS (
                    SELECT 1
                    FROM extraction_runs r
                    WHERE r.id = extraction_reviewer_decisions.run_id
                      AND is_project_member(r.project_id, auth.uid())
                      AND (
                              r.stage = 'finalized'::extraction_run_stage
                           OR is_project_arbitrator(r.project_id, auth.uid())
                           OR extraction_reviewer_decisions.reviewer_id = auth.uid()
                      )
                )
            );
        """
    )
    op.execute(
        """
        CREATE POLICY extraction_reviewer_states_select
            ON public.extraction_reviewer_states
            AS PERMISSIVE
            FOR SELECT
            TO PUBLIC
            USING (
                EXISTS (
                    SELECT 1
                    FROM extraction_runs r
                    WHERE r.id = extraction_reviewer_states.run_id
                      AND is_project_member(r.project_id, auth.uid())
                      AND (
                              r.stage = 'finalized'::extraction_run_stage
                           OR is_project_arbitrator(r.project_id, auth.uid())
                           OR extraction_reviewer_states.reviewer_id = auth.uid()
                      )
                )
            );
        """
    )
    op.execute(
        """
        CREATE POLICY extraction_proposal_records_select
            ON public.extraction_proposal_records
            AS PERMISSIVE
            FOR SELECT
            TO PUBLIC
            USING (
                EXISTS (
                    SELECT 1
                    FROM extraction_runs r
                    WHERE r.id = extraction_proposal_records.run_id
                      AND is_project_member(r.project_id, auth.uid())
                      AND (
                              extraction_proposal_records.source <> 'human'::extraction_proposal_source
                           OR r.stage = 'finalized'::extraction_run_stage
                           OR is_project_arbitrator(r.project_id, auth.uid())
                           OR extraction_proposal_records.source_user_id = auth.uid()
                      )
                )
            );
        """
    )


def downgrade() -> None:
    # 1. Drop the three RLS SELECT policies.
    op.execute(
        "DROP POLICY extraction_reviewer_decisions_select ON public.extraction_reviewer_decisions;"
    )
    op.execute(
        "DROP POLICY extraction_reviewer_states_select ON public.extraction_reviewer_states;"
    )
    op.execute(
        "DROP POLICY extraction_proposal_records_select ON public.extraction_proposal_records;"
    )

    # 2. Reverse the enum: rename new, create old values, convert column.
    op.execute("ALTER TYPE public.extraction_run_stage RENAME TO extraction_run_stage_new;")
    op.execute(
        """
        CREATE TYPE public.extraction_run_stage AS ENUM (
            'pending', 'proposal', 'review', 'consensus', 'finalized', 'cancelled'
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
                    WHEN 'extract' THEN 'review'
                    ELSE stage::text
                END::public.extraction_run_stage
            );
        """
    )
    op.execute("ALTER TABLE public.extraction_runs ALTER COLUMN stage SET DEFAULT 'pending';")
    op.execute("DROP TYPE public.extraction_run_stage_new;")

    # 3. Recreate the three RLS SELECT policies with old enum type.
    op.execute(
        """
        CREATE POLICY extraction_reviewer_decisions_select
            ON public.extraction_reviewer_decisions
            AS PERMISSIVE
            FOR SELECT
            TO PUBLIC
            USING (
                EXISTS (
                    SELECT 1
                    FROM extraction_runs r
                    WHERE r.id = extraction_reviewer_decisions.run_id
                      AND is_project_member(r.project_id, auth.uid())
                      AND (
                              r.stage = 'finalized'::extraction_run_stage
                           OR is_project_arbitrator(r.project_id, auth.uid())
                           OR extraction_reviewer_decisions.reviewer_id = auth.uid()
                      )
                )
            );
        """
    )
    op.execute(
        """
        CREATE POLICY extraction_reviewer_states_select
            ON public.extraction_reviewer_states
            AS PERMISSIVE
            FOR SELECT
            TO PUBLIC
            USING (
                EXISTS (
                    SELECT 1
                    FROM extraction_runs r
                    WHERE r.id = extraction_reviewer_states.run_id
                      AND is_project_member(r.project_id, auth.uid())
                      AND (
                              r.stage = 'finalized'::extraction_run_stage
                           OR is_project_arbitrator(r.project_id, auth.uid())
                           OR extraction_reviewer_states.reviewer_id = auth.uid()
                      )
                )
            );
        """
    )
    op.execute(
        """
        CREATE POLICY extraction_proposal_records_select
            ON public.extraction_proposal_records
            AS PERMISSIVE
            FOR SELECT
            TO PUBLIC
            USING (
                EXISTS (
                    SELECT 1
                    FROM extraction_runs r
                    WHERE r.id = extraction_proposal_records.run_id
                      AND is_project_member(r.project_id, auth.uid())
                      AND (
                              extraction_proposal_records.source <> 'human'::extraction_proposal_source
                           OR r.stage = 'finalized'::extraction_run_stage
                           OR is_project_arbitrator(r.project_id, auth.uid())
                           OR extraction_proposal_records.source_user_id = auth.uid()
                      )
                )
            );
        """
    )
