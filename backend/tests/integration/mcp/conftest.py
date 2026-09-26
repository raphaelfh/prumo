"""Fixtures for /mcp tests (spec §8).

bind_mcp_session_factory is autouse: every tool / auth-wrapper session in this
directory joins the test's db_session connection (SAVEPOINT), so seed rows are
visible and nothing commits for real. @pytest.mark.mcp_real_sessions opts out:
each session gets its own NullPool connection (race tests; they clean up).
"""

import asyncio
from collections.abc import AsyncGenerator, AsyncIterator, Callable, Iterator
from contextlib import AbstractAsyncContextManager, asynccontextmanager
from dataclasses import dataclass
from typing import Literal
from uuid import UUID

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from mcp import Client
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.api.mcp import server
from app.api.mcp import session as mcp_session
from app.api.mcp.asgi_auth import current_principal, principal_var
from app.api.mcp.server import agent_tool
from app.main import create_app
from app.schemas.mcp_auth import McpPrincipal
from app.schemas.personal_access_token import PersonalAccessTokenCreateRequest
from app.services.pat_service import create_token, resolve_principal
from tests.integration.conftest import SEED


class _FakeStorage:
    def __init__(self) -> None:
        self.calls: list[tuple[str, str, int]] = []

    async def get_signed_url(self, bucket: str, path: str, expires_in: int = 3600) -> str:
        self.calls.append((bucket, path, expires_in))
        return f"https://storage.test/signed/{path}?token=fake"


@pytest.fixture
def fake_storage(monkeypatch: pytest.MonkeyPatch) -> _FakeStorage:
    fake = _FakeStorage()
    monkeypatch.setattr(mcp_session, "storage_factory", lambda: fake)  # restored after the test
    return fake


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


@dataclass(frozen=True)
class SeededPat:
    secret: str
    principal: McpPrincipal

    @property
    def headers(self) -> dict[str, str]:
        return {"Authorization": f"Bearer {self.secret}"}


async def _seed_pat(
    db: AsyncSession, user_id: UUID, scope: Literal["read", "read_write"]
) -> SeededPat:
    created = await create_token(
        db,
        user_id=user_id,
        payload=PersonalAccessTokenCreateRequest(
            name=f"pytest-{scope}", scope=scope, expires_in_days=30
        ),
    )
    principal = await resolve_principal(db, created.secret)
    assert principal is not None
    return SeededPat(created.secret, principal)


@pytest_asyncio.fixture
async def pat_primary_rw(db_session: AsyncSession) -> SeededPat:
    return await _seed_pat(db_session, SEED.primary_profile, "read_write")


@pytest_asyncio.fixture
async def pat_primary_read(db_session: AsyncSession) -> SeededPat:
    return await _seed_pat(db_session, SEED.primary_profile, "read")


@pytest_asyncio.fixture
async def pat_reviewer_rw(db_session: AsyncSession) -> SeededPat:
    return await _seed_pat(db_session, SEED.reviewer_profile, "read_write")


@pytest_asyncio.fixture
async def pat_outsider_rw(db_session: AsyncSession) -> SeededPat:
    return await _seed_pat(db_session, SEED.outsider_profile, "read_write")


@pytest.fixture
def mcp_client() -> Callable[[SeededPat], AbstractAsyncContextManager[Client]]:
    """A factory: ``async with mcp_client(pat) as client:`` — an in-memory SDK
    client wired directly to ``server.mcp``, with ``principal_var`` set for the
    duration (the contextvar survives because the in-memory transport runs the
    tool handler in the same asyncio task)."""

    @asynccontextmanager
    async def connect(pat: SeededPat) -> AsyncIterator[Client]:
        token = principal_var.set(pat.principal)
        try:
            async with Client(server.mcp) as client:
                yield client
        finally:
            principal_var.reset(token)

    return connect


class ProbeResult(BaseModel):
    ok: bool
    user_sub: str | None = None


async def probe_read(db: AsyncSession, project_id: UUID) -> ProbeResult:  # noqa: ARG001
    return ProbeResult(ok=True)


async def probe_write(db: AsyncSession, project_id: UUID) -> ProbeResult:  # noqa: ARG001
    return ProbeResult(ok=True)


async def probe_article(db: AsyncSession, article_id: UUID) -> ProbeResult:  # noqa: ARG001
    return ProbeResult(ok=True)


async def probe_whoami(db: AsyncSession) -> ProbeResult:  # noqa: ARG001
    return ProbeResult(ok=True, user_sub=str(current_principal().user_sub))


async def probe_text(db: AsyncSession) -> str:  # noqa: ARG001
    return "plain"


async def probe_boom(db: AsyncSession) -> ProbeResult:  # noqa: ARG001
    return ProbeResult.model_validate({"ok": "not-a-bool"})


@pytest.fixture
def probe_tools() -> Iterator[None]:
    """Registers module-level probe tools through ``agent_tool``, the same
    choke point real tools use, and un-registers them on teardown."""
    registered = [
        agent_tool(
            requires="read", project_arg="project_id", title="Probe read", description="test"
        )(probe_read),
        agent_tool(
            requires="write",
            project_arg="project_id",
            title="Probe write",
            description="test",
            destructive=True,
            idempotent=False,
        )(probe_write),
        agent_tool(
            requires="read", project_arg="article_id", title="Probe article", description="test"
        )(probe_article),
        agent_tool(requires="read", project_arg=None, title="Probe whoami", description="test")(
            probe_whoami
        ),
        agent_tool(
            requires="read",
            project_arg=None,
            title="Probe text",
            description="test",
            structured_output=False,
        )(probe_text),
        agent_tool(requires="read", project_arg=None, title="Probe boom", description="test")(
            probe_boom
        ),
    ]
    try:
        yield
    finally:
        for fn in registered:
            server.mcp.remove_tool(fn.__name__)
            server._RULES.pop(fn.__name__, None)
