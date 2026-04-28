"""is_project_reviewer SQL fn + relax workflow RLS to allow reviewers

Revision ID: 20260428_0018
Revises: 20260428_0017
Create Date: 2026-04-28
"""

from alembic import op

# revision identifiers, used by Alembic.
revision = "20260428_0018"
down_revision = "20260428_0017"
branch_labels = None
depends_on = None


_WORKFLOW_TABLES = (
    "extraction_proposal_records",
    "extraction_reviewer_decisions",
    "extraction_reviewer_states",
    "extraction_consensus_decisions",
    "extraction_published_states",
)


def upgrade() -> None:
    """Allow reviewers (not just managers) to write workflow rows.

    Migration 0012 wired INSERT/UPDATE policies through is_project_manager,
    which means a reviewer hitting /v1/runs/{id}/decisions in production
    would be blocked by RLS even though the app layer authorized the call.

    This migration introduces a SECURITY DEFINER `is_project_reviewer`
    helper (mirroring the existing is_project_manager / is_project_member
    pattern) and replaces each workflow-table INSERT/UPDATE policy with
    one that admits managers OR reviewers. SELECT/DELETE keep the broader
    is_project_member check.
    """
    op.execute(
        """
        CREATE OR REPLACE FUNCTION public.is_project_reviewer(
            p_project_id uuid, p_user_id uuid
        )
        RETURNS boolean
        LANGUAGE plpgsql
        STABLE
        SECURITY DEFINER
        SET search_path TO 'public', 'pg_temp'
        AS $$
        BEGIN
            RETURN EXISTS (
                SELECT 1 FROM project_members
                WHERE project_id = p_project_id
                  AND user_id = p_user_id
                  AND role IN ('manager', 'reviewer', 'consensus')
            );
        END;
        $$;
        """
    )

    for table_name in _WORKFLOW_TABLES:
        op.execute(f"DROP POLICY IF EXISTS {table_name}_insert ON public.{table_name};")
        op.execute(f"DROP POLICY IF EXISTS {table_name}_update ON public.{table_name};")
        op.execute(
            f"""
            CREATE POLICY {table_name}_insert
              ON public.{table_name} FOR INSERT
              WITH CHECK (
                  EXISTS (
                      SELECT 1
                      FROM public.extraction_runs r
                      JOIN public.project_extraction_templates t ON t.id = r.template_id
                      WHERE r.id = {table_name}.run_id
                        AND public.is_project_reviewer(t.project_id, auth.uid())
                  )
              );
            """
        )
        op.execute(
            f"""
            CREATE POLICY {table_name}_update
              ON public.{table_name} FOR UPDATE
              USING (
                  EXISTS (
                      SELECT 1
                      FROM public.extraction_runs r
                      JOIN public.project_extraction_templates t ON t.id = r.template_id
                      WHERE r.id = {table_name}.run_id
                        AND public.is_project_reviewer(t.project_id, auth.uid())
                  )
              )
              WITH CHECK (
                  EXISTS (
                      SELECT 1
                      FROM public.extraction_runs r
                      JOIN public.project_extraction_templates t ON t.id = r.template_id
                      WHERE r.id = {table_name}.run_id
                        AND public.is_project_reviewer(t.project_id, auth.uid())
                  )
              );
            """
        )


def downgrade() -> None:
    for table_name in _WORKFLOW_TABLES:
        op.execute(f"DROP POLICY IF EXISTS {table_name}_insert ON public.{table_name};")
        op.execute(f"DROP POLICY IF EXISTS {table_name}_update ON public.{table_name};")
        op.execute(
            f"""
            CREATE POLICY {table_name}_insert
              ON public.{table_name} FOR INSERT
              WITH CHECK (
                  EXISTS (
                      SELECT 1
                      FROM public.extraction_runs r
                      JOIN public.project_extraction_templates t ON t.id = r.template_id
                      WHERE r.id = {table_name}.run_id
                        AND public.is_project_manager(t.project_id, auth.uid())
                  )
              );
            """
        )
        op.execute(
            f"""
            CREATE POLICY {table_name}_update
              ON public.{table_name} FOR UPDATE
              USING (
                  EXISTS (
                      SELECT 1
                      FROM public.extraction_runs r
                      JOIN public.project_extraction_templates t ON t.id = r.template_id
                      WHERE r.id = {table_name}.run_id
                        AND public.is_project_manager(t.project_id, auth.uid())
                  )
              )
              WITH CHECK (
                  EXISTS (
                      SELECT 1
                      FROM public.extraction_runs r
                      JOIN public.project_extraction_templates t ON t.id = r.template_id
                      WHERE r.id = {table_name}.run_id
                        AND public.is_project_manager(t.project_id, auth.uid())
                  )
              );
            """
        )

    op.execute("DROP FUNCTION IF EXISTS public.is_project_reviewer(uuid, uuid);")
