"""Fixtures for /mcp tests (spec §8).

bind_mcp_session_factory is autouse: every tool / auth-wrapper session in this
directory joins the test's db_session connection (SAVEPOINT), so seed rows are
visible and nothing commits for real. @pytest.mark.mcp_real_sessions opts out:
each session gets its own NullPool connection (race tests; they clean up).
"""

import asyncio
from collections.abc import AsyncGenerator

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import async_sessionmaker

from app.api.mcp import session as mcp_session
from app.main import create_app


@pytest.fixture(autouse=True)
def bind_mcp_session_factory(
    request: pytest.FixtureRequest, monkeypatch: pytest.MonkeyPatch
) -> None:
    if request.node.get_closest_marker("mcp_real_sessions") is not None:
        engine = request.getfixturevalue("_engine")
        factory = async_sessionmaker(engine, expire_on_commit=False, autoflush=False)
    else:
        db_session = request.getfixturevalue("db_session")
        factory = async_sessionmaker(
            bind=db_session.bind,  # the AsyncConnection that holds the outer transaction
            expire_on_commit=False,
            autoflush=False,
            join_transaction_mode="create_savepoint",
        )
    monkeypatch.setattr(mcp_session, "session_factory", factory)


@pytest_asyncio.fixture
async def mcp_http_client() -> AsyncGenerator[AsyncClient, None]:
    """A fresh app per test: ASGITransport sends no lifespan events and a
    StreamableHTTPSessionManager.run() works once per instance, so the shared
    module-level app cannot host per-test runs.

    ``run()`` opens an anyio task group whose cancel scope must exit in the
    same asyncio Task it entered in. pytest-asyncio runs an async-generator
    fixture's setup and teardown as two separate top-level Tasks, so holding
    ``run()`` open directly across this fixture's ``yield`` raises "Attempted
    to exit cancel scope in a different task than it was entered in". A
    background task started with ``asyncio.create_task`` keeps its own Task
    identity for its whole life — regardless of which outer Task drives it
    via ``ready``/``stop`` — so entry and exit both happen inside it.
    """
    app = create_app()
    ready = asyncio.Event()
    stop = asyncio.Event()
    failure: dict[str, BaseException] = {}

    async def _run_manager() -> None:
        try:
            async with app.state.mcp_session_manager.run():
                ready.set()
                await stop.wait()
        except BaseException as exc:  # noqa: BLE001 - re-raised via `failure` below
            failure["error"] = exc
            ready.set()
            raise

    manager_task = asyncio.create_task(_run_manager())
    await ready.wait()
    if "error" in failure:
        raise failure["error"]

    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            yield client
    finally:
        stop.set()
        await manager_task
