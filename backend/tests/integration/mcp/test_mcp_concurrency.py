"""Overload at /mcp answers a typed 429/503, never a 500 (spec §3, §7).

A small real pool (2 connections, no overflow, 0.5 s checkout timeout) and the
per-token in-flight cap face 50 concurrent ``get_project`` calls on one token.
Every call either succeeds or is refused with ``Retry-After``; a successful
read call checks out exactly one connection (its touch is a throttled no-op).
A token's first call in five minutes commits its touch, which returns the
connection: if the pool is exhausted when the tool checks one out again, the
call still answers 503 with ``Retry-After``.
"""

import asyncio
from typing import Any

import pytest
from httpx import AsyncClient
from sqlalchemy import event, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.exc import TimeoutError as PoolTimeoutError
from sqlalchemy.ext.asyncio import AsyncEngine, async_sessionmaker, create_async_engine

from app.api.mcp import server
from app.api.mcp import session as mcp_session
from app.core.config import settings
from app.schemas.personal_access_token import PersonalAccessTokenCreateRequest
from app.services.pat_service import create_token
from tests.integration.conftest import SEED
from tests.integration.mcp.conftest import SeededPat
from tests.integration.mcp.rpc import rpc
from tests.integration.mcp.tool_calls import call_tool, error_payload

CALLS = 50


async def _committed_pat(engine: AsyncEngine, *, touched: bool = True) -> tuple[str, str]:
    """A committed read PAT for the project owner; ``touched`` stamps it just
    now so every request's last-used touch is a throttled no-op."""
    async with async_sessionmaker(engine, expire_on_commit=False)() as db:
        created = await create_token(
            db,
            user_id=SEED.primary_profile,
            payload=PersonalAccessTokenCreateRequest(
                name="concurrency", scope="read", expires_in_days=30
            ),
        )
        if touched:
            await db.execute(
                text(
                    "UPDATE public.personal_access_tokens SET last_used_at = now() WHERE id = :id"
                ),
                {"id": str(created.token.id)},
            )
        await db.commit()
    return created.secret, str(created.token.id)


async def _delete_pat(engine: AsyncEngine, token_id: str) -> None:
    async with async_sessionmaker(engine)() as db:
        await db.execute(
            text("DELETE FROM public.agent_actions WHERE token_id = :id"), {"id": token_id}
        )
        await db.execute(
            text("DELETE FROM public.personal_access_tokens WHERE id = :id"), {"id": token_id}
        )
        await db.commit()


@pytest.mark.mcp_real_sessions
async def test_concurrent_calls_get_a_result_or_a_typed_refusal(
    _engine: AsyncEngine, mcp_http_client: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(settings, "MCP_MAX_INFLIGHT_PER_TOKEN", 4)
    small = create_async_engine(
        settings.async_database_url, pool_size=2, max_overflow=0, pool_timeout=0.5
    )
    monkeypatch.setattr(
        mcp_session,
        "session_factory",
        async_sessionmaker(small, expire_on_commit=False, autoflush=False),
    )
    checkouts: list[object] = []

    def on_checkout(*_args: object) -> None:
        checkouts.append(object())

    event.listen(small.sync_engine, "checkout", on_checkout)
    secret, token_id = await _committed_pat(_engine)
    try:
        responses = await asyncio.gather(
            *(
                rpc(
                    mcp_http_client,
                    "tools/call",
                    {"name": "get_project", "arguments": {"project_id": str(SEED.primary_project)}},
                    headers={"Authorization": f"Bearer {secret}"},
                )
                for _ in range(CALLS)
            )
        )
    finally:
        event.remove(small.sync_engine, "checkout", on_checkout)
        await small.dispose()
        await _delete_pat(_engine, token_id)

    statuses = [r.status_code for r in responses]
    assert 500 not in statuses
    assert 429 in statuses  # 50 simultaneous calls on one token exceed its in-flight cap
    ok = [r for r in responses if r.status_code == 200]
    assert ok, statuses
    for r in ok:
        result = r.json()["result"]
        assert result["isError"] is False, result
        assert result["structuredContent"]["project_id"] == str(SEED.primary_project)
    refused = [r for r in responses if r.status_code != 200]
    for r in refused:
        assert r.status_code in (429, 503), r.status_code
        assert r.headers.get("retry-after"), r.status_code
    assert len(checkouts) == len(ok)


@pytest.mark.mcp_real_sessions
async def test_pool_exhausted_after_the_touch_commit_is_503(
    _engine: AsyncEngine, mcp_http_client: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    small = create_async_engine(
        settings.async_database_url, pool_size=1, max_overflow=0, pool_timeout=0.3
    )
    monkeypatch.setattr(
        mcp_session,
        "session_factory",
        async_sessionmaker(small, expire_on_commit=False, autoflush=False),
    )
    real_is_member = server.is_project_member
    held: list[object] = []

    async def member_after_the_pool_is_taken(*args: object, **kwargs: object) -> bool:
        # The touch committed and returned the one connection; another holder
        # takes it before the tool's first query checks out again.
        held.append(await small.connect())
        return await real_is_member(*args, **kwargs)  # type: ignore[arg-type]

    monkeypatch.setattr(server, "is_project_member", member_after_the_pool_is_taken)
    secret, token_id = await _committed_pat(_engine, touched=False)
    try:
        r = await rpc(
            mcp_http_client,
            "tools/call",
            {"name": "get_project", "arguments": {"project_id": str(SEED.primary_project)}},
            headers={"Authorization": f"Bearer {secret}"},
        )
    finally:
        for conn in held:
            await conn.close()  # type: ignore[attr-defined]
        await small.dispose()
        await _delete_pat(_engine, token_id)

    assert held, "the tool phase never ran"
    assert r.status_code == 503, r.text
    assert r.headers["retry-after"] == "2"


@pytest.mark.parametrize(
    ("exc", "code"),
    [
        (PoolTimeoutError(), "RATE_LIMITED"),
        (IntegrityError("x", {}, Exception()), "INTERNAL_ERROR"),
    ],
    ids=["pool-timeout-is-retryable", "a-query-bug-stays-internal"],
)
async def test_in_process_dispatch_maps_only_unavailability_to_a_retry(
    mcp_client: Any,
    pat_primary_read: SeededPat,
    monkeypatch: pytest.MonkeyPatch,
    exc: Exception,
    code: str,
) -> None:
    async def raising(*_args: object, **_kwargs: object) -> bool:
        raise exc

    monkeypatch.setattr(server, "is_project_member", raising)
    body = error_payload(
        await call_tool(
            mcp_client, pat_primary_read, "get_project", {"project_id": str(SEED.primary_project)}
        )
    )

    assert body["code"] == code
    if code == "RATE_LIMITED":
        assert body["retryable"] is True
        assert body["retry_after_seconds"] == 2
