"""Harden calculate_model_progress authorization and run scoping

Revision ID: 0015_harden_model_progress_acl
Revises: 0014_one_active_extraction_tpl
Create Date: 2026-05-18

The previous HITL-aware ``calculate_model_progress(p_article_id, p_model_id)``
replacement was correct about the frontend signature, but it kept two critical
gaps:

* It remained ``SECURITY DEFINER`` without an explicit membership check, so any
  authenticated caller that knew an ``article_id`` and model instance id could
  bypass table RLS and read cross-project progress counts.
* It counted reviewer/published state rows from any historical run tied to the
  model instances. A cancelled or superseded run could therefore make a fresh
  run look complete before the current reviewers wrote anything.

Keep the definer helper so the project progress badge can aggregate across
reviewers, but authorize the root model instance's project with
``is_project_member(project_id, auth.uid())`` first. Then resolve a single
current run for the article/template pair: prefer the newest non-terminal run,
falling back to the newest finalized run so already-published models keep their
progress after reopen.
"""

from alembic import op

revision = "0015_harden_model_progress_acl"
down_revision = "0014_one_active_extraction_tpl"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE OR REPLACE FUNCTION public.calculate_model_progress(
            p_article_id uuid,
            p_model_id uuid
        )
        RETURNS TABLE(
            completed_fields integer,
            total_fields integer,
            percentage numeric
        )
        LANGUAGE plpgsql STABLE
        SECURITY DEFINER
        SET search_path = public, pg_temp
        AS $$
        BEGIN
            RETURN QUERY
            WITH root_instance AS (
                SELECT ei.id, ei.project_id, ei.template_id
                FROM public.extraction_instances ei
                WHERE ei.article_id = p_article_id
                  AND ei.id = p_model_id
                  AND public.is_project_member(ei.project_id, auth.uid())
                LIMIT 1
            ),
            selected_run AS (
                SELECT r.id
                FROM public.extraction_runs r
                JOIN root_instance ri
                  ON ri.project_id = r.project_id
                 AND ri.template_id = r.template_id
                WHERE r.article_id = p_article_id
                  AND r.stage <> 'cancelled'
                ORDER BY
                    CASE
                        WHEN r.stage IN ('pending', 'proposal', 'review', 'consensus')
                            THEN 0
                        ELSE 1
                    END,
                    r.created_at DESC,
                    r.id DESC
                LIMIT 1
            ),
            model_instances AS (
                SELECT ei.id, ei.entity_type_id
                FROM public.extraction_instances ei
                JOIN root_instance ri
                  ON ei.article_id = p_article_id
                 AND ei.template_id = ri.template_id
                 AND (ei.id = ri.id OR ei.parent_instance_id = ri.id)
            ),
            field_universe AS (
                SELECT mi.id AS instance_id, ef.id AS field_id
                FROM model_instances mi
                JOIN public.extraction_fields ef ON ef.entity_type_id = mi.entity_type_id
            ),
            filled AS (
                SELECT DISTINCT fu.instance_id, fu.field_id
                FROM field_universe fu
                JOIN selected_run sr ON TRUE
                WHERE EXISTS (
                    SELECT 1
                    FROM public.extraction_published_states ps
                    WHERE ps.run_id = sr.id
                      AND ps.instance_id = fu.instance_id
                      AND ps.field_id = fu.field_id
                      AND ps.value IS NOT NULL
                )
                OR EXISTS (
                    SELECT 1
                    FROM public.extraction_reviewer_states rs
                    JOIN public.extraction_reviewer_decisions rd
                      ON rd.id = rs.current_decision_id
                     AND rd.run_id = rs.run_id
                    WHERE rs.run_id = sr.id
                      AND rs.instance_id = fu.instance_id
                      AND rd.field_id = fu.field_id
                      AND rd.decision <> 'reject'
                )
            )
            SELECT
                (SELECT COUNT(*)::integer FROM filled)         AS completed_fields,
                (SELECT COUNT(*)::integer FROM field_universe) AS total_fields,
                CASE
                    WHEN (SELECT COUNT(*) FROM field_universe) = 0
                        THEN 0::numeric
                    ELSE ROUND(
                        (SELECT COUNT(*) FROM filled)::numeric * 100.0
                            / (SELECT COUNT(*) FROM field_universe)::numeric,
                        2
                    )
                END AS percentage;
        END;
        $$;
        """
    )
    op.execute(
        "REVOKE ALL ON FUNCTION public.calculate_model_progress(uuid, uuid) FROM PUBLIC;"
    )
    op.execute(
        "GRANT EXECUTE ON FUNCTION public.calculate_model_progress(uuid, uuid) "
        "TO authenticated, service_role;"
    )


def downgrade() -> None:
    op.execute(
        """
        CREATE OR REPLACE FUNCTION public.calculate_model_progress(
            p_article_id uuid,
            p_model_id uuid
        )
        RETURNS TABLE(
            completed_fields integer,
            total_fields integer,
            percentage numeric
        )
        LANGUAGE plpgsql STABLE
        SECURITY DEFINER
        SET search_path = public, pg_temp
        AS $$
        BEGIN
            RETURN QUERY
            WITH model_instances AS (
                SELECT id, entity_type_id
                FROM public.extraction_instances
                WHERE article_id = p_article_id
                  AND (id = p_model_id OR parent_instance_id = p_model_id)
            ),
            field_universe AS (
                SELECT mi.id AS instance_id, ef.id AS field_id
                FROM model_instances mi
                JOIN public.extraction_fields ef ON ef.entity_type_id = mi.entity_type_id
            ),
            filled AS (
                SELECT fu.instance_id, fu.field_id
                FROM field_universe fu
                WHERE EXISTS (
                    SELECT 1
                    FROM public.extraction_published_states ps
                    WHERE ps.instance_id = fu.instance_id
                      AND ps.field_id = fu.field_id
                      AND ps.value IS NOT NULL
                )
                OR EXISTS (
                    SELECT 1
                    FROM public.extraction_reviewer_states rs
                    JOIN public.extraction_reviewer_decisions rd
                        ON rd.id = rs.current_decision_id
                    WHERE rs.instance_id = fu.instance_id
                      AND rd.field_id = fu.field_id
                      AND rd.decision <> 'reject'
                )
            )
            SELECT
                (SELECT COUNT(*)::integer FROM filled)         AS completed_fields,
                (SELECT COUNT(*)::integer FROM field_universe) AS total_fields,
                CASE
                    WHEN (SELECT COUNT(*) FROM field_universe) = 0
                        THEN 0::numeric
                    ELSE ROUND(
                        (SELECT COUNT(*) FROM filled)::numeric * 100.0
                            / (SELECT COUNT(*) FROM field_universe)::numeric,
                        2
                    )
                END AS percentage;
        END;
        $$;
        """
    )
