"""PAT bearer auth on /mcp (spec §3, §7, §8)."""

from __future__ import annotations

import pytest
from httpx import AsyncClient
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.mcp import asgi_auth
from app.services.pat_service import PAT_PREFIX, revoke_token
from tests.integration.conftest import SEED
from tests.integration.mcp.conftest import SeededPat
from tests.integration.mcp.rpc import rpc


@pytest.mark.parametrize(
    "headers",
    [
        {},
        {"Authorization": "Bearer abc"},
        {"Authorization": f"Bearer {PAT_PREFIX}" + "a" * 43},
    ],
    ids=["no-header", "malformed", "well-formed-unknown"],
)
async def test_missing_or_bad_bearer_is_401(
    mcp_http_client: AsyncClient, headers: dict[str, str]
) -> None:
    r = await rpc(mcp_http_client, "tools/list", headers=headers)
    assert r.status_code == 401
    assert r.headers["www-authenticate"] == "Bearer"
    assert "resource_metadata" not in r.headers.get("www-authenticate", "")


async def test_expired_token_is_401(
    mcp_http_client: AsyncClient, db_session: AsyncSession, pat_primary_read: SeededPat
) -> None:
    await db_session.execute(
        text(
            "UPDATE public.personal_access_tokens "
            "SET created_at = now() - interval '2 days', expires_at = now() - interval '1 day' "
            "WHERE id = :id"
        ),
        {"id": str(pat_primary_read.principal.token_id)},
    )
    r = await rpc(mcp_http_client, "tools/list", headers=pat_primary_read.headers)
    assert r.status_code == 401
    assert r.headers["www-authenticate"] == "Bearer"


async def test_revoked_token_is_401(
    mcp_http_client: AsyncClient, db_session: AsyncSession, pat_primary_read: SeededPat
) -> None:
    await revoke_token(
        db_session, user_id=SEED.primary_profile, token_id=pat_primary_read.principal.token_id
    )
    r = await rpc(mcp_http_client, "tools/list", headers=pat_primary_read.headers)
    assert r.status_code == 401
    assert r.headers["www-authenticate"] == "Bearer"


async def test_revoke_between_calls(
    mcp_http_client: AsyncClient, db_session: AsyncSession, pat_primary_read: SeededPat
) -> None:
    r = await rpc(mcp_http_client, "tools/list", headers=pat_primary_read.headers)
    assert r.status_code == 200

    await revoke_token(
        db_session, user_id=SEED.primary_profile, token_id=pat_primary_read.principal.token_id
    )

    r = await rpc(mcp_http_client, "tools/list", headers=pat_primary_read.headers)
    assert r.status_code == 401


async def test_last_used_at_throttled_to_five_minutes(
    mcp_http_client: AsyncClient, db_session: AsyncSession, pat_primary_read: SeededPat
) -> None:
    token_id = str(pat_primary_read.principal.token_id)

    await rpc(mcp_http_client, "tools/list", headers=pat_primary_read.headers)
    is_now = (
        await db_session.execute(
            text("SELECT last_used_at = now() FROM public.personal_access_tokens WHERE id = :id"),
            {"id": token_id},
        )
    ).scalar_one()
    assert is_now is True

    await db_session.execute(
        text(
            "UPDATE public.personal_access_tokens "
            "SET last_used_at = now() - interval '2 minutes' WHERE id = :id"
        ),
        {"id": token_id},
    )
    before = (
        await db_session.execute(
            text("SELECT last_used_at FROM public.personal_access_tokens WHERE id = :id"),
            {"id": token_id},
        )
    ).scalar_one()
    await rpc(mcp_http_client, "tools/list", headers=pat_primary_read.headers)
    after = (
        await db_session.execute(
            text("SELECT last_used_at FROM public.personal_access_tokens WHERE id = :id"),
            {"id": token_id},
        )
    ).scalar_one()
    assert after == before

    await db_session.execute(
        text(
            "UPDATE public.personal_access_tokens "
            "SET last_used_at = now() - interval '6 minutes' WHERE id = :id"
        ),
        {"id": token_id},
    )
    await rpc(mcp_http_client, "tools/list", headers=pat_primary_read.headers)
    is_now_again = (
        await db_session.execute(
            text("SELECT last_used_at = now() FROM public.personal_access_tokens WHERE id = :id"),
            {"id": token_id},
        )
    ).scalar_one()
    assert is_now_again is True


async def test_last_used_failure_does_not_block_auth(
    mcp_http_client: AsyncClient,
    pat_primary_read: SeededPat,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def _raise(*args: object, **kwargs: object) -> bool:
        raise RuntimeError("boom")

    monkeypatch.setattr(asgi_auth, "touch_last_used", _raise)

    r = await rpc(mcp_http_client, "tools/list", headers=pat_primary_read.headers)
    assert r.status_code == 200


async def test_mcp401_bucket_spares_valid_tokens(
    mcp_http_client: AsyncClient, pat_primary_read: SeededPat
) -> None:
    statuses = []
    for _ in range(30):
        r = await rpc(mcp_http_client, "tools/list", headers={"Authorization": "Bearer bogus"})
        statuses.append(r.status_code)
    assert statuses == [401] * 30

    r31 = await rpc(mcp_http_client, "tools/list", headers={"Authorization": "Bearer bogus"})
    assert r31.status_code == 429

    r_valid = await rpc(mcp_http_client, "tools/list", headers=pat_primary_read.headers)
    assert r_valid.status_code == 200


async def test_principal_reaches_the_tool_over_http(
    mcp_http_client: AsyncClient,
    pat_reviewer_rw: SeededPat,
    probe_tools: None,
) -> None:
    r = await rpc(
        mcp_http_client,
        "tools/call",
        {"name": "probe_whoami", "arguments": {}},
        headers=pat_reviewer_rw.headers,
    )
    assert r.status_code == 200
    body = r.json()
    assert body["result"]["structuredContent"]["user_sub"] == str(SEED.reviewer_profile)
