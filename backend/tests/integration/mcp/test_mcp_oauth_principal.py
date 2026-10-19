"""An OAuth access token at /mcp (ADR 0022): it resolves to the same principal
shape as a PAT of the connection's scope; every refusal is a 401 that counts
against the per-IP bucket; REST refuses it."""

from __future__ import annotations

from typing import Any
from urllib.parse import parse_qs, urlsplit

import pytest
from httpx import AsyncClient
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.mcp_oauth_service import revoke_connection
from app.services.pat_service import hash_secret
from tests.integration.conftest import SEED
from tests.integration.mcp.conftest import expected_challenge, seed_oauth_principal
from tests.integration.mcp.oauth_flow import (
    OAuthTokens,
    authorize,
    connect,
    pkce_pair,
    refresh,
    registered_client_id,
    revoke,
)
from tests.integration.mcp.rpc import rpc

_UNKNOWN_OAT = "prumo_oat_" + "a" * 43


def _bearer(access: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {access}"}


async def _list_tools(client: AsyncClient, access: str) -> Any:
    return await rpc(client, "tools/list", headers=_bearer(access))


def _assert_rejected(r: Any) -> None:
    assert r.status_code == 401
    assert r.headers["www-authenticate"] == expected_challenge("oauth_on", presented=True)


async def _exec(db: AsyncSession, sql: str, **params: object) -> None:
    await db.execute(text(sql), {k: str(v) for k, v in params.items()})


async def test_read_connection_hides_write_tools(
    oauth_http_client: AsyncClient, db_session: AsyncSession
) -> None:
    tokens = await connect(oauth_http_client, db_session, SEED.primary_profile, write=False)

    r = await _list_tools(oauth_http_client, tokens.access)

    assert r.status_code == 200, r.text
    names = {t["name"] for t in r.json()["result"]["tools"]}
    assert "list_projects" in names
    assert "update_project_details" not in names


async def test_read_write_manager_applies_update_project_details(
    oauth_http_client: AsyncClient, db_session: AsyncSession
) -> None:
    tokens = await connect(oauth_http_client, db_session, SEED.primary_profile, write=True)
    current = (
        await db_session.execute(
            text("SELECT description FROM public.projects WHERE id = :id"),
            {"id": str(SEED.primary_project)},
        )
    ).scalar_one()

    r = await rpc(
        oauth_http_client,
        "tools/call",
        {
            "name": "update_project_details",
            "arguments": {
                "project_id": str(SEED.primary_project),
                "fields": {"description": "New"},
                "expected": {"description": current},
            },
        },
        headers=_bearer(tokens.access),
    )

    assert r.status_code == 200, r.text
    result = r.json()["result"]
    assert result.get("isError") is not True, result
    assert result["structuredContent"]["after"] == {"description": "New"}
    token_id = (
        await db_session.execute(
            text(
                "SELECT token_id FROM public.agent_actions "
                "WHERE tool = 'update_project_details' ORDER BY created_at DESC LIMIT 1"
            )
        )
    ).scalar_one()
    assert token_id == tokens.connection_id


async def test_after_revoke_401(oauth_http_client: AsyncClient, db_session: AsyncSession) -> None:
    tokens = await connect(oauth_http_client, db_session, SEED.primary_profile)
    assert (await _list_tools(oauth_http_client, tokens.access)).status_code == 200

    assert (await revoke(oauth_http_client, tokens.client_id, tokens.access)).status_code == 200

    _assert_rejected(await _list_tools(oauth_http_client, tokens.access))


async def test_expired_access_token_401_then_refresh_works(
    oauth_http_client: AsyncClient, db_session: AsyncSession
) -> None:
    tokens = await connect(oauth_http_client, db_session, SEED.primary_profile)
    await _exec(
        db_session,
        "UPDATE public.mcp_oauth_tokens SET expires_at = now() - interval '1 second' "
        "WHERE token_hash = :h",
        h=hash_secret(tokens.access),
    )

    _assert_rejected(await _list_tools(oauth_http_client, tokens.access))

    r = await refresh(oauth_http_client, tokens.client_id, tokens.refresh)
    assert r.status_code == 200, r.text
    assert (await _list_tools(oauth_http_client, r.json()["access_token"])).status_code == 200


async def test_refresh_token_as_bearer_is_401(
    oauth_http_client: AsyncClient, db_session: AsyncSession
) -> None:
    tokens = await connect(oauth_http_client, db_session, SEED.primary_profile)
    assert (await _list_tools(oauth_http_client, tokens.access)).status_code == 200

    _assert_rejected(await _list_tools(oauth_http_client, tokens.refresh))


async def test_resource_mismatch_is_401(
    oauth_http_client: AsyncClient, db_session: AsyncSession
) -> None:
    tokens = await connect(oauth_http_client, db_session, SEED.primary_profile)
    await _exec(
        db_session,
        "UPDATE public.mcp_oauth_tokens SET resource = 'https://other.example/mcp' "
        "WHERE token_hash = :h",
        h=hash_secret(tokens.access),
    )

    _assert_rejected(await _list_tools(oauth_http_client, tokens.access))


async def test_expired_connection_is_401(
    oauth_http_client: AsyncClient, db_session: AsyncSession
) -> None:
    tokens = await connect(oauth_http_client, db_session, SEED.primary_profile)
    await _exec(
        db_session,
        "UPDATE public.personal_access_tokens "
        "SET created_at = now() - interval '2 days', expires_at = now() - interval '1 day' "
        "WHERE id = :id",
        id=tokens.connection_id,
    )

    _assert_rejected(await _list_tools(oauth_http_client, tokens.access))


async def test_banned_user_is_401(oauth_http_client: AsyncClient, db_session: AsyncSession) -> None:
    tokens = await connect(oauth_http_client, db_session, SEED.reviewer_profile)
    assert (await _list_tools(oauth_http_client, tokens.access)).status_code == 200

    await _exec(
        db_session,
        "UPDATE auth.users SET banned_until = now() + interval '1 day' WHERE id = :id",
        id=SEED.reviewer_profile,
    )

    _assert_rejected(await _list_tools(oauth_http_client, tokens.access))


async def test_last_used_stamps_the_connection(
    oauth_http_client: AsyncClient, db_session: AsyncSession
) -> None:
    tokens: OAuthTokens = await connect(oauth_http_client, db_session, SEED.primary_profile)

    assert (await _list_tools(oauth_http_client, tokens.access)).status_code == 200

    is_now = (
        await db_session.execute(
            text("SELECT last_used_at = now() FROM public.personal_access_tokens WHERE id = :id"),
            {"id": str(tokens.connection_id)},
        )
    ).scalar_one()
    assert is_now is True


async def test_oauth_token_on_rest_is_401(
    oauth_http_client: AsyncClient, db_session: AsyncSession
) -> None:
    tokens = await connect(oauth_http_client, db_session, SEED.primary_profile)
    assert (await _list_tools(oauth_http_client, tokens.access)).status_code == 200

    r = await oauth_http_client.get("/api/v1/me/tokens", headers=_bearer(tokens.access))

    assert r.status_code == 401


async def test_failed_oauth_lookups_count_in_mcp401_bucket(
    oauth_http_client: AsyncClient,
) -> None:
    statuses = [(await _list_tools(oauth_http_client, _UNKNOWN_OAT)).status_code for _ in range(30)]
    assert statuses == [401] * 30

    assert (await _list_tools(oauth_http_client, _UNKNOWN_OAT)).status_code == 429


async def test_ai_run_scope_never_reachable(oauth_http_client: AsyncClient) -> None:
    client_id = await registered_client_id(oauth_http_client, scope="read write")
    _, challenge = pkce_pair()

    r = await authorize(oauth_http_client, client_id, challenge=challenge, scope="ai_run")

    location = r.headers.get("location", "")
    assert "/oauth/consent" not in location
    assert parse_qs(urlsplit(location).query)["error"] == ["invalid_scope"]


async def test_revoke_connection_ends_mcp_and_refresh(
    oauth_http_client: AsyncClient, db_session: AsyncSession
) -> None:
    """The service behind DELETE /api/v1/me/oauth-connections/{id} ends the
    connection everywhere: its access token at /mcp and its refresh token."""
    tokens = await connect(oauth_http_client, db_session, SEED.primary_profile)
    assert (await _list_tools(oauth_http_client, tokens.access)).status_code == 200

    await revoke_connection(
        db_session, user_id=SEED.primary_profile, connection_id=tokens.connection_id
    )

    _assert_rejected(await _list_tools(oauth_http_client, tokens.access))
    r = await refresh(oauth_http_client, tokens.client_id, tokens.refresh)
    assert r.status_code == 400, r.text
    assert r.json()["error"] == "invalid_grant"


@pytest.mark.parametrize(
    ("ai_run", "expected"),
    [(False, {"read", "write"}), (True, {"read", "write", "ai_run"})],
    ids=["no-grant", "ai_run"],
)
async def test_connection_scope_set_carries_the_ai_run_grant(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
    ai_run: bool,
    expected: set[str],
) -> None:
    seeded = await seed_oauth_principal(
        db_session, monkeypatch, SEED.primary_profile, "read_write", ai_run=ai_run
    )

    assert seeded.principal.scopes == frozenset(expected)
