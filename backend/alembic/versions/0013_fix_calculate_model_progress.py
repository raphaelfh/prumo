"""Repair calculate_model_progress: align signature with the HITL schema

Revision ID: 0013_fix_calculate_model_progress
Revises: 0012_consensus_decision_run_fk
Create Date: 2026-05-17

The legacy ``calculate_model_progress(p_project_id, p_article_id)`` was
stale on two axes:

* It still SELECTed from the now-removed ``extracted_values`` table
  (dropped in migration ``0002_drop_extracted_values``), so every call
  now errors at the SQL layer.
* The frontend calls it as ``(p_article_id, p_model_id)`` — the
  per-prediction-model progress shown next to each model in the
  CHARMS selector. The old signature accepted ``(project_id, article_id)``
  and returned one row per instance, neither of which matched the
  caller. PostgREST surfaces this as PGRST202 (function not found in
  schema cache) which the UI swallows into a "0%" badge.

Replace the function with the HITL-aware shape the UI actually consumes:

* Parameters ``(p_article_id, p_model_id)`` — the prediction_model
  parent instance id plus the article scope.
* Returns a single row ``(completed_fields, total_fields, percentage)``
  consumed verbatim by ``useModelManagement.getModelProgress``.
* Counts every field on the model parent **and** its child sub-section
  instances; a field is "filled" when *any* reviewer recorded a
  non-reject decision for it on the active run, or a published_state
  carries a value (post-finalize models keep their progress).

``SECURITY DEFINER`` + a pinned ``search_path`` matches the rest of
the read-helpers (see 0008_function_hardening) so RLS does not strip
visibility from the called role. Idempotent: dropped by all known
parameter shapes before re-create.
"""

from alembic import op

revision = "0013_calc_model_progress_fix"
down_revision = "0012_consensus_decision_run_fk"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Drop both the legacy (project_id, article_id) form and any
    # interim (article_id, model_id) form so the re-create is clean
    # regardless of which environment we run against.
    op.execute(
        """
        DROP FUNCTION IF EXISTS public.calculate_model_progress(uuid, uuid);
        """
    )
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
    op.execute(
        "REVOKE ALL ON FUNCTION public.calculate_model_progress(uuid, uuid) FROM PUBLIC;"
    )
    op.execute(
        "GRANT EXECUTE ON FUNCTION public.calculate_model_progress(uuid, uuid) "
        "TO authenticated, service_role;"
    )


def downgrade() -> None:
    # Revert to the legacy stub. Note: the original referenced the
    # extracted_values table dropped in 0002; this downgrade restores the
    # signature only so PostgREST doesn't blow up, but the body is a
    # no-op that returns the same empty shape. Pre-0002 environments
    # don't exist anymore, so re-creating the broken body would only
    # mask the problem.
    op.execute(
        """
        DROP FUNCTION IF EXISTS public.calculate_model_progress(uuid, uuid);
        """
    )
    op.execute(
        """
        CREATE OR REPLACE FUNCTION public.calculate_model_progress(
            p_project_id uuid,
            p_article_id uuid
        )
        RETURNS TABLE(
            extraction_instance_id uuid,
            entity_type_name varchar,
            total_fields integer,
            filled_fields integer,
            completion_percentage numeric
        )
        LANGUAGE plpgsql STABLE
        AS $$
        BEGIN
            RETURN QUERY SELECT NULL::uuid, NULL::varchar, 0, 0, 0::numeric WHERE FALSE;
        END;
        $$;
        """
    )
