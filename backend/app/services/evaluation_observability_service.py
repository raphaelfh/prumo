"""Observability helpers for unified evaluation workflows."""

from collections.abc import Mapping
from time import perf_counter
from uuid import UUID

from app.core.logging import get_logger

logger = get_logger(__name__)


def log_evaluation_event(
    event_name: str,
    *,
    trace_id: str | None = None,
    run_id: UUID | None = None,
    project_id: UUID | None = None,
    extra: Mapping[str, object] | None = None,
) -> None:
    """Emit structured evaluation event logs."""
    payload: dict[str, object] = {
        "event_name": event_name,
        "trace_id": trace_id,
        "run_id": str(run_id) if run_id else None,
        "project_id": str(project_id) if project_id else None,
    }
    if extra:
        payload.update(dict(extra))
    logger.info("evaluation_event", **payload)


def log_stage_failure(
    *,
    stage: str,
    reason: str,
    trace_id: str | None = None,
    run_id: UUID | None = None,
) -> None:
    """Emit stage failure event with consistent fields."""
    logger.warning(
        "evaluation_stage_failure",
        stage=stage,
        reason=reason,
        trace_id=trace_id,
        run_id=str(run_id) if run_id else None,
    )


def log_publish_conflict(
    *,
    target_id: UUID,
    item_id: UUID,
    schema_version_id: UUID,
    trace_id: str | None = None,
) -> None:
    """Emit conflict metric/log event for consensus publication."""
    logger.warning(
        "evaluation_publish_conflict",
        target_id=str(target_id),
        item_id=str(item_id),
        schema_version_id=str(schema_version_id),
        trace_id=trace_id,
    )


class EvaluationTimer:
    """Simple context manager to measure duration in milliseconds."""

    def __init__(self, metric_name: str, *, trace_id: str | None = None):
        self.metric_name = metric_name
        self.trace_id = trace_id
        self._started_at = 0.0

    def __enter__(self) -> "EvaluationTimer":
        self._started_at = perf_counter()
        return self

    def __exit__(self, *_args: object) -> None:
        duration_ms = (perf_counter() - self._started_at) * 1000
        logger.info(
            "evaluation_duration_metric",
            metric_name=self.metric_name,
            duration_ms=duration_ms,
            trace_id=self.trace_id,
        )


def evaluate_queue_backlog_scale_trigger(
    *,
    backlog_size: int,
    duration_minutes: int,
    threshold_size: int = 500,
    threshold_minutes: int = 15,
    trace_id: str | None = None,
) -> bool:
    """Return whether backlog exceeds fixed scaling trigger threshold."""
    should_trigger = backlog_size > threshold_size and duration_minutes >= threshold_minutes
    logger.info(
        "evaluation_queue_backlog_check",
        trace_id=trace_id,
        backlog_size=backlog_size,
        duration_minutes=duration_minutes,
        threshold_size=threshold_size,
        threshold_minutes=threshold_minutes,
        should_trigger=should_trigger,
    )
    if should_trigger:
        logger.warning(
            "evaluation_queue_backlog_scale_alert",
            trace_id=trace_id,
            backlog_size=backlog_size,
            duration_minutes=duration_minutes,
        )
    return should_trigger
