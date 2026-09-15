from datetime import UTC, datetime, timedelta
from uuid import uuid4

from app.services.extraction_batch_view import ItemRow, derive_batch, item_outcome

NOW = datetime(2026, 9, 15, 12, 0, tzinfo=UTC)


def row(
    status: str = "queued",
    *,
    attempt: str | None = None,
    result: dict | None = None,
    error_code: str | None = None,
    reason: str | None = None,
    attempt_id=True,
    minutes_ago: int = 1,
) -> ItemRow:
    at = NOW - timedelta(minutes=minutes_ago)
    return ItemRow(
        article_id=uuid4(),
        title="t",
        status=status,
        reason_code=reason,
        updated_at=at,
        attempt_id=uuid4() if (attempt and attempt_id) else None,
        attempt_status=attempt,
        attempt_result=result,
        attempt_error_code=error_code,
        attempt_error="boom" if error_code else None,
        attempt_updated_at=at if attempt else None,
    )


def test_item_outcomes() -> None:
    assert item_outcome(row("queued")) == ("queued", None)
    assert item_outcome(row("skipped", reason="RUN_FINALIZED")) == ("skipped", "RUN_FINALIZED")
    assert item_outcome(row("failed", reason="NO_LONGER_AVAILABLE")) == (
        "needs_attention",
        "NO_LONGER_AVAILABLE",
    )
    assert item_outcome(row("cancelled", reason="CANCELLED")) == ("not_run", "CANCELLED")
    assert item_outcome(row("dispatched", attempt="pending")) == ("running", None)
    assert item_outcome(row("dispatched", attempt="running")) == ("running", None)
    assert item_outcome(row("dispatched", attempt="completed", result={"failed_sections": 0})) == (
        "done",
        None,
    )
    assert item_outcome(
        row("dispatched", attempt="completed", result={"failed_sections": 2, "total_sections": 9})
    ) == ("done_with_issues", None)
    assert item_outcome(row("dispatched", attempt="failed", error_code="PDF_NOT_FOUND")) == (
        "needs_attention",
        "PDF_NOT_FOUND",
    )
    assert item_outcome(row("dispatched", attempt="cancelled")) == ("not_run", None)
    # Attempt deleted with its run (FK SET NULL).
    assert item_outcome(row("dispatched")) == ("skipped", "NO_LONGER_AVAILABLE")


def test_active_while_anything_is_queued_or_running() -> None:
    view = derive_batch(
        cancelled_at=None,
        stop_code=None,
        created_at=NOW,
        now=NOW,
        rows=[row("dispatched", attempt="completed", result={}), row("queued")],
    )
    assert view.state == "active" and view.finished_at is None and not view.stalled
    assert view.counts.total == 2 and view.counts.done == 1 and view.counts.queued == 1


def test_finished_takes_the_latest_update() -> None:
    rows = [
        row("dispatched", attempt="completed", result={}, minutes_ago=5),
        row("skipped", reason="AI_ALREADY_RUNNING", minutes_ago=2),
    ]
    view = derive_batch(cancelled_at=None, stop_code=None, created_at=NOW, now=NOW, rows=rows)
    assert view.state == "finished"
    assert view.finished_at == NOW - timedelta(minutes=2)


def test_cancelled_stays_active_until_in_flight_articles_finish() -> None:
    rows = [row("dispatched", attempt="pending"), row("cancelled", reason="CANCELLED")]
    assert (
        derive_batch(cancelled_at=NOW, stop_code=None, created_at=NOW, now=NOW, rows=rows).state
        == "active"
    )
    rows[0] = row("dispatched", attempt="completed", result={})
    view = derive_batch(cancelled_at=NOW, stop_code=None, created_at=NOW, now=NOW, rows=rows)
    assert view.state == "cancelled" and view.counts.not_run == 1


def test_stopped_by_engine_error() -> None:
    rows = [
        row("dispatched", attempt="failed", error_code="MISSING_API_KEY"),
        row("cancelled", reason="STOPPED_ENGINE_ERROR"),
    ]
    view = derive_batch(
        cancelled_at=None, stop_code="MISSING_API_KEY", created_at=NOW, now=NOW, rows=rows
    )
    assert view.state == "stopped" and view.counts.needs_attention == 1 and view.counts.not_run == 1


def test_stalled_after_15_minutes_without_progress() -> None:
    fresh = derive_batch(
        cancelled_at=None,
        stop_code=None,
        created_at=NOW,
        now=NOW,
        rows=[row("dispatched", attempt="pending", minutes_ago=14)],
    )
    stale = derive_batch(
        cancelled_at=None,
        stop_code=None,
        created_at=NOW,
        now=NOW,
        rows=[row("dispatched", attempt="pending", minutes_ago=16)],
    )
    assert not fresh.stalled and stale.stalled


def test_item_view_carries_section_counts_and_message() -> None:
    view = derive_batch(
        cancelled_at=None,
        stop_code=None,
        created_at=NOW,
        now=NOW,
        rows=[
            row(
                "dispatched",
                attempt="completed",
                result={"failed_sections": 2, "total_sections": 9},
            ),
            row("dispatched", attempt="failed", error_code="EXTRACTION_FAILED"),
        ],
    )
    done, failed = view.items
    assert (done.failed_sections, done.total_sections, done.outcome) == (2, 9, "done_with_issues")
    assert (failed.reason_code, failed.message) == ("EXTRACTION_FAILED", "boom")
