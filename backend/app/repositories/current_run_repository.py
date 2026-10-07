"""The current-run ranking for a (project, article, template) coordinate, stated once.

A live run (pending / extract / consensus) ranks before a finalized one, which
ranks before a cancelled one; within a tier the newest ``created_at`` wins and
``id`` descending breaks ties, because runs written in one transaction share
``now()``. The one-live-run index (``uq_one_live_extraction_run_per_coord``,
0045) leaves at most one run in the live tier, so it needs no finer ranking.

The top-ranked run is the coordinate's **current** run (a cancelled one
included); the **resolved** run is the current run unless it is cancelled
(``ExtractionRunStage.resolvable()``). ``app.services.current_run`` is the
service seam over both; ``resolved_run_ids`` is here so a repository statement
(the article-progress read) can join it set-based.
"""

from __future__ import annotations

from typing import Any
from uuid import UUID

from sqlalchemy import CTE, Select, case, select

from app.models.extraction import ExtractionRun, ExtractionRunStage


def current_runs(partition: Any, *where: Any) -> Select[tuple[ExtractionRun]]:
    """The top-ranked run per ``partition`` value among the runs ``where`` matches."""
    run = ExtractionRun
    tier = case(
        (run.stage.in_(ExtractionRunStage.live()), 0),
        (run.stage == ExtractionRunStage.FINALIZED.value, 1),
        else_=2,
    )
    return (
        select(run)
        .where(*where)
        .distinct(partition)
        .order_by(partition, tier, run.created_at.desc(), run.id.desc())
    )


def resolved_run_ids(*, project_id: UUID, template_id: UUID) -> CTE:
    """Each article's resolved run id on the template; binds no id list."""
    current = current_runs(
        ExtractionRun.article_id,
        ExtractionRun.project_id == project_id,
        ExtractionRun.template_id == template_id,
    ).subquery()
    return (
        select(current.c.id.label("run_id"))
        .where(current.c.stage.in_(ExtractionRunStage.resolvable()))
        .cte("resolved_runs")
    )
