"""The OAuth flow over HTTP (ADR 0022): dynamic client registration (public
clients only, the redirect allow-list), the authorization request and its
pending consent request, the code exchange, refresh rotation with reuse
detection, revocation, pruning, and the per-client / per-IP rate limits."""

from __future__ import annotations

from datetime import timedelta
from typing import Any
from urllib.parse import parse_qs, urlsplit
from uuid import UUID, uuid4

import pytest
from httpx import AsyncClient, Response
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.mcp_oauth import McpOAuthClient, McpOAuthRequest
from app.services.pat_service import hash_secret
from tests.integration.conftest import SEED
from tests.integration.helpers.pat_rows import (
    insert_oauth_client,
    insert_oauth_connection,
    insert_oauth_request,
)
from tests.integration.mcp.oauth_flow import (
    CLAUDE_CB,
    MCP_URL,
    OAuthTokens,
    approve,
    authorize,
    connect,
    consent_request_id,
    exchange,
    pkce_pair,
    refresh,
    register,
    registered_client_id,
    revoke,
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


@pytest.mark.parametrize(
    "raw",
    [b"[" * 100_000 + b"]" * 100_000, b'{"x": ' + b"[" * 100_000 + b"]" * 100_000 + b"}"],
    ids=["deep-array", "deep-in-object"],
)
async def test_register_refuses_a_deeply_nested_body(
    oauth_http_client: AsyncClient, raw: bytes
) -> None:
    r = await oauth_http_client.post(
        "/register", content=raw, headers={"content-type": "application/json"}
    )
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


async def test_authorize_post_is_limited_on_the_form_client_id(
    oauth_http_client: AsyncClient,
) -> None:
    """The SDK reads only the form on POST; a query-string client_id cannot
    move the call into another bucket."""
    client_id = await registered_client_id(oauth_http_client)
    _, challenge = pkce_pair()
    form = {
        "response_type": "code",
        "client_id": client_id,
        "code_challenge": challenge,
        "code_challenge_method": "S256",
        "redirect_uri": CLAUDE_CB,
        "resource": MCP_URL,
        "state": "st",
    }

    async def post() -> Response:
        return await oauth_http_client.post(
            "/authorize", params={"client_id": str(uuid4())}, data=form
        )

    statuses = [(await post()).status_code for _ in range(30)]
    assert statuses == [302] * 30

    r = await post()
    assert r.status_code == 429
    assert int(r.headers["retry-after"]) >= 1


# --------------------------------------------------------------------------- token: code


async def _sql(db: AsyncSession, sql: str, **params: Any) -> Any:
    return (await db.execute(text(sql), {k: str(v) for k, v in params.items()})).all()


async def _revoked(db: AsyncSession, connection_id: UUID) -> bool:
    rows = await _sql(
        db,
        "SELECT revoked_at IS NOT NULL FROM public.personal_access_tokens WHERE id = :id",
        id=connection_id,
    )
    return bool(rows[0][0])


async def _approved_code(
    client: AsyncClient,
    db: AsyncSession,
    *,
    write: bool = True,
    scope: str | None = None,
    register_scope: str | None = None,
) -> tuple[str, str, str, UUID]:
    """client_id, code, verifier and the decided request id."""
    extra = {} if register_scope is None else {"scope": register_scope}
    client_id = await registered_client_id(client, **extra)
    verifier, challenge = pkce_pair()
    r = await authorize(client, client_id, challenge=challenge, scope=scope)
    request_id = consent_request_id(r)
    code = await approve(db, request_id, SEED.primary_profile, write=write)
    return client_id, code, verifier, request_id


def _assert_invalid_grant(r: Response) -> None:
    assert r.status_code == 400, r.text
    assert r.json()["error"] == "invalid_grant"


@pytest.mark.parametrize(("write", "scope"), [(True, "read write"), (False, "read")])
async def test_exchange_returns_an_opaque_pair(
    oauth_http_client: AsyncClient, db_session: AsyncSession, write: bool, scope: str
) -> None:
    client_id, code, verifier, _ = await _approved_code(oauth_http_client, db_session, write=write)

    r = await exchange(oauth_http_client, client_id, code, verifier)

    assert r.status_code == 200, r.text
    body = r.json()
    assert body["access_token"].startswith("prumo_oat_")
    assert body["refresh_token"].startswith("prumo_ort_")
    assert body["token_type"] == "Bearer"
    assert body["expires_in"] == 3600
    assert body["scope"] == scope
    hashes = {
        row[0] for row in await _sql(db_session, "SELECT token_hash FROM public.mcp_oauth_tokens")
    }
    assert body["access_token"] not in hashes
    assert body["refresh_token"] not in hashes


async def test_exchange_never_echoes_offline_access(
    oauth_http_client: AsyncClient, db_session: AsyncSession
) -> None:
    scope = "read write offline_access"
    client_id, code, verifier, _ = await _approved_code(
        oauth_http_client, db_session, scope=scope, register_scope=scope
    )

    r = await exchange(oauth_http_client, client_id, code, verifier)

    assert r.status_code == 200, r.text
    assert r.json()["scope"] == "read write"
    assert r.json()["refresh_token"].startswith("prumo_ort_")


async def test_exchange_wrong_verifier_is_invalid_grant(
    oauth_http_client: AsyncClient, db_session: AsyncSession
) -> None:
    client_id, code, _, _ = await _approved_code(oauth_http_client, db_session)
    other_verifier, _ = pkce_pair()
    _assert_invalid_grant(await exchange(oauth_http_client, client_id, code, other_verifier))


async def test_exchange_expired_code_is_invalid_grant(
    oauth_http_client: AsyncClient, db_session: AsyncSession
) -> None:
    client_id, code, verifier, request_id = await _approved_code(oauth_http_client, db_session)
    await db_session.execute(
        text(
            "UPDATE public.mcp_oauth_requests "
            "SET code_expires_at = now() - interval '1 minute' WHERE id = :id"
        ),
        {"id": str(request_id)},
    )
    _assert_invalid_grant(await exchange(oauth_http_client, client_id, code, verifier))


async def test_exchange_with_another_redirect_uri_is_refused(
    oauth_http_client: AsyncClient, db_session: AsyncSession
) -> None:
    client_id, code, verifier, _ = await _approved_code(oauth_http_client, db_session)
    r = await exchange(
        oauth_http_client, client_id, code, verifier, redirect_uri="http://localhost:1/cb"
    )
    assert r.status_code == 400


async def test_exchange_by_another_client_is_refused(
    oauth_http_client: AsyncClient, db_session: AsyncSession
) -> None:
    _, code, verifier, _ = await _approved_code(oauth_http_client, db_session)
    other_id = await registered_client_id(oauth_http_client)
    _assert_invalid_grant(await exchange(oauth_http_client, other_id, code, verifier))


async def test_reused_code_revokes_the_connection(
    oauth_http_client: AsyncClient, db_session: AsyncSession
) -> None:
    client_id, code, verifier, request_id = await _approved_code(oauth_http_client, db_session)
    first = await exchange(oauth_http_client, client_id, code, verifier)
    assert first.status_code == 200, first.text

    _assert_invalid_grant(await exchange(oauth_http_client, client_id, code, verifier))

    request = await db_session.get(McpOAuthRequest, request_id, populate_existing=True)
    assert request is not None and request.connection_id is not None
    assert await _revoked(db_session, request.connection_id)
    _assert_invalid_grant(
        await refresh(oauth_http_client, client_id, first.json()["refresh_token"])
    )


# --------------------------------------------------------------------------- token: refresh


async def _rotated_at(db: AsyncSession, secret: str) -> object:
    rows = await _sql(
        db,
        "SELECT rotated_at FROM public.mcp_oauth_tokens WHERE token_hash = :h",
        h=hash_secret(secret),
    )
    return rows[0][0]


async def test_refresh_rotates_the_pair(
    oauth_http_client: AsyncClient, db_session: AsyncSession
) -> None:
    tokens = await connect(oauth_http_client, db_session, SEED.primary_profile)

    r = await refresh(oauth_http_client, tokens.client_id, tokens.refresh)

    assert r.status_code == 200, r.text
    body = r.json()
    assert body["access_token"].startswith("prumo_oat_")
    assert body["refresh_token"].startswith("prumo_ort_")
    assert body["access_token"] != tokens.access
    assert body["refresh_token"] != tokens.refresh
    assert body["scope"] == "read write"
    assert await _rotated_at(db_session, tokens.refresh) is not None
    assert await _rotated_at(db_session, body["refresh_token"]) is None


async def test_replayed_refresh_revokes_the_connection(
    oauth_http_client: AsyncClient, db_session: AsyncSession
) -> None:
    tokens = await connect(oauth_http_client, db_session, SEED.primary_profile)
    rotated = await refresh(oauth_http_client, tokens.client_id, tokens.refresh)
    assert rotated.status_code == 200, rotated.text

    _assert_invalid_grant(await refresh(oauth_http_client, tokens.client_id, tokens.refresh))

    assert await _revoked(db_session, tokens.connection_id)
    _assert_invalid_grant(
        await refresh(oauth_http_client, tokens.client_id, rotated.json()["refresh_token"])
    )


async def test_refresh_never_widens_a_read_connection(
    oauth_http_client: AsyncClient, db_session: AsyncSession
) -> None:
    tokens = await connect(oauth_http_client, db_session, SEED.primary_profile, write=False)
    r = await refresh(oauth_http_client, tokens.client_id, tokens.refresh, scope="read write")
    assert r.status_code == 400
    assert r.json()["error"] == "invalid_scope"


async def test_refresh_accepts_offline_access(
    oauth_http_client: AsyncClient, db_session: AsyncSession
) -> None:
    tokens = await connect(oauth_http_client, db_session, SEED.primary_profile)
    r = await refresh(
        oauth_http_client, tokens.client_id, tokens.refresh, scope="read write offline_access"
    )
    assert r.status_code == 200, r.text
    assert r.json()["scope"] == "read write"


async def test_refresh_after_the_connection_expires_is_invalid_grant(
    oauth_http_client: AsyncClient, db_session: AsyncSession
) -> None:
    tokens = await connect(oauth_http_client, db_session, SEED.primary_profile)
    await db_session.execute(
        text(
            "UPDATE public.personal_access_tokens SET created_at = now() - interval '100 days', "
            "expires_at = now() - interval '1 day' WHERE id = :id"
        ),
        {"id": str(tokens.connection_id)},
    )
    _assert_invalid_grant(await refresh(oauth_http_client, tokens.client_id, tokens.refresh))


async def test_refresh_after_revocation_is_invalid_grant(
    oauth_http_client: AsyncClient, db_session: AsyncSession
) -> None:
    tokens = await connect(oauth_http_client, db_session, SEED.primary_profile)
    await db_session.execute(
        text("UPDATE public.personal_access_tokens SET revoked_at = now() WHERE id = :id"),
        {"id": str(tokens.connection_id)},
    )
    _assert_invalid_grant(await refresh(oauth_http_client, tokens.client_id, tokens.refresh))


# --------------------------------------------------------------------------- revoke


@pytest.mark.parametrize("which", ["access", "refresh"])
async def test_revoke_ends_the_connection(
    oauth_http_client: AsyncClient, db_session: AsyncSession, which: str
) -> None:
    tokens = await connect(oauth_http_client, db_session, SEED.primary_profile)
    secret = tokens.access if which == "access" else tokens.refresh

    r = await revoke(oauth_http_client, tokens.client_id, secret)

    assert r.status_code == 200, r.text
    assert await _revoked(db_session, tokens.connection_id)
    _assert_invalid_grant(await refresh(oauth_http_client, tokens.client_id, tokens.refresh))


# --------------------------------------------------------------------------- limits


async def test_token_over_the_client_limit_is_429(oauth_http_client: AsyncClient) -> None:
    client_id = await registered_client_id(oauth_http_client)
    verifier, _ = pkce_pair()
    statuses = [
        (await exchange(oauth_http_client, client_id, "nope", verifier)).status_code
        for _ in range(60)
    ]
    assert 429 not in statuses

    r = await exchange(oauth_http_client, client_id, "nope", verifier)
    assert r.status_code == 429
    assert int(r.headers["retry-after"]) >= 1


async def test_revoke_over_the_ip_limit_is_429(oauth_http_client: AsyncClient) -> None:
    client_id = await registered_client_id(oauth_http_client)
    statuses = [(await revoke(oauth_http_client, client_id, "nope")).status_code for _ in range(60)]
    assert 429 not in statuses

    r = await revoke(oauth_http_client, client_id, "nope")
    assert r.status_code == 429
    assert int(r.headers["retry-after"]) >= 1


# --------------------------------------------------------------------------- prune


async def _exists(db: AsyncSession, sql: str, **params: Any) -> bool:
    return bool(await _sql(db, sql, **params))


async def test_register_prunes_stale_rows_and_keeps_live_ones(
    oauth_http_client: AsyncClient, db_session: AsyncSession
) -> None:
    stale_client = await insert_oauth_client(db_session, created_at_offset=timedelta(hours=25))
    used_client = await insert_oauth_client(db_session, created_at_offset=timedelta(hours=25))
    await insert_oauth_connection(db_session, user_id=SEED.primary_profile, client_id=used_client)
    live_client = await insert_oauth_client(db_session)
    expired_request = await insert_oauth_request(
        db_session, client_id=live_client, expires_in=-timedelta(minutes=1)
    )
    client_id, code, verifier, approved = await _approved_code(oauth_http_client, db_session)
    tokens: OAuthTokens = await connect(oauth_http_client, db_session, SEED.reviewer_profile)
    await db_session.execute(
        text(
            "UPDATE public.mcp_oauth_tokens SET expires_at = now() - interval '1 minute' "
            "WHERE connection_id = :id AND kind = 'access'"
        ),
        {"id": str(tokens.connection_id)},
    )

    assert (await register(oauth_http_client)).status_code == 201

    clients = "SELECT 1 FROM public.mcp_oauth_clients WHERE client_id = :id"
    requests = "SELECT 1 FROM public.mcp_oauth_requests WHERE id = :id"
    assert not await _exists(db_session, clients, id=stale_client)
    assert await _exists(db_session, clients, id=used_client)
    assert not await _exists(db_session, requests, id=expired_request)
    assert await _exists(db_session, requests, id=approved)
    assert not await _exists(
        db_session,
        "SELECT 1 FROM public.mcp_oauth_tokens WHERE connection_id = :id AND kind = 'access'",
        id=tokens.connection_id,
    )
    assert (await exchange(oauth_http_client, client_id, code, verifier)).status_code == 200
