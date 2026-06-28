"""Guards for the parse task's time bounds + the Redis visibility window.

Root cause of the "stuck pending forever" bug: the LlamaParse parse() call
blocks (default 2h) with no Celery time limit, so a slow/stuck cloud job
never reaches a terminal status. These guards keep the bounds in place:

- The parse task carries PER-TASK soft/hard time limits (not global, so
  long-running extraction/LLM tasks are unaffected).
- The Redis visibility_timeout exceeds the parse hard limit, so an
  acks_late task can never be redelivered while still running (the classic
  Celery+Redis duplicate-execution footgun).
"""

from __future__ import annotations

import pytest
from celery.exceptions import SoftTimeLimitExceeded

import app.worker.tasks.parsing_tasks as parsing_tasks
from app.worker.celery_app import celery_app
from app.worker.tasks.parsing_tasks import parse_article_file_task


def test_parse_task_has_bounded_per_task_time_limits() -> None:
    assert parse_article_file_task.soft_time_limit is not None
    assert parse_article_file_task.time_limit is not None
    assert parse_article_file_task.soft_time_limit < parse_article_file_task.time_limit


def test_global_time_limits_stay_unset() -> None:
    # Setting a GLOBAL limit would cap legitimately long extraction/LLM tasks.
    assert celery_app.conf.task_soft_time_limit is None
    assert celery_app.conf.task_time_limit is None


def test_visibility_timeout_exceeds_parse_hard_limit() -> None:
    opts = celery_app.conf.broker_transport_options or {}
    visibility_timeout = opts.get("visibility_timeout")
    assert visibility_timeout is not None
    assert visibility_timeout > parse_article_file_task.time_limit


def test_soft_time_limit_marks_failed_terminally(monkeypatch: pytest.MonkeyPatch) -> None:
    # When the soft limit fires, the file must be marked parse_failed (not
    # retried), so a slow parse becomes terminal instead of lingering at pending.
    state: dict[str, object] = {"run_task_calls": 0, "marked": []}

    def fake_run_task(fn):  # type: ignore[no-untyped-def]
        state["run_task_calls"] = int(state["run_task_calls"]) + 1
        if state["run_task_calls"] == 1:
            raise SoftTimeLimitExceeded  # the parse exceeded its soft budget
        return fn()  # the _mark_parse_failed call

    def fake_mark(article_file_id: str, error_message: str) -> None:
        marked = state["marked"]
        assert isinstance(marked, list)
        marked.append((article_file_id, error_message))

    monkeypatch.setattr(parsing_tasks, "run_task", fake_run_task)
    monkeypatch.setattr(parsing_tasks, "_mark_parse_failed", fake_mark)

    with pytest.raises(SoftTimeLimitExceeded):
        parse_article_file_task.run("afid", "pid", "uid", "tid")

    assert state["marked"] == [("afid", "parse exceeded time limit")]
