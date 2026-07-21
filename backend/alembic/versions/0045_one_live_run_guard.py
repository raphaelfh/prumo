"""One live extraction run per coordinate — DB enforced

Revision ID: 0045_one_live_run_guard
Revises: 0044_instance_delete_cascade
Create Date: 2026-07-06

The HITL workflow assumes exactly one *live* (non-terminal: pending /
extract / consensus) run per (project, article, template, kind) — "the
atomic HITL session for one (article × project_template × kind)"
(docs/reference/extraction-hitl-architecture.md). That contract was only
service-layer folklore: AI/model extraction paths forked parallel runs
(the batch path even created one run PER SECTION), and the session
opener resolved the newest by ``created_at`` — silently shadowing the
run that held a reviewer's saved decisions. That is the run-orphaning
data-loss bug ("annotated everything, refreshed, nothing saved").

The service layer now reuses the live run (``_resolve_run`` ranks by
human-work recency; ``resolve_or_create_extract_run`` gates every
standalone creator under the (article, template) advisory lock). This
migration closes the gap at the DB, mirroring 0014/0043:

1. **Heal**: for every coordinate holding multiple live runs, keep the
   CANONICAL one — the run with the most recent HUMAN work (reviewer
   decision, consensus decision, or human proposal), tie-break newest
   ``created_at`` — exactly the ordering the session opener resolves
   with, so the survivor is the run users see today. The shadow runs
   flip to ``stage='cancelled'`` / ``status='failed'`` (mirroring
   ``advance_stage``'s cancel pairing). NON-destructive: no rows are
   deleted, so the CASCADE FKs on proposals / decisions / states never
   fire and every audit row survives (constitution §IX).
2. **Partial unique index** ``uq_one_live_extraction_run_per_coord``
   over ``(project_id, article_id, template_id, kind) WHERE stage IN
   ('pending','extract','consensus')`` — a second live run becomes
   unrepresentable. ``kind`` is implied by ``template_id`` (composite
   FK coherence) and included for intent + planner support.

Downgrade drops the index only. The heal is not reverted: resurrecting
the cancelled shadow runs is meaningless — the workflow has moved on
with the canonical survivor, and un-cancelling would recreate the very
ambiguity this migration removes (same rationale as 0014/0043).
"""

from alembic import op

revision = "0045_one_live_run_guard"
down_revision = "0044_instance_delete_cascade"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Step 1 — heal duplicate live runs: cancel every non-canonical one.
    # The ranking is the SQL twin of RunLifecycleService.last_human_activity_order
    # (greatest of the newest reviewer decision / consensus decision / human
    # proposal, NULLS LAST), so the survivor is exactly the run the session
    # opener already resolves. Idempotent: a second execution finds no rn > 1.
    op.execute(
        """
        WITH ranked AS (
            SELECT er.id,
                   ROW_NUMBER() OVER (
                       PARTITION BY er.project_id, er.article_id,
                                    er.template_id, er.kind
                       ORDER BY
                           greatest(
                               (SELECT max(erd.created_at)
                                  FROM public.extraction_reviewer_decisions erd
                                 WHERE erd.run_id = er.id),
                               (SELECT max(ecd.created_at)
                                  FROM public.extraction_consensus_decisions ecd
                                 WHERE ecd.run_id = er.id),
                               (SELECT max(epr.created_at)
                                  FROM public.extraction_proposal_records epr
                                 WHERE epr.run_id = er.id
                                   AND epr.source = 'human')
                           ) DESC NULLS LAST,
                           er.created_at DESC,
                           er.id
                   ) AS rn
            FROM public.extraction_runs er
            WHERE er.stage IN ('pending', 'extract', 'consensus')
        )
        UPDATE public.extraction_runs AS er
        SET stage = 'cancelled',
            status = 'failed',
            error_message = COALESCE(
                er.error_message,
                'Cancelled by migration 0045: duplicate live run for this '
                'article/template; the run holding the human work survives.'
            )
        FROM ranked
        WHERE er.id = ranked.id
          AND ranked.rn > 1;
        """
    )

    # Step 2 — enforce the invariant from now on.
    op.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS
            uq_one_live_extraction_run_per_coord
        ON public.extraction_runs (project_id, article_id, template_id, kind)
        WHERE stage IN ('pending', 'extract', 'consensus');
        """
    )


def downgrade() -> None:
    # Heal deliberately not reverted — see module docstring.
    op.execute("DROP INDEX IF EXISTS public.uq_one_live_extraction_run_per_coord;")
