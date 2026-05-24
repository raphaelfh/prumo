"""Per-task SQLAlchemy session for Celery workers.

The application-wide engine in ``app/core/deps.py`` is a module-level
global with a pooled connection set bound to the event loop active on
first checkout. The Celery worker calls ``asyncio.run(...)`` per task
(via ``app.worker._runner.run_task``), so loops are short-lived; reusing
the global engine across loops triggers ``RuntimeError: <Future ...>
attached to a different loop`` on any operation that touches the pool's
internal waiters.

This module exposes ``worker_session()`` — an async context manager that
builds a fresh engine with ``NullPool`` (no pooling), yields a session,
then disposes the engine. Cost: one extra TCP connection per task.
That's irrelevant for the worker's task rates and eliminates the
cross-loop hazard at the root.

Usage inside a Celery task:

    @celery_app.task
    def my_task(...):
        async def run():
            async with worker_session() as db:
                ...
        return run_task(run)
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.pool import NullPool

from app.core.config import settings


@asynccontextmanager
async def worker_session() -> AsyncIterator[AsyncSession]:
    """Yield a SQLAlchemy AsyncSession backed by a per-call engine.

    The engine uses ``NullPool`` — every connection is opened on demand
    and closed when the session ends. The engine itself is disposed
    when the context exits, releasing the underlying asyncpg
    connection. This guarantees no event-loop primitive survives past
    the task's ``asyncio.run`` boundary.
    """
    engine = create_async_engine(
        settings.async_database_url,
        echo=settings.DEBUG,
        poolclass=NullPool,
        connect_args={
            "statement_cache_size": 0,  # Compatible with pgbouncer
            "server_settings": {
                "jit": "off",  # Better performance for complex queries
            },
        },
    )
    factory = async_sessionmaker(
        engine,
        class_=AsyncSession,
        expire_on_commit=False,
        autoflush=False,
    )
    try:
        async with factory() as session:
            yield session
    finally:
        await engine.dispose()
