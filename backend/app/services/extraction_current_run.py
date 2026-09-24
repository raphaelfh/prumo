"""The current run per (article, template): latest live, else latest
finalized, else latest cancelled, ties by (created_at, id); shared by export
and the agent reads.
"""

from __future__ import annotations

from datetime import UTC, datetime
from uuid import UUID

from app.models.extraction import ExtractionRun, ExtractionRunStage

ACTIVE_RUN_STAGES = {
    ExtractionRunStage.PENDING.value,
    ExtractionRunStage.EXTRACT.value,
    ExtractionRunStage.CONSENSUS.value,
}


def select_current_runs_by_article(
    run_rows: list[ExtractionRun],
) -> dict[UUID, ExtractionRun]:
    """Choose the same current run the HITL session path exposes.

    Reopen creates multiple runs for the same article/template. Callers must
    never let PostgreSQL row order decide whether they see the old finalized
    run or the active revision. Prefer the latest non-terminal run, otherwise
    the latest finalized run, otherwise the latest cancelled run for omission
    accounting.
    """

    active_by_article: dict[UUID, ExtractionRun] = {}
    finalized_by_article: dict[UUID, ExtractionRun] = {}
    cancelled_by_article: dict[UUID, ExtractionRun] = {}

    for run in sorted(run_rows, key=run_recency_key, reverse=True):
        if run.stage in ACTIVE_RUN_STAGES:
            active_by_article.setdefault(run.article_id, run)
        elif run.stage == ExtractionRunStage.FINALIZED.value:
            finalized_by_article.setdefault(run.article_id, run)
        elif run.stage == ExtractionRunStage.CANCELLED.value:
            cancelled_by_article.setdefault(run.article_id, run)

    selected: dict[UUID, ExtractionRun] = {}
    for article_id in {
        *active_by_article.keys(),
        *finalized_by_article.keys(),
        *cancelled_by_article.keys(),
    }:
        selected[article_id] = (
            active_by_article.get(article_id)
            or finalized_by_article.get(article_id)
            or cancelled_by_article[article_id]
        )
    return selected


def run_recency_key(run: ExtractionRun) -> tuple[datetime, str]:
    created_at = run.created_at or datetime.min.replace(tzinfo=UTC)
    return created_at, str(run.id)
