"""Shared async runner for Celery tasks.

Every Celery task in this codebase is a synchronous entry point that
delegates real work to an async coroutine. This module provides the one
correct way to bridge the two:

    @celery_app.task
    def my_task(...):
        async def run() -> dict:
            async with worker_session() as db:
                ...
        return run_task(run)

Why a fresh ``asyncio.run()`` per invocation:

- A previous iteration of this codebase cached one event loop in a
  module global and reused it across all task invocations. Combined
  with ``@lru_cache`` on ``get_supabase_client``, that meant the
  Supabase httpx client's connection-pool futures were bound to
  whichever loop ran first — any subsequent task on a different loop
  raised ``RuntimeError: <Future ...> attached to a different loop``.
  The bug surfaced on 2026-05-24 against ``export_extraction_task``.

Why the runner takes a *factory*, not a coroutine:

- Coroutines created at import time bind to whichever loop happens to
  be running when the module is imported (or ``None``). Requiring
  callers to pass a zero-arg callable defers coroutine construction
  until ``asyncio.run`` is already running.
"""

from __future__ import annotations

import asyncio
import inspect
from collections.abc import Awaitable, Callable
from typing import TypeVar

T = TypeVar("T")


def run_task(coro_factory: Callable[[], Awaitable[T]]) -> T:
    """Run an async coroutine in a fresh event loop and return its result.

    Args:
        coro_factory: Zero-argument callable that returns the coroutine
            to run. Must be a callable — passing a coroutine directly
            defeats the per-call loop guarantee.

    Raises:
        TypeError: if ``coro_factory`` is a coroutine object or not callable.
        Exception: re-raises any exception raised by the coroutine.
    """
    if inspect.iscoroutine(coro_factory):
        raise TypeError(
            "run_task requires a zero-arg callable, got a coroutine object. "
            "Pass the function itself (e.g. run_task(run)), not the result "
            "of calling it (e.g. run_task(run()))."
        )
    if not callable(coro_factory):
        raise TypeError(
            f"run_task requires a zero-arg callable, got {type(coro_factory).__name__}."
        )
    return asyncio.run(coro_factory())
