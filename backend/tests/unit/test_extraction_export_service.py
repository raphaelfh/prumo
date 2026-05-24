"""Unit coverage for extraction export service helpers."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from uuid import uuid4

from app.models.extraction import ExtractionRunStage
from app.services.extraction_export_service import _select_current_runs_by_article


def _run(article_id, stage: ExtractionRunStage, created_at: datetime):
    return SimpleNamespace(
        id=uuid4(),
        article_id=article_id,
        stage=stage.value,
        created_at=created_at,
    )


def test_select_current_run_prefers_active_revision_over_old_finalized_run():
    article_id = uuid4()
    base = datetime(2026, 5, 24, 10, 0, tzinfo=UTC)
    old_finalized = _run(article_id, ExtractionRunStage.FINALIZED, base)
    reopened_review = _run(article_id, ExtractionRunStage.REVIEW, base + timedelta(minutes=5))

    selected = _select_current_runs_by_article([old_finalized, reopened_review])

    assert selected[article_id].id == reopened_review.id


def test_select_current_run_prefers_latest_finalized_revision_when_no_active_run():
    article_id = uuid4()
    base = datetime(2026, 5, 24, 10, 0, tzinfo=UTC)
    old_finalized = _run(article_id, ExtractionRunStage.FINALIZED, base)
    latest_finalized = _run(
        article_id,
        ExtractionRunStage.FINALIZED,
        base + timedelta(minutes=5),
    )

    selected = _select_current_runs_by_article([latest_finalized, old_finalized])

    assert selected[article_id].id == latest_finalized.id


def test_select_current_run_keeps_cancelled_run_for_omission_accounting():
    article_id = uuid4()
    cancelled = _run(
        article_id,
        ExtractionRunStage.CANCELLED,
        datetime(2026, 5, 24, 10, 0, tzinfo=UTC),
    )

    selected = _select_current_runs_by_article([cancelled])

    assert selected[article_id].stage == ExtractionRunStage.CANCELLED.value
