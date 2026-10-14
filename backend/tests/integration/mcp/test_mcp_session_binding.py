"""Session/storage factory injection and the one-session-per-/mcp-request
binding (spec §3, §8).

Proves mcp_session.session_factory can be rebound to the test's SAVEPOINT
connection (default, via the autouse bind_mcp_session_factory fixture) or to
its own NullPool connections (@pytest.mark.mcp_real_sessions), that the
production defaults are the real app.core.deps singletons, and that one
/mcp request runs principal lookup, last-used touch and the tool call on ONE
session -- with a refusal discarding the tool's partial writes.
"""

import asyncio
from collections.abc import Iterator
from typing import Any
from unittest.mock import MagicMock
from uuid import UUID

import pytest
from httpx import AsyncClient
from pydantic import BaseModel
from sqlalchemy import event, text
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker

from app.api.mcp import server
from app.api.mcp import session as mcp_session
from app.api.mcp.server import agent_tool
from app.api.mcp.tools import template_draft as template_draft_tool
from app.core.deps import AsyncSessionLocal
from app.schemas.personal_access_token import PersonalAccessTokenCreateRequest
from app.services.pat_service import create_token, revoke_token
from app.services.project_template_active_service import ProjectTemplateNotFoundError
from tests.integration.conftest import SEED
from tests.integration.helpers.template_fixtures import fresh_charms
from tests.integration.mcp.conftest import SeededPat
from tests.integration.mcp.rpc import RPC_HEADERS, rpc
from tests.integration.mcp.tool_calls import error_payload, structured

_SPY_CALLS: list[str] = []
_IN_FLIGHT: dict[str, asyncio.Event] = {}
_PROBE_NAME = "mcp-binding-partial-write"


class _Ok(BaseModel):
    ok: bool


class _Name(BaseModel):
    name: str


class _Draft(BaseModel):
    labels: list[str]
    applied: int


async def probe_spy(db: AsyncSession) -> _Ok:  # noqa: ARG001
    _SPY_CALLS.append("called")
    return _Ok(ok=True)


async def probe_bound(db: AsyncSession) -> _Ok:
    return _Ok(ok=mcp_session.current_session() is db)


async def probe_wait(db: AsyncSession) -> _Ok:  # noqa: ARG001
    _IN_FLIGHT["entered"].set()
    await _IN_FLIGHT["release"].wait()
    return _Ok(ok=True)


async def probe_write_then_boom(db: AsyncSession, project_id: UUID) -> _Ok:
    await db.execute(
        text("UPDATE public.projects SET name = :n WHERE id = :p"),
        {"n": _PROBE_NAME, "p": str(project_id)},
    )
    raise RuntimeError("unexpected")


async def probe_project_name(db: AsyncSession, project_id: UUID) -> _Name:
    name = (
        await db.execute(
            text("SELECT name FROM public.projects WHERE id = :p"), {"p": str(project_id)}
        )
    ).scalar_one()
    return _Name(name=name)


async def probe_draft(db: AsyncSession, template_id: UUID) -> _Draft:
    labels = (
        await db.execute(
            text(
                "SELECT f.label FROM public.extraction_fields f "
                "JOIN public.extraction_entity_types et ON et.id = f.entity_type_id "
                "WHERE et.project_template_id = :tid ORDER BY f.label"
            ),
            {"tid": str(template_id)},
        )
    ).scalars()
    applied = (
        await db.execute(
            text(
                "SELECT count(*) FROM public.agent_actions "
                "WHERE outcome = 'applied' AND tool = 'edit_template_draft'"
            )
        )
    ).scalar_one()
    return _Draft(labels=list(labels), applied=applied)


_PROBES = (
    probe_spy,
    probe_bound,
    probe_wait,
    probe_write_then_boom,
    probe_project_name,
    probe_draft,
)


@pytest.fixture
def spy_tool() -> Iterator[list[str]]:
    _SPY_CALLS.clear()
    for fn in _PROBES:
        agent_tool(requires="read", project_arg=None, title=fn.__name__, description="test")(fn)
    try:
        yield _SPY_CALLS
    finally:
        for fn in _PROBES:
            server.mcp.remove_tool(fn.__name__)
            server._RULES.pop(fn.__name__, None)


