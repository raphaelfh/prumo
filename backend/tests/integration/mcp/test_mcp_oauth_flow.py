"""Dynamic client registration and the authorization request over HTTP
(ADR 0022): public clients only, the redirect allow-list, scope handling, the
pending consent request, and the per-client / per-IP rate limits."""

from __future__ import annotations

from urllib.parse import parse_qs, urlsplit
from uuid import UUID, uuid4

import pytest
from httpx import AsyncClient, Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.mcp_oauth import McpOAuthClient, McpOAuthRequest
from tests.integration.mcp.oauth_flow import (
    CLAUDE_CB,
    MCP_URL,
    authorize,
    consent_request_id,
    pkce_pair,
    register,
    registered_client_id,
)


def _consent_prefix() -> str:
    return settings.PUBLIC_APP_URL.rstrip("/") + "/oauth/consent?request="


def _is_consent(r: Response) -> bool:
    return r.status_code == 302 and r.headers["location"].startswith(_consent_prefix())


async def _stored_client(db: AsyncSession, client_id: str) -> McpOAuthClient | None:
    return await db.scalar(
        select(McpOAuthClient).where(McpOAuthClient.client_id == UUID(client_id))
    )


async def _request_count(db: AsyncSession, client_id: str) -> int:
    rows = await db.scalars(
        select(McpOAuthRequest.id).where(McpOAuthRequest.client_id == UUID(client_id))
    )
    return len(rows.all())


# --------------------------------------------------------------------------- register


async def test_register_claude_callback_is_a_public_client(
    oauth_http_client: AsyncClient, db_session: AsyncSession
) -> None:
    r = await register(oauth_http_client)
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["token_endpoint_auth_method"] == "none"
    assert "client_secret" not in body
    stored = await _stored_client(db_session, body["client_id"])
    assert stored is not None
    assert stored.scope == "read write"
    assert stored.redirect_uris == [CLAUDE_CB]


@pytest.mark.parametrize(
    "uri",
    ["http://127.0.0.1:53682/callback", "http://localhost:1/cb", "http://[::1]:8080/cb"],
    ids=["ipv4", "localhost", "ipv6"],
)
async def test_register_loopback_redirect(oauth_http_client: AsyncClient, uri: str) -> None:
    r = await register(oauth_http_client, redirect_uris=(uri,))
    assert r.status_code == 201, r.text


async def test_register_accepts_application_type(oauth_http_client: AsyncClient) -> None:
    r = await register(oauth_http_client, application_type="web")
    assert r.status_code == 201, r.text


async def test_register_accepts_offline_access(oauth_http_client: AsyncClient) -> None:
    r = await register(oauth_http_client, scope="read write offline_access")
    assert r.status_code == 201, r.text


async def test_register_refuses_a_confidential_client(
    oauth_http_client: AsyncClient, db_session: AsyncSession
) -> None:
    before = len((await db_session.scalars(select(McpOAuthClient.client_id))).all())
    r = await register(oauth_http_client, token_endpoint_auth_method="client_secret_post")
    assert r.status_code == 400
    assert r.json()["error"] == "invalid_client_metadata"
    after = len((await db_session.scalars(select(McpOAuthClient.client_id))).all())
    assert after == before


async def test_register_refuses_an_unknown_scope(oauth_http_client: AsyncClient) -> None:
    r = await register(oauth_http_client, scope="read ai_run")
    assert r.status_code == 400
    assert r.json()["error"] == "invalid_client_metadata"


async def test_register_refuses_six_redirect_uris(oauth_http_client: AsyncClient) -> None:
    uris = tuple(f"http://localhost:{port}/cb" for port in range(1, 7))
    r = await register(oauth_http_client, redirect_uris=uris)
    assert r.status_code == 400
    assert r.json()["error"] == "invalid_client_metadata"


async def test_register_refuses_a_foreign_redirect(oauth_http_client: AsyncClient) -> None:
    r = await register(oauth_http_client, redirect_uris=("https://evil.example/cb",))
    assert r.status_code == 400
    assert r.json()["error"] == "invalid_client_metadata"


async def test_register_caps_the_client_name(
    oauth_http_client: AsyncClient, db_session: AsyncSession
) -> None:
    client_id = await registered_client_id(oauth_http_client, client_name="n" * 200)
    stored = await _stored_client(db_session, client_id)
    assert stored is not None
    assert stored.client_name == "n" * 80


async def test_register_without_a_name(
    oauth_http_client: AsyncClient, db_session: AsyncSession
) -> None:
    client_id = await registered_client_id(oauth_http_client)
    stored = await _stored_client(db_session, client_id)
    assert stored is not None
    assert stored.client_name == "MCP client"


# --------------------------------------------------------------------------- authorize


async def test_authorize_redirects_to_consent(
    oauth_http_client: AsyncClient, db_session: AsyncSession
) -> None:
    client_id = await registered_client_id(oauth_http_client)
    _, challenge = pkce_pair()
    r = await authorize(oauth_http_client, client_id, challenge=challenge, scope="read write")
    assert _is_consent(r), r.headers.get("location")
    stored = await db_session.get(McpOAuthRequest, consent_request_id(r))
    assert stored is not None
    assert stored.requested_scopes == ["read", "write"]
    assert stored.resource == MCP_URL
    assert stored.code_challenge == challenge
    assert stored.state == "st"
    assert stored.redirect_uri == CLAUDE_CB


