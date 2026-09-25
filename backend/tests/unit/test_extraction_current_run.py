"""Unit tests for the moved current-run rule (`app.services.extraction_current_run`).

Same rule as export's former ``_select_current_runs_by_article``: prefer the
latest non-terminal run, otherwise the latest finalized run, otherwise the
latest cancelled run, ties broken by ``(created_at, str(id))``.
"""

from __future__ import annotations

from datetime import UTC, datetime
from unittest.mock import MagicMock
from uuid import UUID, uuid4

from app.models.extraction import ExtractionRun, ExtractionRunStage
from app.services.extraction_current_run import (
    ACTIVE_RUN_STAGES,
    select_current_runs_by_article,
)


def _make_run(
    *,
    article_id: UUID | None = None,
    stage: str = ExtractionRunStage.FINALIZED.value,
    created_at: datetime | None = None,
) -> ExtractionRun:
    run = MagicMock(spec=ExtractionRun)
    run.id = uuid4()
    run.article_id = article_id or uuid4()
    run.stage = stage
    run.created_at = created_at or datetime(2026, 1, 1, tzinfo=UTC)
    return run


def test_live_wins_over_newer_finalized() -> None:
    article_id = uuid4()
    finalized = _make_run(
        article_id=article_id,
        stage=ExtractionRunStage.FINALIZED.value,
        created_at=datetime(2026, 1, 2, tzinfo=UTC),
    )
    extract = _make_run(
        article_id=article_id,
        stage=ExtractionRunStage.EXTRACT.value,
        created_at=datetime(2026, 1, 1, tzinfo=UTC),
    )
    selected = select_current_runs_by_article([finalized, extract])
    assert selected[article_id] is extract


def test_consensus_after_finalized_wins() -> None:
    article_id = uuid4()
    finalized = _make_run(
        article_id=article_id,
        stage=ExtractionRunStage.FINALIZED.value,
        created_at=datetime(2026, 1, 1, tzinfo=UTC),
    )
    consensus = _make_run(
        article_id=article_id,
        stage=ExtractionRunStage.CONSENSUS.value,
        created_at=datetime(2026, 1, 2, tzinfo=UTC),
    )
    selected = select_current_runs_by_article([finalized, consensus])
    assert selected[article_id] is consensus


def test_finalized_over_cancelled() -> None:
    article_id = uuid4()
    finalized = _make_run(article_id=article_id, stage=ExtractionRunStage.FINALIZED.value)
    cancelled = _make_run(article_id=article_id, stage=ExtractionRunStage.CANCELLED.value)
    selected = select_current_runs_by_article([finalized, cancelled])
    assert selected[article_id] is finalized


def test_cancelled_only() -> None:
    article_id = uuid4()
    cancelled = _make_run(article_id=article_id, stage=ExtractionRunStage.CANCELLED.value)
    selected = select_current_runs_by_article([cancelled])
    assert selected[article_id] is cancelled


def test_tie_broken_by_id() -> None:
    article_id = uuid4()
    same_time = datetime(2026, 1, 1, tzinfo=UTC)
    run_a = _make_run(
        article_id=article_id, stage=ExtractionRunStage.EXTRACT.value, created_at=same_time
    )
    run_b = _make_run(
        article_id=article_id, stage=ExtractionRunStage.EXTRACT.value, created_at=same_time
    )
    expected = max([run_a, run_b], key=lambda r: str(r.id))
    selected = select_current_runs_by_article([run_a, run_b])
    assert selected[article_id] is expected


def test_active_stages() -> None:
    assert {"pending", "extract", "consensus"} == ACTIVE_RUN_STAGES
