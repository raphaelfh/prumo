"""Unit tests for the shared worker task runner.

The headline test (`test_two_sequential_calls_do_not_share_loop`) is the
regression guard for the 2026-05-24 event-loop bug: two tasks running on
the same worker process must each get a clean loop so cached httpx /
asyncpg primitives from a previous loop cannot leak in.
"""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable

import pytest

from app.worker._runner import run_task


def _make_factory(probe: dict) -> Callable[[], Awaitable[int]]:
    async def coro() -> int:
        probe["loop"] = asyncio.get_running_loop()
        return 42

    return coro


def test_run_task_returns_coroutine_result() -> None:
    probe: dict = {}
    assert run_task(_make_factory(probe)) == 42
    assert probe["loop"] is not None


def test_two_sequential_calls_do_not_share_loop() -> None:
    probe_a: dict = {}
    probe_b: dict = {}
    run_task(_make_factory(probe_a))
    run_task(_make_factory(probe_b))
    assert probe_a["loop"] is not None
    assert probe_b["loop"] is not None
    assert probe_a["loop"] is not probe_b["loop"], (
        "run_task must use a fresh event loop per invocation — "
        "loop reuse is the root cause of the 2026-05-24 export bug."
    )


def test_run_task_propagates_exceptions() -> None:
    async def coro() -> None:
        raise ValueError("boom")

    with pytest.raises(ValueError, match="boom"):
        run_task(coro)


def test_run_task_rejects_a_bare_coroutine() -> None:
    async def coro() -> int:
        return 1

    with pytest.raises(TypeError, match="coroutine object"):
        run_task(coro())  # type: ignore[arg-type]


def test_run_task_rejects_a_non_callable_non_coroutine() -> None:
    with pytest.raises(TypeError, match="run_task requires a zero-arg callable"):
        run_task(42)  # type: ignore[arg-type]


def test_logged_task_emits_specific_event_for_not_registered(monkeypatch):
    from celery.exceptions import NotRegistered

    from app.worker.celery_app import LoggedTask

    captured: list[tuple[str, dict]] = []

    class StubLogger:
        def error(self, event: str, **kw):
            captured.append((event, kw))

    monkeypatch.setattr("structlog.get_logger", lambda: StubLogger())

    task = LoggedTask()
    task.name = "ghost.task"
    task.on_failure(NotRegistered("ghost.task"), "task-123", (), {"a": 1}, None)

    assert captured, "on_failure should have logged"
    event, kw = captured[0]
    assert event == "celery.task_unregistered"
    assert kw["task_id"] == "task-123"
    assert kw["task_name"] == "ghost.task"
    assert "remediation" in kw


def test_logged_task_emits_generic_event_for_other_failures(monkeypatch):
    """Non-NotRegistered exceptions still go to ``task_failed``."""
    from app.worker.celery_app import LoggedTask

    captured: list[tuple[str, dict]] = []

    class StubLogger:
        def error(self, event: str, **kw):
            captured.append((event, kw))

    monkeypatch.setattr("structlog.get_logger", lambda: StubLogger())

    task = LoggedTask()
    task.name = "real.task"
    task.on_failure(ValueError("boom"), "task-456", (), {}, None)

    assert captured == [
        (
            "task_failed",
            {
                "task_id": "task-456",
                "task_name": "real.task",
                "error": "boom",
                "args": (),
                "kwargs": {},
            },
        )
    ]


def test_task_unknown_signal_emits_structured_event(monkeypatch):
    """The runtime hook for NotRegistered is the celery signal — not the
    task's on_failure callback. Verify the signal handler emits the
    correct structlog event when fired.
    """
    from celery.signals import task_unknown

    captured: list[tuple[str, dict]] = []

    class StubLogger:
        def error(self, event: str, **kw):
            captured.append((event, kw))

    monkeypatch.setattr("structlog.get_logger", lambda: StubLogger())

    # Import the celery_app module so the @task_unknown.connect handler
    # is registered as a side effect.
    import app.worker.celery_app  # noqa: F401

    task_unknown.send(
        sender=None,
        name="ghost.task",
        id="task-789",
        message=None,
        exc=None,
    )

    matches = [kw for event, kw in captured if event == "celery.task_unregistered"]
    assert matches, f"Expected celery.task_unregistered event from signal handler, got {captured!r}"
    kw = matches[-1]
    assert kw["task_id"] == "task-789"
    assert kw["task_name"] == "ghost.task"
    assert "remediation" in kw


def test_worker_session_uses_fresh_engine_each_call() -> None:
    """Each worker_session() must construct + dispose its own engine.

    The 2026-05-24 incident root cause was a module-global engine whose
    asyncpg connection pool bound its waiters to the first event loop
    that touched it. ``worker_session`` MUST build a per-call engine so
    no pool state ever crosses ``asyncio.run`` boundaries.
    """
    import asyncio

    from app.worker._session import worker_session

    engines_seen: list[int] = []

    async def grab_engine_id() -> None:
        async with worker_session() as session:
            engines_seen.append(id(session.bind))

    asyncio.run(grab_engine_id())
    asyncio.run(grab_engine_id())

    assert len(engines_seen) == 2
    assert engines_seen[0] != engines_seen[1], (
        "worker_session must construct a fresh engine per call — "
        "engine identity reuse is the root cause of the 2026-05-24 "
        "cross-loop bug."
    )
