"""drop legacy assessment stack and keep unified evaluation only

Revision ID: 20260426_0009
Revises: 20260426_0008
Create Date: 2026-04-26
"""

from alembic import op

revision: str = "20260426_0009"
down_revision: str | None = "20260426_0008"
branch_labels = None
depends_on = None


def _run(statements: tuple[str, ...]) -> None:
    for statement in statements:
        op.execute(statement)


_UPGRADE_SQL = (
    # Legacy view and trigger functions
    "DROP VIEW IF EXISTS public.assessments CASCADE;",
    "DROP FUNCTION IF EXISTS public.assessments_insert_trigger() CASCADE;",
    "DROP FUNCTION IF EXISTS public.assessments_update_trigger() CASCADE;",
    "DROP FUNCTION IF EXISTS public.assessments_delete_trigger() CASCADE;",
    # Legacy helper functions tied to assessment domain
    "DROP FUNCTION IF EXISTS public.clone_global_instrument_to_project(uuid,uuid,uuid,text) CASCADE;",
    "DROP FUNCTION IF EXISTS public.get_assessment_instance_children(uuid) CASCADE;",
    "DROP FUNCTION IF EXISTS public.calculate_assessment_instance_progress(uuid) CASCADE;",
    "DROP FUNCTION IF EXISTS public.validate_assessment_instance_hierarchy() CASCADE;",
    # Drop assessment-specific checks from shared table before removing columns
    "ALTER TABLE public.ai_suggestions DROP CONSTRAINT IF EXISTS ck_ai_suggestions_run_xor;",
    "ALTER TABLE public.ai_suggestions DROP CONSTRAINT IF EXISTS ck_ai_suggestions_extraction_refs;",
    "ALTER TABLE public.ai_suggestions DROP CONSTRAINT IF EXISTS ck_ai_suggestions_assessment_refs;",
    "ALTER TABLE public.ai_suggestions DROP CONSTRAINT IF EXISTS ck_ai_suggestions_assessment_item_xor;",
    # Remove existing ai_suggestions policies and recreate extraction-only policies
    'DROP POLICY IF EXISTS "ai_suggestions_read_by_project_members" ON public.ai_suggestions;',
    'DROP POLICY IF EXISTS "ai_suggestions_insert_by_project_members" ON public.ai_suggestions;',
    'DROP POLICY IF EXISTS "ai_suggestions_update_by_project_members" ON public.ai_suggestions;',
    'DROP POLICY IF EXISTS "ai_suggestions_delete_by_project_members" ON public.ai_suggestions;',
    # Remove assessment references from ai_suggestions
    "ALTER TABLE public.ai_suggestions DROP COLUMN IF EXISTS assessment_run_id;",
    "ALTER TABLE public.ai_suggestions DROP COLUMN IF EXISTS assessment_item_id;",
    "ALTER TABLE public.ai_suggestions DROP COLUMN IF EXISTS project_assessment_item_id;",
    "DROP INDEX IF EXISTS public.ix_ai_suggestions_assessment_run_id;",
    "DROP INDEX IF EXISTS public.idx_ai_suggestions_assessment_run_id;",
    "DROP INDEX IF EXISTS public.ix_ai_suggestions_assessment_item_id;",
    "DROP INDEX IF EXISTS public.idx_ai_suggestions_assessment_item_id;",
    "DROP INDEX IF EXISTS public.ix_ai_suggestions_project_assessment_item_id;",
    "DROP INDEX IF EXISTS public.idx_ai_suggestions_project_assessment_item_id;",
    # Keep ai_suggestions extraction-only invariant
    """
    ALTER TABLE public.ai_suggestions
    ADD CONSTRAINT ck_ai_suggestions_extraction_only
    CHECK (
        extraction_run_id IS NOT NULL
        AND instance_id IS NOT NULL
        AND field_id IS NOT NULL
    );
    """,
    """
    CREATE POLICY "ai_suggestions_read_by_project_members"
      ON public.ai_suggestions FOR SELECT
      USING (
        EXISTS (
          SELECT 1
          FROM public.extraction_runs er
          JOIN public.project_members pm ON pm.project_id = er.project_id
          WHERE er.id = ai_suggestions.extraction_run_id
            AND pm.user_id = auth.uid()
        )
      );
    """,
    """
    CREATE POLICY "ai_suggestions_insert_by_project_members"
      ON public.ai_suggestions FOR INSERT
      WITH CHECK (auth.role() = 'service_role');
    """,
    """
    CREATE POLICY "ai_suggestions_update_by_project_members"
      ON public.ai_suggestions FOR UPDATE
      USING (
        EXISTS (
          SELECT 1
          FROM public.extraction_runs er
          JOIN public.project_members pm ON pm.project_id = er.project_id
          WHERE er.id = ai_suggestions.extraction_run_id
            AND pm.user_id = auth.uid()
        )
      );
    """,
    """
    CREATE POLICY "ai_suggestions_delete_by_project_members"
      ON public.ai_suggestions FOR DELETE
      USING (auth.role() = 'service_role');
    """,
    # Project-level legacy assessment columns
    "ALTER TABLE public.projects DROP COLUMN IF EXISTS assessment_scope;",
    "ALTER TABLE public.projects DROP COLUMN IF EXISTS assessment_entity_type_id;",
    "ALTER TABLE public.projects DROP COLUMN IF EXISTS risk_of_bias_instrument_id;",
    # Legacy assessment tables
    "DROP TABLE IF EXISTS public.assessment_evidence CASCADE;",
    "DROP TABLE IF EXISTS public.assessment_responses CASCADE;",
    "DROP TABLE IF EXISTS public.assessment_instances CASCADE;",
    "DROP TABLE IF EXISTS public.ai_assessment_runs CASCADE;",
    "DROP TABLE IF EXISTS public.ai_assessments CASCADE;",
    "DROP TABLE IF EXISTS public.ai_assessment_prompts CASCADE;",
    "DROP TABLE IF EXISTS public.ai_assessment_configs CASCADE;",
    "DROP TABLE IF EXISTS public.project_assessment_items CASCADE;",
    "DROP TABLE IF EXISTS public.project_assessment_instruments CASCADE;",
    "DROP TABLE IF EXISTS public.assessment_items CASCADE;",
    "DROP TABLE IF EXISTS public.assessment_instruments CASCADE;",
    # Legacy enums
    "DROP TYPE IF EXISTS assessment_source;",
    "DROP TYPE IF EXISTS assessment_status;",
)


def upgrade() -> None:
    """Drop legacy assessment stack objects."""
    _run(_UPGRADE_SQL)


def downgrade() -> None:
    """This migration is destructive and intentionally not reversible."""
    raise RuntimeError("Downgrade is not supported for 20260426_0009_drop_legacy_assessment_stack")

