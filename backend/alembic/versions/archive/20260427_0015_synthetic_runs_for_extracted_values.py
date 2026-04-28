"""synthetic finalized Runs wrap legacy extracted_values

Revision ID: 20260427_0015
Revises: 20260427_0014
Create Date: 2026-04-27
"""

from alembic import op

revision: str = "20260427_0015"
down_revision: str | None = "20260427_0014"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 1) Create synthetic Runs for each (article_id, template_id) pair that has
    # extracted_values but no Run yet. Mark them with parameters._synthetic=true.
    op.execute(
        """
        INSERT INTO public.extraction_runs (
            id, project_id, article_id, template_id, kind, version_id,
            stage, status, parameters, results, hitl_config_snapshot, created_by
        )
        SELECT
            gen_random_uuid(),
            ev.project_id,
            ev.article_id,
            ev.template_id,
            (
                SELECT t.kind FROM public.project_extraction_templates t
                WHERE t.id = ev.template_id
            ),
            (
                SELECT v.id FROM public.extraction_template_versions v
                WHERE v.project_template_id = ev.template_id AND v.is_active
                LIMIT 1
            ),
            'finalized'::extraction_run_stage,
            'completed'::extraction_run_status,
            jsonb_build_object('_synthetic', true, '_origin', '0015_migration'),
            '{}'::jsonb,
            '{}'::jsonb,
            COALESCE(
                (
                    SELECT ev2.reviewer_id FROM public.extracted_values ev2
                    WHERE ev2.article_id = ev.article_id
                      AND ev2.project_id = ev.project_id
                      AND ev2.reviewer_id IS NOT NULL
                    LIMIT 1
                ),
                (
                    SELECT t.created_by FROM public.project_extraction_templates t
                    WHERE t.id = ev.template_id
                )
            )
        FROM (
            SELECT DISTINCT
                ev.project_id,
                ev.article_id,
                i.template_id
            FROM public.extracted_values ev
            JOIN public.extraction_instances i ON i.id = ev.instance_id
            WHERE NOT EXISTS (
                SELECT 1 FROM public.extraction_runs r
                WHERE r.article_id = ev.article_id
                  AND r.template_id = i.template_id
                  AND (r.parameters->>'_synthetic') = 'true'
            )
        ) ev;
        """
    )

    # 2) For every extracted_values row, create extraction_published_states linked
    # to the synthetic Run for its (article, template) pair.
    op.execute(
        """
        INSERT INTO public.extraction_published_states (
            id, run_id, instance_id, field_id, value, published_by, version
        )
        SELECT
            gen_random_uuid(),
            r.id,
            ev.instance_id,
            ev.field_id,
            ev.value,
            COALESCE(ev.reviewer_id, r.created_by),
            1
        FROM public.extracted_values ev
        JOIN public.extraction_instances i ON i.id = ev.instance_id
        JOIN public.extraction_runs r
          ON r.article_id = ev.article_id
         AND r.template_id = i.template_id
         AND (r.parameters->>'_synthetic') = 'true'
        WHERE NOT EXISTS (
            SELECT 1 FROM public.extraction_published_states ps
            WHERE ps.run_id = r.id
              AND ps.instance_id = ev.instance_id
              AND ps.field_id = ev.field_id
        );
        """
    )


def downgrade() -> None:
    # Delete only the rows we created. Safer than dropping tables.
    op.execute(
        """
        DELETE FROM public.extraction_published_states
        WHERE run_id IN (
            SELECT id FROM public.extraction_runs
            WHERE (parameters->>'_synthetic') = 'true'
              AND (parameters->>'_origin') = '0015_migration'
        );
        """
    )
    op.execute(
        """
        DELETE FROM public.extraction_runs
        WHERE (parameters->>'_synthetic') = 'true'
          AND (parameters->>'_origin') = '0015_migration';
        """
    )
