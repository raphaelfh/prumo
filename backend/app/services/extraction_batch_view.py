"""Derived batch state (spec 2026-09-15 §7.2) — pure, so every reader agrees."""

from __future__ import annotations

from collections import Counter
from dataclasses import dataclass
from datetime import datetime, timedelta

from app.schemas.extraction_batch import (
    ATTEMPT_LIVE,
    BatchState,
    ExtractionBatchCounts,
    ExtractionBatchItemView,
    ItemOutcome,
    ItemRow,
)

__all__ = [
    "ATTEMPT_LIVE",
    "STALL_AFTER",
    "ItemRow",
    "BatchDerivation",
    "BatchWork",
    "item_outcome",
    "derive_batch",
    "batch_work",
]

STALL_AFTER = timedelta(minutes=15)
NO_LONGER_AVAILABLE = "NO_LONGER_AVAILABLE"


@dataclass(frozen=True)
class BatchDerivation:
    state: BatchState
    stalled: bool
    finished_at: datetime | None
    counts: ExtractionBatchCounts
    items: list[ExtractionBatchItemView]


_BY_ITEM_STATUS: dict[str, ItemOutcome] = {
    "queued": "queued",
    "skipped": "skipped",
    "failed": "needs_attention",
    "cancelled": "not_run",
}


def item_outcome(row: ItemRow) -> tuple[ItemOutcome, str | None]:
    if row.status != "dispatched":
        return _BY_ITEM_STATUS[row.status], row.reason_code
    if row.attempt_id is None:
        return "skipped", NO_LONGER_AVAILABLE
    if row.attempt_status in ATTEMPT_LIVE:
        return "running", None
    if row.attempt_status == "completed":
        failed = int((row.attempt_result or {}).get("failed_sections") or 0)
        return ("done_with_issues" if failed > 0 else "done"), None
    if row.attempt_status == "failed":
        return "needs_attention", row.attempt_error_code
    return "not_run", None


def _last_touch(row: ItemRow) -> datetime:
    return max(t for t in (row.updated_at, row.attempt_updated_at) if t is not None)


def derive_batch(
    *,
    cancelled_at: datetime | None,
    stop_code: str | None,
    created_at: datetime,
    rows: list[ItemRow],
    now: datetime,
) -> BatchDerivation:
    items: list[ExtractionBatchItemView] = []
    tally: Counter[str] = Counter()
    for row in rows:
        outcome, reason = item_outcome(row)
        tally[outcome] += 1
        result = row.attempt_result or {}
        items.append(
            ExtractionBatchItemView(
                article_id=row.article_id,
                title=row.title,
                outcome=outcome,
                reason_code=reason,
                message=row.attempt_error if outcome == "needs_attention" else None,
                failed_sections=result.get("failed_sections"),
                total_sections=result.get("total_sections"),
            )
        )

    counts = ExtractionBatchCounts(
        total=len(rows),
        queued=tally["queued"],
        running=tally["running"],
        done=tally["done"],
        done_with_issues=tally["done_with_issues"],
        needs_attention=tally["needs_attention"],
        skipped=tally["skipped"],
        not_run=tally["not_run"],
    )
    halted = cancelled_at is not None or stop_code is not None
    active = counts.running > 0 or (counts.queued > 0 and not halted)
    last = max((_last_touch(r) for r in rows), default=created_at)

    state: BatchState
    if active:
        state = "active"
    elif cancelled_at is not None:
        state = "cancelled"
    elif stop_code is not None:
        state = "stopped"
    else:
        state = "finished"

    return BatchDerivation(
        state=state,
        stalled=active and now - last > STALL_AFTER,
        finished_at=None if active else last,
        counts=counts,
        items=items,
    )


@dataclass(frozen=True)
class BatchWork:
    """What the batch's finished attempts produced."""

    suggestions_created: int
    tokens_used: int | None  # None: no attempt reported per-section token usage


def batch_work(rows: list[ItemRow]) -> BatchWork:
    """Sum the attempts' results: ``total_suggestions_created`` (all-sections
    mode) or ``suggestions_created`` (single section), and each section's
    ``tokens_used``."""
    suggestions = 0
    tokens: int | None = None
    for row in rows:
        result = row.attempt_result or {}
        created = result.get("total_suggestions_created", result.get("suggestions_created"))
        suggestions += int(created or 0)
        for section in result.get("sections") or []:
            used = section.get("tokens_used")
            if isinstance(used, int):
                tokens = (tokens or 0) + used
    return BatchWork(suggestions_created=suggestions, tokens_used=tokens)
