"""DB-level article coherence on HITL workflow rows (defense-in-depth for #79)

Revision ID: 0023_workflow_article_coherence
Revises: 0022_scope_model_progress_run
Create Date: 2026-06-04

Follow-up to GitHub issue #79 (fixed at the service layer in PR #189).

``assert_coords_coherent`` (``app/services/coordinate_coherence.py``) rejects
a ``(run_id, instance_id, field_id)`` triplet whose instance belongs to a
different article than its run. That guard lives only in the application
layer, so a direct SQL write, a backfill migration, or a future writer that
forgets to call it could still create a workflow row whose instance's
``article_id`` diverges from its run's ``article_id``.

This migration moves the invariant into the database. For each of the five
HITL workflow tables (``extraction_proposal_records``,
``extraction_reviewer_decisions``, ``extraction_reviewer_states``,
``extraction_consensus_decisions``, ``extraction_published_states``) a
``CONSTRAINT TRIGGER`` calls a shared plpgsql function that asserts
``instance.article_id IS NOT DISTINCT FROM run.article_id``.

Why a trigger and not the composite-FK style of 0005 / 0012: those bound two
columns that already lived on the row (``run_id`` + a decision id). Here the
shared key (``article_id``) lives on the *parents* (runs, instances), not on
the workflow row, so a composite FK would require denormalizing an
``article_id`` column onto all five tables and forcing every writer to keep
it populated. A constraint trigger keeps the invariant in one place and
enforces it regardless of how the row is written. It mirrors the
deferred-trigger house style of migration 0016
(``check_model_section_parent_role``).

The NULLABLE-``article_id`` wrinkle is handled for free:
``extraction_runs.article_id`` is NOT NULL, so a template instance
(``article_id IS NULL``) is ``DISTINCT FROM`` the run's article and is
rejected — workflow rows can only ever reference concrete, article-bound
instances.

``DEFERRABLE INITIALLY DEFERRED`` so a transaction that legitimately
re-points a run and its instances to a new article in one unit of work is
judged on its end state, not mid-transaction.

The function pins ``search_path`` to satisfy the Supabase linter
``function_search_path_mutable`` (see migration 0008).
"""

from alembic import op

revision = "0023_workflow_article_coherence"
down_revision = "0022_scope_model_progress_run"
branch_labels = None
depends_on = None


# The five HITL workflow tables. All share the (run_id, instance_id,
# field_id) coordinate system; each carries only plain FKs to
# extraction_runs.id and extraction_instances.id that say nothing about
# article agreement between the two.
_WORKFLOW_TABLES = (
    "extraction_proposal_records",
    "extraction_reviewer_decisions",
    "extraction_reviewer_states",
    "extraction_consensus_decisions",
    "extraction_published_states",
)


def upgrade() -> None:
    # Shared trigger function: reject a workflow row whose instance's article
    # differs from its run's article. ``extraction_runs.article_id`` is NOT
    # NULL, so a NULL (template) instance article is DISTINCT and therefore
    # rejected — concrete article-bound instances only.
    op.execute(
        """
        CREATE OR REPLACE FUNCTION public.assert_workflow_article_coherent()
        RETURNS trigger
        LANGUAGE plpgsql
        SET search_path = public, pg_catalog
        AS $$
        DECLARE
            run_article uuid;
            instance_article uuid;
        BEGIN
            SELECT article_id INTO run_article
              FROM public.extraction_runs
             WHERE id = NEW.run_id;

            SELECT article_id INTO instance_article
              FROM public.extraction_instances
             WHERE id = NEW.instance_id;

            IF instance_article IS DISTINCT FROM run_article THEN
                RAISE EXCEPTION
                    'workflow row (run=%, instance=%) violates article '
                    'coherence: run.article_id=% but instance.article_id=%',
                    NEW.run_id, NEW.instance_id, run_article, instance_article
                    USING ERRCODE = 'check_violation';
            END IF;

            RETURN NEW;
        END;
        $$
        """
    )

    # Attach the constraint trigger to every workflow table. Fires only when
    # run_id or instance_id is written (INSERT, or the rare UPDATE that
    # re-points them) — routine UPDATEs of value/version/current_decision_id
    # carry no overhead. DEFERRED so the check runs at COMMIT.
    for table in _WORKFLOW_TABLES:
        op.execute(
            f"""
            CREATE CONSTRAINT TRIGGER trg_{table}_article_coherent
            AFTER INSERT OR UPDATE OF run_id, instance_id
            ON public.{table}
            DEFERRABLE INITIALLY DEFERRED
            FOR EACH ROW
            EXECUTE FUNCTION public.assert_workflow_article_coherent()
            """
        )


def downgrade() -> None:
    for table in _WORKFLOW_TABLES:
        op.execute(f"DROP TRIGGER IF EXISTS trg_{table}_article_coherent ON public.{table}")
    op.execute("DROP FUNCTION IF EXISTS public.assert_workflow_article_coherent()")
