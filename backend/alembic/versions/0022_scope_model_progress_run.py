"""Scope calculate_model_progress reviewer decisions to the active run (#97).

``calculate_model_progress`` (introduced in 0013) counts a field as "filled"
when either a ``published_state`` carries a value (run-agnostic — the canonical
finalized value, correct) OR a reviewer recorded a non-reject decision for it.
The reviewer-states branch had **no run filter**, so for an article
re-extracted across multiple runs (finalize -> reopen) the non-reject decisions
from *prior* runs leaked into the current run's count and inflated the per-model
progress badge (rendered via ``useModelManagement`` -> the RPC at
``frontend/hooks/extraction/useModelManagement.ts``).

The 0013 docstring already promised "on the active run"; this aligns the
implementation with the spec. The active run is the most recent non-cancelled
run for the ``(article, template)`` pair — instances are template-scoped (no
``run_id`` column), so we derive the template from the model instance. When
there is no active run the reviewer branch contributes nothing and only
published values count.

Only the reviewer-states ``EXISTS`` clause changes (it gains the
``rs.run_id = active_run`` predicate). Signature, return shape,
``SECURITY DEFINER``, ``search_path`` and grants are identical to 0013.

Revision ID: 0022_scope_model_progress_run
Revises: 0021_reconcile_feedback_rls
Create Date: 2026-06-04
"""

from alembic import op

revision = "0022_scope_model_progress_run"
down_revision = "0021_reconcile_feedback_rls"
branch_labels = None
depends_on = None


# Active-run-scoped body (the fix).
_BODY_SCOPED = """
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
    active_run AS (
        SELECT r.id
        FROM public.extraction_runs r
        WHERE r.article_id = p_article_id
          AND r.template_id = (
              SELECT template_id
              FROM public.extraction_instances
              WHERE id = p_model_id
          )
          AND r.stage <> 'cancelled'
        ORDER BY r.created_at DESC
        LIMIT 1
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
              AND rs.run_id = (SELECT id FROM active_run)
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

# 0013 body, verbatim — reviewer-states branch NOT scoped to a run (for downgrade).
_BODY_0013 = """
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

_GRANTS = [
    "REVOKE ALL ON FUNCTION public.calculate_model_progress(uuid, uuid) FROM PUBLIC;",
    "GRANT EXECUTE ON FUNCTION public.calculate_model_progress(uuid, uuid) "
    "TO authenticated, service_role;",
]


def upgrade() -> None:
    op.execute(_BODY_SCOPED)
    for stmt in _GRANTS:
        op.execute(stmt)


def downgrade() -> None:
    op.execute(_BODY_0013)
    for stmt in _GRANTS:
        op.execute(stmt)