async def _real_pat(engine: AsyncEngine, *, last_used: str | None) -> SeededPat:
    """A committed PAT (real sessions see only committed rows)."""
    async with async_sessionmaker(engine, expire_on_commit=False)() as db:
        created = await create_token(
            db,
            user_id=SEED.outsider_profile,
            payload=PersonalAccessTokenCreateRequest(
                name="binding", scope="read", expires_in_days=30
            ),
        )
        if last_used is not None:
            await db.execute(
                text(
                    f"UPDATE public.personal_access_tokens SET last_used_at = {last_used} "  # noqa: S608
                    "WHERE id = :id"
                ),
                {"id": str(created.token.id)},
            )
        await db.commit()
    return SeededPat(created.secret, MagicMock(token_id=created.token.id))


async def _delete_pat(engine: AsyncEngine, pat: SeededPat) -> None:
    async with async_sessionmaker(engine)() as db:
        await db.execute(
            text("DELETE FROM public.personal_access_tokens WHERE id = :id"),
            {"id": str(pat.principal.token_id)},
        )
        await db.commit()


async def test_factory_session_joins_the_test_transaction(db_session) -> None:  # type: ignore[no-untyped-def]
    await db_session.execute(
        text("UPDATE public.projects SET name = 'mcp-binding-probe' WHERE id = :p"),
        {"p": str(SEED.primary_project)},
    )

    async with mcp_session.session_factory() as s:
        result = await s.execute(
            text("SELECT name FROM public.projects WHERE id = :p"), {"p": str(SEED.primary_project)}
        )
        assert result.scalar_one() == "mcp-binding-probe"

        factory_pid = (await s.execute(text("SELECT pg_backend_pid()"))).scalar_one()

    db_session_pid = (await db_session.execute(text("SELECT pg_backend_pid()"))).scalar_one()
    assert factory_pid == db_session_pid


@pytest.mark.mcp_real_sessions
async def test_marked_test_gets_its_own_connections() -> None:
    async with mcp_session.session_factory() as s1, mcp_session.session_factory() as s2:
        pid1 = (await s1.execute(text("SELECT pg_backend_pid()"))).scalar_one()
        pid2 = (await s2.execute(text("SELECT pg_backend_pid()"))).scalar_one()

    assert pid1 != pid2


