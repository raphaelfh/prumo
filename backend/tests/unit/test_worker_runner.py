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
