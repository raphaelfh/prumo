"""Fixtures for /mcp tests (spec §8).

bind_mcp_session_factory is autouse: the one request session of every /mcp
request in this directory (``mcp_session.request_session``, opened by the auth
wrapper or by ``mcp_client``) joins the test's db_session connection
(SAVEPOINT), so seed rows are visible and nothing commits for real.
@pytest.mark.mcp_real_sessions opts out: each request session gets its own
NullPool connection (race tests; they clean up).
"""

import asyncio
from collections.abc import AsyncGenerator, AsyncIterator, Callable, Iterator
from contextlib import AbstractAsyncContextManager, asynccontextmanager
from dataclasses import dataclass
from typing import Literal
from uuid import UUID

import pytest
import pytest_asyncio
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from mcp import Client
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.api.mcp import server
from app.api.mcp import session as mcp_session
from app.api.mcp.asgi_auth import current_principal, principal_var
from app.api.mcp.server import agent_tool
from app.core.config import settings
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


@asynccontextmanager
async def _serve(app: FastAPI, base_url: str) -> AsyncIterator[AsyncClient]:
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
        async with AsyncClient(transport=ASGITransport(app=app), base_url=base_url) as client:
            yield client
    finally:
        stop.set()
        await manager_task


OAUTH_BASE_URL = "http://localhost:8000"
PRM_URL = OAUTH_BASE_URL + "/.well-known/oauth-protected-resource/mcp"


@asynccontextmanager
async def _client_in_mode(mode: str, monkeypatch: pytest.MonkeyPatch) -> AsyncIterator[AsyncClient]:
    """OAuth off pins ``PUBLIC_API_URL`` to ``None`` (a developer ``.env`` must not
    flip it). OAuth on uses ``OAUTH_BASE_URL``: the SDK accepts only an https or a
    localhost http issuer, so never ``http://test``."""
    on = mode == "oauth_on"
    monkeypatch.setattr(settings, "PUBLIC_API_URL", OAUTH_BASE_URL if on else None)
    async with _serve(create_app(), OAUTH_BASE_URL if on else "http://test") as c:
        yield c


@pytest_asyncio.fixture
async def mcp_http_client(monkeypatch: pytest.MonkeyPatch) -> AsyncGenerator[AsyncClient, None]:
    async with _client_in_mode("oauth_off", monkeypatch) as c:
        yield c


@pytest_asyncio.fixture
async def oauth_http_client(monkeypatch: pytest.MonkeyPatch) -> AsyncGenerator[AsyncClient, None]:
    async with _client_in_mode("oauth_on", monkeypatch) as c:
        yield c


@pytest.fixture(params=["oauth_off", "oauth_on"])
def auth_mode(request: pytest.FixtureRequest) -> str:
    return str(request.param)


@pytest_asyncio.fixture
async def mode_http_client(
    auth_mode: str, monkeypatch: pytest.MonkeyPatch
) -> AsyncGenerator[AsyncClient, None]:
    """``mcp_http_client`` or ``oauth_http_client``, per ``auth_mode``."""
    async with _client_in_mode(auth_mode, monkeypatch) as c:
        yield c


def expected_challenge(mode: str, *, presented: bool) -> str:
    if mode == "oauth_off":
        return "Bearer"
    meta = f'resource_metadata="{PRM_URL}"'
    return f'Bearer error="invalid_token", {meta}' if presented else f"Bearer {meta}"


@dataclass(frozen=True)
class SeededPat:
    secret: str
    principal: McpPrincipal

    @property
    def headers(self) -> dict[str, str]:
        return {"Authorization": f"Bearer {self.secret}"}


async def _seed_pat(
    db: AsyncSession,
    user_id: UUID,
    scope: Literal["read", "read_write"],
    project_ids: list[UUID] | None = None,
) -> SeededPat:
    created = await create_token(
        db,
        user_id=user_id,
        payload=PersonalAccessTokenCreateRequest(
            name=f"pytest-{scope}", scope=scope, expires_in_days=30, project_ids=project_ids
        ),
    )
    principal = await resolve_principal(db, created.secret)
    assert principal is not None
    return SeededPat(created.secret, principal)


@pytest_asyncio.fixture
async def pat_primary_rw(db_session: AsyncSession) -> SeededPat:
    return await _seed_pat(db_session, SEED.primary_profile, "read_write")


@pytest_asyncio.fixture
async def pat_primary_rw_only_a(db_session: AsyncSession) -> SeededPat:
    """``primary_profile`` manages both seed projects; this token is restricted
    to ``SEED.primary_project`` (A), so ``SEED.secondary_project`` (B) is
    refused by the token alone, never by membership."""
    return await _seed_pat(
        db_session, SEED.primary_profile, "read_write", project_ids=[SEED.primary_project]
    )


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
    client wired directly to ``server.mcp``, with ``principal_var`` set and the
    request session bound (``mcp_session.request_session``, as the auth wrapper
    binds it) for the duration. Both are set before the client is entered, so
    the in-memory server task inherits both contextvars. Every call inside one
    ``async with`` shares that one session, like one /mcp request."""

    @asynccontextmanager
    async def connect(pat: SeededPat) -> AsyncIterator[Client]:
        token = principal_var.set(pat.principal)
        try:
            async with mcp_session.request_session(), Client(server.mcp) as client:
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
            requires="read",
            project_arg="project_id",
            title="Probe read",
            description="test",
            destructive=False,
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
            requires="read",
            project_arg="article_id",
            title="Probe article",
            description="test",
            destructive=False,
        )(probe_article),
        agent_tool(
            requires="read",
            project_arg=None,
            title="Probe whoami",
            description="test",
            destructive=False,
        )(probe_whoami),
        agent_tool(
            requires="read",
            project_arg=None,
            title="Probe text",
            description="test",
            destructive=False,
            structured_output=False,
        )(probe_text),
        agent_tool(
            requires="read",
            project_arg=None,
            title="Probe boom",
            description="test",
            destructive=False,
        )(probe_boom),
    ]
    try:
        yield
    finally:
        for fn in registered:
            server.mcp.remove_tool(fn.__name__)
            server._RULES.pop(fn.__name__, None)