def test_default_factories_are_the_production_ones(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.undo()
    assert mcp_session.session_factory is AsyncSessionLocal

    monkeypatch.setattr(mcp_session, "get_supabase_client", lambda: MagicMock())
    first = mcp_session.storage_factory()
    second = mcp_session.storage_factory()
    assert first is not second


async def test_a_batch_of_tool_calls_is_refused_without_running_a_tool(
    mcp_http_client: AsyncClient, pat_primary_read: SeededPat, spy_tool: list[str]
) -> None:
    body = [
        {"jsonrpc": "2.0", "id": i, "method": "tools/call", "params": {"name": "probe_spy"}}
        for i in (1, 2)
    ]
    r = await mcp_http_client.post(
        "/mcp", json=body, headers={**RPC_HEADERS, **pat_primary_read.headers}
    )

    assert r.status_code == 400, r.text  # one POST carries one call: the request session is safe
    assert spy_tool == []

    single = await rpc(
        mcp_http_client, "tools/call", {"name": "probe_spy"}, headers=pat_primary_read.headers
    )
    assert single.status_code == 200
    assert spy_tool == ["called"]  # the spy does observe a call that runs


def test_current_session_outside_a_request_raises() -> None:
    with pytest.raises(LookupError):
        mcp_session.current_session()


@pytest.mark.usefixtures("spy_tool")
async def test_in_memory_client_binds_the_request_session(
    mcp_client: Any, pat_primary_read: SeededPat
) -> None:
    async with mcp_client(pat_primary_read) as client:
        result = await client.call_tool("probe_bound", {})
    assert structured(result) == {"ok": True}


@pytest.mark.mcp_real_sessions
@pytest.mark.parametrize(
    ("last_used", "max_checkouts"),
    [("now()", 1), (None, 2)],
    ids=["touch-noop", "touch-writes"],
)
async def test_one_read_call_runs_on_one_session(
    _engine: AsyncEngine,
    mcp_http_client: AsyncClient,
    spy_tool: list[str],
    monkeypatch: pytest.MonkeyPatch,
    last_used: str | None,
    max_checkouts: int,
) -> None:
    pat = await _real_pat(_engine, last_used=last_used)
    real_factory = mcp_session.session_factory
    sessions: list[AsyncSession] = []

    def counting_factory() -> AsyncSession:
        db = real_factory()
        sessions.append(db)
        return db

    monkeypatch.setattr(mcp_session, "session_factory", counting_factory)
    checkouts: list[object] = []

    def on_checkout(*_args: object) -> None:
        checkouts.append(object())

    event.listen(_engine.sync_engine, "checkout", on_checkout)
    try:
        r = await rpc(mcp_http_client, "tools/call", {"name": "probe_spy"}, headers=pat.headers)
    finally:
        event.remove(_engine.sync_engine, "checkout", on_checkout)
        await _delete_pat(_engine, pat)

    assert r.status_code == 200
    assert spy_tool == ["called"]
    assert len(sessions) == 1
    assert 1 <= len(checkouts) <= max_checkouts


async def test_audited_refusal_keeps_the_last_used_touch(
    mcp_http_client: AsyncClient, db_session: AsyncSession, pat_primary_rw: SeededPat
) -> None:
    project_id, template_id, _schema = await fresh_charms(db_session)
    token_id = str(pat_primary_rw.principal.token_id)

    r = await rpc(
        mcp_http_client,
        "tools/call",
        {
            "name": "edit_template_draft",
            "arguments": {
                "project_id": str(project_id),
                "template_id": str(template_id),
                "ops": [],
            },
        },
        headers=pat_primary_rw.headers,
    )

    assert r.status_code == 200
    assert r.json()["result"]["structuredContent"]["code"] == "INVALID_ARGUMENT"
    refused = (
        await db_session.execute(
            text(
                "SELECT count(*) FROM public.agent_actions "
                "WHERE outcome = 'refused' AND token_id = :t"
            ),
            {"t": token_id},
        )
    ).scalar_one()
    assert refused == 1
    touched = (
        await db_session.execute(
            text("SELECT last_used_at FROM public.personal_access_tokens WHERE id = :id"),
            {"id": token_id},
        )
    ).scalar_one()
    assert touched is not None


@pytest.mark.mcp_real_sessions
@pytest.mark.usefixtures("spy_tool")
async def test_revoke_completes_while_a_call_is_in_flight(
    _engine: AsyncEngine, mcp_http_client: AsyncClient
) -> None:
    pat = await _real_pat(_engine, last_used=None)  # the touch writes: a lock it must not keep
    _IN_FLIGHT["entered"] = asyncio.Event()
    _IN_FLIGHT["release"] = asyncio.Event()
    call = asyncio.create_task(
        rpc(mcp_http_client, "tools/call", {"name": "probe_wait"}, headers=pat.headers)
    )
    try:
        await asyncio.wait_for(_IN_FLIGHT["entered"].wait(), 5)
        async with async_sessionmaker(_engine, expire_on_commit=False)() as db:
            revoked = await asyncio.wait_for(
                revoke_token(db, user_id=SEED.outsider_profile, token_id=pat.principal.token_id),
                2,
            )
            await db.commit()
        assert revoked.status == "revoked"
    finally:
        _IN_FLIGHT["release"].set()
        r = await call
        await _delete_pat(_engine, pat)
    assert r.status_code == 200


@pytest.mark.usefixtures("spy_tool")
async def test_unexpected_exception_rolls_back_the_partial_write(
    mcp_client: Any, pat_primary_read: SeededPat
) -> None:
    project = {"project_id": str(SEED.primary_project)}
    async with mcp_client(pat_primary_read) as client:  # one request session for both calls
        boom = await client.call_tool("probe_write_then_boom", project)
        after = await client.call_tool("probe_project_name", project)

    assert error_payload(boom)["code"] == "INTERNAL_ERROR"
    assert structured(after)["name"] != _PROBE_NAME


@pytest.mark.usefixtures("spy_tool")
async def test_not_found_after_a_flushed_write_leaves_the_draft_unchanged(
    mcp_client: Any,
    pat_primary_rw: SeededPat,
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    project_id, template_id, schema = await fresh_charms(db_session)
    section_id = next(et for et in schema["entity_types"] if et.get("fields"))["id"]

    async def _gone(*_args: object, **_kwargs: object) -> None:
        raise ProjectTemplateNotFoundError

    monkeypatch.setattr(template_draft_tool, "get_template_config_diff", _gone)
    op = {"op": "add_question", "section_id": section_id, "label": "Never saved", "type": "text"}

    async with mcp_client(pat_primary_rw) as client:  # one request session for all calls
        before = structured(
            await client.call_tool("probe_draft", {"template_id": str(template_id)})
        )
        result = await client.call_tool(
            "edit_template_draft",
            {"project_id": str(project_id), "template_id": str(template_id), "ops": [op]},
        )
        after = structured(await client.call_tool("probe_draft", {"template_id": str(template_id)}))

    assert error_payload(result)["code"] == "NOT_FOUND"
    assert "Never saved" not in after["labels"]
    assert after == before
