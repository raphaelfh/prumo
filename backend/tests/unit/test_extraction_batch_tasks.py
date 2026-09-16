"""Wiring of the batch task and the Celery semantics the dispatcher relies on."""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import patch
from uuid import uuid4

from celery.app.task import Context

from app.worker.celery_app import celery_app
from app.worker.tasks import extraction_batch_tasks as tasks
from app.worker.tasks.extraction_tasks import run_section_extraction_task


def test_batch_task_routes_to_extractions_without_rate_limit() -> None:
    route = celery_app.conf.task_routes["app.worker.tasks.extraction_batch_tasks.*"]
    assert route == {"queue": "extractions"}
    assert tasks.advance_extraction_batch.rate_limit is None


def test_enqueue_attempt_links_success_and_final_failure_back_to_the_batch() -> None:
    attempt = SimpleNamespace(
        id=uuid4(), owner_id=uuid4(), job_id="job-1", request_payload={"x": 1}
    )
    batch_id = uuid4()
    with patch.object(run_section_extraction_task, "apply_async") as apply_async:
        tasks.enqueue_attempt(attempt, batch_id)

    kwargs = apply_async.call_args.kwargs
    assert kwargs["task_id"] == "job-1"
    assert kwargs["kwargs"] == {"attempt_id": str(attempt.id)}
    for key in ("link", "link_error"):
        sig = kwargs[key]
        assert sig.task == tasks.advance_extraction_batch.name
        assert sig.args == (str(batch_id),)
        assert sig.immutable


def test_a_retry_keeps_the_callbacks() -> None:
    link = tasks.advance_extraction_batch.si("b")
    request = Context(id="job-1", args=(), kwargs={}, callbacks=[link], errbacks=[link], retries=0)
    retried = run_section_extraction_task.signature_from_request(request)
    assert retried.options["link"] == [link]
    assert retried.options["link_error"] == [link]