async def test_authorize_without_scope_takes_the_registered_scopes(
    oauth_http_client: AsyncClient, db_session: AsyncSession
) -> None:
    client_id = await registered_client_id(oauth_http_client)
    _, challenge = pkce_pair()
    r = await authorize(oauth_http_client, client_id, challenge=challenge)
    assert _is_consent(r)
    stored = await db_session.get(McpOAuthRequest, consent_request_id(r))
    assert stored is not None
    assert stored.requested_scopes == ["read", "write"]


@pytest.mark.parametrize(
    ("method", "with_challenge"), [("plain", True), ("S256", False)], ids=["plain", "no-challenge"]
)
async def test_authorize_requires_s256(
    oauth_http_client: AsyncClient, method: str, with_challenge: bool
) -> None:
    client_id = await registered_client_id(oauth_http_client)
    _, challenge = pkce_pair()
    r = await authorize(
        oauth_http_client,
        client_id,
        challenge=challenge if with_challenge else None,
        method=method,
    )
    assert not _is_consent(r)
    assert r.status_code in (302, 400)


async def test_authorize_refuses_a_foreign_resource(
    oauth_http_client: AsyncClient, db_session: AsyncSession
) -> None:
    client_id = await registered_client_id(oauth_http_client)
    _, challenge = pkce_pair()
    r = await authorize(
        oauth_http_client, client_id, challenge=challenge, resource="https://other.example/mcp"
    )
    assert r.status_code == 302
    location = r.headers["location"]
    assert location.startswith(CLAUDE_CB)
    assert parse_qs(urlsplit(location).query)["error"] == ["invalid_target"]
    assert await _request_count(db_session, client_id) == 0


async def test_authorize_accepts_a_trailing_slash_resource(
    oauth_http_client: AsyncClient,
) -> None:
    client_id = await registered_client_id(oauth_http_client)
    _, challenge = pkce_pair()
    r = await authorize(oauth_http_client, client_id, challenge=challenge, resource=MCP_URL + "/")
    assert _is_consent(r)


async def test_authorize_unknown_client_is_400_without_redirect(
    oauth_http_client: AsyncClient,
) -> None:
    _, challenge = pkce_pair()
    r = await authorize(oauth_http_client, str(uuid4()), challenge=challenge)
    assert r.status_code == 400
    assert "location" not in r.headers


async def test_authorize_unregistered_redirect_is_400_without_redirect(
    oauth_http_client: AsyncClient,
) -> None:
    client_id = await registered_client_id(oauth_http_client)
    _, challenge = pkce_pair()
    r = await authorize(
        oauth_http_client, client_id, challenge=challenge, redirect_uri="http://localhost:9/cb"
    )
    assert r.status_code == 400
    assert "location" not in r.headers


async def test_authorize_scope_beyond_registration_is_invalid_scope(
    oauth_http_client: AsyncClient,
) -> None:
    client_id = await registered_client_id(oauth_http_client, scope="read")
    _, challenge = pkce_pair()
    r = await authorize(oauth_http_client, client_id, challenge=challenge, scope="read write")
    assert not _is_consent(r)
    assert parse_qs(urlsplit(r.headers["location"]).query)["error"] == ["invalid_scope"]


async def test_authorize_drops_offline_access(
    oauth_http_client: AsyncClient, db_session: AsyncSession
) -> None:
    client_id = await registered_client_id(oauth_http_client, scope="read write offline_access")
    _, challenge = pkce_pair()
    r = await authorize(
        oauth_http_client, client_id, challenge=challenge, scope="read write offline_access"
    )
    assert _is_consent(r)
    stored = await db_session.get(McpOAuthRequest, consent_request_id(r))
    assert stored is not None
    assert stored.requested_scopes == ["read", "write"]


# --------------------------------------------------------------------------- limits


async def test_register_over_the_ip_limit_is_429(oauth_http_client: AsyncClient) -> None:
    statuses = [(await register(oauth_http_client)).status_code for _ in range(10)]
    assert statuses == [201] * 10

    r = await register(oauth_http_client)
    assert r.status_code == 429
    assert int(r.headers["retry-after"]) >= 1


async def test_authorize_over_the_client_limit_is_429(oauth_http_client: AsyncClient) -> None:
    client_id = await registered_client_id(oauth_http_client)
    other_id = await registered_client_id(oauth_http_client)
    _, challenge = pkce_pair()
    statuses = [
        (await authorize(oauth_http_client, client_id, challenge=challenge)).status_code
        for _ in range(30)
    ]
    assert statuses == [302] * 30

    r = await authorize(oauth_http_client, client_id, challenge=challenge)
    assert r.status_code == 429
    assert int(r.headers["retry-after"]) >= 1

    r = await authorize(oauth_http_client, other_id, challenge=challenge)
    assert r.status_code == 302


async def test_authorize_without_client_id_is_limited_per_ip(
    oauth_http_client: AsyncClient,
) -> None:
    _, challenge = pkce_pair()
    statuses = [
        (await authorize(oauth_http_client, None, challenge=challenge)).status_code
        for _ in range(31)
    ]
    assert 429 not in statuses[:30]
    assert statuses[30] == 429
