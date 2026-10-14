"""Overload at /mcp answers a typed 429/503, never a 500 (spec §3, §7).

A small real pool (2 connections, no overflow, 0.5 s checkout timeout) and the
per-token in-flight cap face 50 concurrent ``get_project`` calls on one token.
Every call either succeeds or is refused with ``Retry-After``; a successful
read call checks out exactly one connection (its touch is a throttled no-op).
"""

import asyncio

import pytest
from httpx import AsyncClient
from sqlalchemy import event, text
from sqlalchemy.ext.asyncio import AsyncEngine, async_sessionmaker, create_async_engine

from app.api.mcp import session as mcp_session
from app.core.config import settings
from app.schemas.personal_access_token import PersonalAccessTokenCreateRequest
from app.services.pat_service import create_token
from tests.integration.conftest import SEED
from tests.integration.mcp.rpc import rpc

CALLS = 50


async def _committed_pat(engine: AsyncEngine) -> tuple[str, str]:
    """A committed read PAT for the project owner, touched just now so every
    request's last-used touch is a throttled no-op."""
    async with async_sessionmaker(engine, expire_on_commit=False)() as db:
        created = await create_token(
            db,
            user_id=SEED.primary_profile,
            payload=PersonalAccessTokenCreateRequest(
                name="concurrency", scope="read", expires_in_days=30
            ),
        )
        await db.execute(
            text("UPDATE public.personal_access_tokens SET last_used_at = now() WHERE id = :id"),
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
    monkeypatch.setattr(settings, "MCP_MAX_INFLIGHT_PER_TOKEN", 8)
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
