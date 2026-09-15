"""AI batch dispatcher task (spec 2026-09-15 §8)."""

from __future__ import annotations

from typing import Any
from uuid import UUID

from celery import Task

from app.core.logging import get_logger
from app.worker._runner import run_task
from app.worker.celery_app import celery_app
from app.worker.tasks.extraction_tasks import run_section_extraction_task

logger = get_logger(__name__)


def enqueue_attempt(attempt: Any, batch_id: UUID) -> None:
    """Queue one article's attempt; its success or FINAL failure re-advances the batch.

    ``link_error`` fires once, after retries are exhausted (Celery skips
    errbacks on RETRY), and a retry re-sends both callbacks.
    """
    advance = advance_extraction_batch.si(str(batch_id))
    run_section_extraction_task.apply_async(
        args=(attempt.request_payload, str(attempt.owner_id), None),
        kwargs={"attempt_id": str(attempt.id)},
        task_id=attempt.job_id,
        link=advance,
        link_error=advance,
    )


@celery_app.task(bind=True, max_retries=0)
def advance_extraction_batch(
    self: Task[Any, Any], batch_id: str, reenqueue_stale: bool = False
) -> None:
    async def run() -> None:
        from app.services.extraction_batch_dispatcher import ExtractionBatchDispatcher
        from app.worker._session import worker_session

        async with worker_session() as db:
            await ExtractionBatchDispatcher(db, enqueue=enqueue_attempt).advance(
                UUID(batch_id), reenqueue_stale=reenqueue_stale
            )

    logger.info("extraction_batch.advance", batch_id=batch_id, task_id=self.request.id)
    run_task(run)


# ``rate_limit=None`` in the decorator CANNOT express "no rate limit":
# ``Task.bind()`` walks ``Task.from_config`` and replaces every attribute that
# is still None with the app default — here ``task_default_rate_limit``
# ("10/m"). A dispatcher capped at 10 advances/minute would stall a batch
# whose callbacks arrive faster than that, so the limit is cleared after
# binding, which is the only point at which the value sticks.
#
# ``setattr`` rather than a plain attribute write: vulture reads the latter as
# a dead attribute (nothing in app/ ever reads ``rate_limit`` — Celery does),
# and the dead-code ratchet takes no new findings.
setattr(advance_extraction_batch, "rate_limit", None)  # noqa: B010
