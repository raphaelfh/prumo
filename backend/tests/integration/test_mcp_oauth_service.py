"""The OAuth authorization server's domain rules, called directly on
``db_session`` (ADR 0022): the redirect allow-list, client registration and
lookup, the pending authorization request, the consent decision, the code
exchange, refresh rotation, access-token lookup, revocation and pruning."""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime, timedelta
from typing import Any
from urllib.parse import parse_qs, urlsplit
from uuid import UUID, uuid4

import pytest
from mcp.server.auth.provider import (
    AuthorizationParams,
    AuthorizeError,
    RegistrationError,
    TokenError,
)
from mcp.shared.auth import OAuthClientInformationFull
from pydantic import AnyUrl
from sqlalchemy import false, func, select, text
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker

from app.core.config import Settings, settings
from app.models.mcp_oauth import McpOAuthClient, McpOAuthRequest, McpOAuthToken
from app.models.personal_access_token import PersonalAccessToken
from app.services import mcp_oauth_service as svc
from app.services.pat_service import TokenNotFoundError, hash_secret, revoke_credential
from tests.integration.conftest import SEED
from tests.integration.helpers.batch_fixtures import batch_halt, make_agent_batch
from tests.integration.helpers.pat_rows import (
    insert_oauth_client,
    insert_oauth_connection,
    insert_oauth_request,
    insert_pat_row,
)
from tests.integration.mcp.oauth_flow import approve

BASE_URL = "http://localhost:8000"
MCP_URL = BASE_URL + "/mcp"
CLAUDE_CB = "https://claude.ai/api/mcp/auth_callback"


@pytest.fixture(autouse=True)
def _oauth_on(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "PUBLIC_API_URL", BASE_URL)
    monkeypatch.setattr(
        settings,
        "MCP_OAUTH_REDIRECT_URIS",
        Settings.model_fields["MCP_OAUTH_REDIRECT_URIS"].default,
    )


def _info(**overrides: object) -> OAuthClientInformationFull:
    fields: dict[str, object] = {
        "client_id": str(uuid4()),
        "client_name": "Claude",
        "redirect_uris": [CLAUDE_CB],
        "scope": "read write",
        "token_endpoint_auth_method": "none",
        **overrides,
    }
    return OAuthClientInformationFull.model_validate(fields)


def _params(**overrides: object) -> AuthorizationParams:
    fields: dict[str, object] = {
        "state": "st",
        "scopes": ["read", "write"],
        "code_challenge": "challenge",
        "redirect_uri": AnyUrl(CLAUDE_CB),
        "redirect_uri_provided_explicitly": True,
        "resource": MCP_URL,
        **overrides,
    }
    return AuthorizationParams.model_validate(fields)


async def _registered(db: AsyncSession, **overrides: object) -> OAuthClientInformationFull:
    info = _info(**overrides)
    await svc.register_client(db, info)
    found = await svc.get_client(db, info.client_id)
    assert found is not None
    return found


# --------------------------------------------------------------------------- settings


def test_redirect_allow_list_default_is_the_claude_callback() -> None:
    assert Settings.model_fields["MCP_OAUTH_REDIRECT_URIS"].default == CLAUDE_CB


def test_redirect_allow_list_splits_on_commas() -> None:
    built = Settings(MCP_OAUTH_REDIRECT_URIS=" https://a.example/cb , ,https://b.example/cb")  # type: ignore[call-arg]
    assert built.mcp_oauth_redirect_uris_list == ["https://a.example/cb", "https://b.example/cb"]


# --------------------------------------------------------------------------- redirect rule


@pytest.mark.parametrize(
    "uri",
    [CLAUDE_CB, "http://127.0.0.1:1/cb", "http://localhost:65535/x", "http://[::1]:8080/cb"],
    ids=["claude", "ipv4", "localhost", "ipv6"],
)
def test_redirect_uri_allowed(uri: str) -> None:
    assert svc.redirect_uri_allowed(uri) is True


@pytest.mark.parametrize(
    "uri",
    [
        "https://claude.com/api/mcp/auth_callback",
        "https://evil.example/cb",
        "http://localhost.evil.example/cb",
        "http://127.0.0.1.nip.io/cb",
        "http://localhost@evil.example/cb",
        "http://claude.ai@127.0.0.1/cb",
        "https://localhost/cb",
        "http://localhost:1/cb#frag",
        CLAUDE_CB + "?x=1",
    ],
    ids=[
        "claude-com",
        "foreign",
        "localhost-prefix",
        "ip-prefix",
        "userinfo-localhost",
        "userinfo-ip",
        "https-loopback",
        "fragment",
        "claude-with-query",
    ],
)
def test_redirect_uri_refused(uri: str) -> None:
    assert svc.redirect_uri_allowed(uri) is False


# --------------------------------------------------------------------------- register / get


async def test_register_client_stores_the_client(db_session: AsyncSession) -> None:
    info = _info(client_name="  Claude  ", redirect_uris=[CLAUDE_CB, "http://localhost:1/cb"])
    await svc.register_client(db_session, info)

    row = await db_session.get(McpOAuthClient, UUID(info.client_id))
    assert row is not None
    assert row.client_name == "Claude"
    assert row.scope == "read write"
    assert row.redirect_uris == [CLAUDE_CB, "http://localhost:1/cb"]


async def test_register_client_defaults_and_caps_the_name(db_session: AsyncSession) -> None:
    unnamed = _info(client_name=None)
    long = _info(client_name="x" * 200)
    await svc.register_client(db_session, unnamed)
    await svc.register_client(db_session, long)

    assert (await db_session.get(McpOAuthClient, UUID(unnamed.client_id))).client_name == (  # type: ignore[union-attr]
        svc.DEFAULT_CLIENT_NAME
    )
    assert (await db_session.get(McpOAuthClient, UUID(long.client_id))).client_name == "x" * 80  # type: ignore[union-attr]


@pytest.mark.parametrize(
    "overrides",
    [
        {"token_endpoint_auth_method": "client_secret_post"},
        {"redirect_uris": None},
        {"redirect_uris": [f"http://localhost:{p}/cb" for p in range(1, 7)]},
        {"redirect_uris": [CLAUDE_CB, "https://evil.example/cb"]},
    ],
    ids=["confidential", "no-redirect", "six-redirects", "refused-redirect"],
)
async def test_register_client_refuses(db_session: AsyncSession, overrides: dict) -> None:
    info = _info(**overrides)
    with pytest.raises(RegistrationError) as caught:
        await svc.register_client(db_session, info)
    assert caught.value.error == "invalid_client_metadata"
    assert await db_session.get(McpOAuthClient, UUID(info.client_id)) is None


@pytest.mark.parametrize("client_id", ["not-a-uuid", str(uuid4())], ids=["not-uuid", "missing"])
async def test_get_client_unknown_is_none(db_session: AsyncSession, client_id: str) -> None:
    assert await svc.get_client(db_session, client_id) is None


async def test_get_client_returns_the_registered_client(db_session: AsyncSession) -> None:
    info = _info()
    await svc.register_client(db_session, info)

    found = await svc.get_client(db_session, info.client_id)

    assert found is not None
    assert found.client_id == info.client_id
    assert found.client_name == "Claude"
    assert [str(u) for u in found.redirect_uris or []] == [CLAUDE_CB]
    assert found.scope == "read write"
    assert found.token_endpoint_auth_method == "none"
    assert found.grant_types == ["authorization_code", "refresh_token"]
    assert found.response_types == ["code"]
    assert found.client_secret is None
    assert isinstance(found.client_id_issued_at, int)


# --------------------------------------------------------------------------- create_request


async def test_create_request_stores_a_pending_request(db_session: AsyncSession) -> None:
    client = await _registered(db_session)
    before = datetime.now(UTC)

    request_id = await svc.create_request(db_session, client=client, params=_params())

    row = await db_session.get(McpOAuthRequest, request_id)
    assert row is not None
    assert row.client_id == UUID(client.client_id)
    assert row.requested_scopes == ["read", "write"]
    assert row.resource == MCP_URL
    assert row.redirect_uri == CLAUDE_CB
    assert row.redirect_uri_provided_explicitly is True
    assert row.code_challenge == "challenge"
    assert row.state == "st"
    assert row.decided_at is None
    expected = before + timedelta(minutes=10)
    assert abs((row.expires_at - expected).total_seconds()) < 5


async def test_create_request_drops_offline_access(db_session: AsyncSession) -> None:
    client = await _registered(db_session, scope="read write offline_access")
    request_id = await svc.create_request(
        db_session, client=client, params=_params(scopes=["read", "write", "offline_access"])
    )
    row = await db_session.get(McpOAuthRequest, request_id)
    assert row is not None
    assert row.requested_scopes == ["read", "write"]


async def test_create_request_without_scopes_takes_the_registered_ones(
    db_session: AsyncSession,
) -> None:
    client = await _registered(db_session, scope="read")
    request_id = await svc.create_request(db_session, client=client, params=_params(scopes=None))
    row = await db_session.get(McpOAuthRequest, request_id)
    assert row is not None
    assert row.requested_scopes == ["read"]


@pytest.mark.parametrize(
    ("registered", "asked", "stored"),
    [
        ("read write", ["write"], ["read", "write"]),
        ("read write offline_access", ["offline_access"], ["read"]),
        ("offline_access", None, ["read"]),
        ("write", None, ["read", "write"]),
    ],
    ids=["write-only", "offline-only", "registered-offline-only", "registered-write-only"],
)
async def test_create_request_always_includes_read(
    db_session: AsyncSession, registered: str, asked: list[str] | None, stored: list[str]
) -> None:
    client = await _registered(db_session, scope=registered)
    request_id = await svc.create_request(db_session, client=client, params=_params(scopes=asked))
    row = await db_session.get(McpOAuthRequest, request_id)
    assert row is not None
    assert row.requested_scopes == stored


async def test_create_request_without_resource_stores_none(db_session: AsyncSession) -> None:
    client = await _registered(db_session)
    request_id = await svc.create_request(db_session, client=client, params=_params(resource=None))
    row = await db_session.get(McpOAuthRequest, request_id)
    assert row is not None
    assert row.resource is None


async def test_create_request_accepts_a_trailing_slash_resource(db_session: AsyncSession) -> None:
    client = await _registered(db_session)
    request_id = await svc.create_request(
        db_session, client=client, params=_params(resource=MCP_URL + "/")
    )
    row = await db_session.get(McpOAuthRequest, request_id)
    assert row is not None
    assert row.resource == MCP_URL


async def test_create_request_refuses_a_foreign_resource(db_session: AsyncSession) -> None:
    client = await _registered(db_session)
    with pytest.raises(AuthorizeError) as caught:
        await svc.create_request(
            db_session, client=client, params=_params(resource="https://other.example/mcp")
        )
    assert caught.value.error == "invalid_target"


# --------------------------------------------------------------------------- consent decision


def _query(url: str) -> dict[str, list[str]]:
    return parse_qs(urlsplit(url).query)


async def _connection(db: AsyncSession, connection_id: UUID) -> PersonalAccessToken:
    row = (
        await db.execute(
            select(PersonalAccessToken)
            .where(PersonalAccessToken.id == connection_id)
            .execution_options(populate_existing=True)
        )
    ).scalar_one()
    return row


async def _push_past_expiry(db: AsyncSession, request_id: UUID) -> None:
    await db.execute(
        text(
            "UPDATE public.mcp_oauth_requests SET expires_at = now() - interval '1 minute' "
            "WHERE id = :id"
        ),
        {"id": str(request_id)},
    )


async def test_decide_request_approve_creates_the_connection_and_a_code(
    db_session: AsyncSession,
) -> None:
    client_id = await insert_oauth_client(db_session, client_name="Claude Desktop")
    request_id = await insert_oauth_request(db_session, client_id=client_id)

    url = await svc.decide_request(
        db_session, request_id=request_id, user_id=SEED.primary_profile, approve=True, write=True
    )

    assert url.startswith(CLAUDE_CB + "?")
    query = _query(url)
    assert query["state"] == ["st"]
    code = query["code"][0]
    request = await db_session.get(McpOAuthRequest, request_id)
    assert request is not None
    assert request.decided_at is not None
    assert request.user_id == SEED.primary_profile
    assert request.connection_id is not None
    assert request.code_hash is not None
    assert request.code_hash != code
    assert request.code_expires_at is not None
    connection = await _connection(db_session, request.connection_id)
    assert connection.kind == "oauth"
    assert connection.scope == "read_write"
    assert connection.name == "Claude Desktop"
    assert connection.user_id == SEED.primary_profile
    assert connection.oauth_client_id == client_id
    assert connection.project_ids is None
    expected = datetime.now(UTC) + timedelta(days=90)
    assert abs((connection.expires_at - expected).total_seconds()) < 60


async def test_decide_request_deny_redirects_with_access_denied(db_session: AsyncSession) -> None:
    client_id = await insert_oauth_client(db_session)
    request_id = await insert_oauth_request(db_session, client_id=client_id)

    url = await svc.decide_request(
        db_session, request_id=request_id, user_id=SEED.primary_profile, approve=False, write=False
    )

    assert url.startswith(CLAUDE_CB + "?")
    query = _query(url)
    assert query["error"] == ["access_denied"]
    assert query["state"] == ["st"]
    assert "code" not in query
    request = await db_session.get(McpOAuthRequest, request_id)
    assert request is not None
    assert request.decided_at is not None
    assert request.connection_id is None
    assert request.code_hash is None
    connections = (
        await db_session.execute(
            select(func.count())
            .select_from(PersonalAccessToken)
            .where(PersonalAccessToken.oauth_client_id == client_id)
        )
    ).scalar_one()
    assert connections == 0


async def test_decide_request_approve_revokes_the_previous_connection(
    db_session: AsyncSession,
) -> None:
    client_id = await insert_oauth_client(db_session)
    previous = await insert_oauth_connection(
        db_session, user_id=SEED.primary_profile, client_id=client_id
    )
    request_id = await insert_oauth_request(db_session, client_id=client_id)

    await svc.decide_request(
        db_session, request_id=request_id, user_id=SEED.primary_profile, approve=True, write=False
    )

    assert (await _connection(db_session, previous)).revoked_at is not None
    request = await db_session.get(McpOAuthRequest, request_id)
    assert request is not None and request.connection_id is not None
    assert request.connection_id != previous
    assert (await _connection(db_session, request.connection_id)).revoked_at is None


async def _decided(db: AsyncSession) -> UUID:
    client_id = await insert_oauth_client(db)
    request_id = await insert_oauth_request(db, client_id=client_id)
    await svc.decide_request(
        db, request_id=request_id, user_id=SEED.primary_profile, approve=True, write=False
    )
    await db.flush()
    return request_id


async def _expired(db: AsyncSession) -> UUID:
    client_id = await insert_oauth_client(db)
    return await insert_oauth_request(db, client_id=client_id, expires_in=-timedelta(minutes=1))


async def _decided_and_expired(db: AsyncSession) -> UUID:
    request_id = await _decided(db)
    await _push_past_expiry(db, request_id)
    return request_id


async def _unknown(_db: AsyncSession) -> UUID:
    return uuid4()


_REFUSALS = [
    (_decided, svc.ConsentRequestDecidedError),
    (_expired, svc.ConsentRequestNotFoundError),
    (_decided_and_expired, svc.ConsentRequestDecidedError),
    (_unknown, svc.ConsentRequestNotFoundError),
]
_REFUSAL_IDS = ["decided", "expired", "decided-and-expired", "unknown"]


@pytest.mark.parametrize(("make", "error"), _REFUSALS, ids=_REFUSAL_IDS)
async def test_decide_request_refuses(db_session: AsyncSession, make: Any, error: type) -> None:
    request_id = await make(db_session)
    with pytest.raises(error):
        await svc.decide_request(
            db_session,
            request_id=request_id,
            user_id=SEED.primary_profile,
            approve=True,
            write=True,
        )


@pytest.mark.parametrize(("make", "error"), _REFUSALS, ids=_REFUSAL_IDS)
async def test_get_consent_request_refuses(
    db_session: AsyncSession, make: Any, error: type
) -> None:
    request_id = await make(db_session)
    with pytest.raises(error):
        await svc.get_consent_request(db_session, request_id=request_id)


def test_consent_errors_map_to_404_and_409() -> None:
    missing = svc.ConsentRequestNotFoundError()
    decided = svc.ConsentRequestDecidedError()
    assert (missing.status_code, missing.code) == (404, "NOT_FOUND")
    assert missing.message == "This request expired or does not exist."
    assert (decided.status_code, decided.code) == (409, "REQUEST_ALREADY_DECIDED")
    assert decided.message == "This request was already answered."


@pytest.mark.parametrize(
    ("scopes", "offers_write"),
    [(("read", "write"), True), (("read",), False)],
    ids=["read-write", "read-only"],
)
async def test_get_consent_request_returns_the_view(
    db_session: AsyncSession, scopes: tuple[str, ...], offers_write: bool
) -> None:
    client_id = await insert_oauth_client(db_session, client_name="Claude")
    request_id = await insert_oauth_request(
        db_session,
        client_id=client_id,
        requested_scopes=scopes,
        redirect_uri="http://localhost:3118/cb",
    )

    view = await svc.get_consent_request(db_session, request_id=request_id)

    assert view.client_name == "Claude"
    assert view.redirect_host == "localhost:3118"
    assert view.requested_scopes == list(scopes)
    assert view.offers_write is offers_write
    assert view.expires_at > datetime.now(UTC)


async def test_concurrent_approvals_for_one_user_and_client_admit_one(
    _engine: AsyncEngine,
) -> None:
    Session = async_sessionmaker(_engine, expire_on_commit=False)
    async with Session() as setup:
        client_id = await insert_oauth_client(setup)
        first = await insert_oauth_request(setup, client_id=client_id)
        second = await insert_oauth_request(setup, client_id=client_id)
        await setup.commit()

    async def _decide(session: AsyncSession, request_id: UUID) -> str:
        return await svc.decide_request(
            session, request_id=request_id, user_id=SEED.primary_profile, approve=True, write=False
        )

    try:
        async with Session() as a, Session() as b:
            await _decide(a, first)
            task = asyncio.create_task(_decide(b, second))
            await asyncio.sleep(0.2)
            assert not task.done()  # waiting on the unique index, not on a row lock
            await a.commit()
            with pytest.raises(svc.ConsentRequestDecidedError):
                await task
            await b.rollback()

        async with Session() as check:
            unrevoked = (
                await check.execute(
                    text(
                        "SELECT count(*) FROM public.personal_access_tokens "
                        "WHERE oauth_client_id = :cid AND user_id = :uid AND revoked_at IS NULL"
                    ),
                    {"cid": str(client_id), "uid": str(SEED.primary_profile)},
                )
            ).scalar_one()
            assert unrevoked == 1
    finally:
        async with Session() as cleanup:
            await cleanup.execute(
                text("DELETE FROM public.mcp_oauth_clients WHERE client_id = :cid"),
                {"cid": str(client_id)},
            )
            await cleanup.commit()


# --------------------------------------------------------------------------- code exchange


async def _code(db: AsyncSession, *, write: bool = True) -> tuple[UUID, str, UUID]:
    """client_id, an approved request's code and that request's id."""
    client_id = await insert_oauth_client(db)
    request_id = await insert_oauth_request(db, client_id=client_id)
    return client_id, await approve(db, request_id, SEED.primary_profile, write=write), request_id


async def _request(db: AsyncSession, request_id: UUID) -> McpOAuthRequest:
    row = await db.get(McpOAuthRequest, request_id, populate_existing=True)
    assert row is not None
    return row


async def _token_row(db: AsyncSession, secret: str) -> McpOAuthToken | None:
    return (
        await db.execute(
            select(McpOAuthToken)
            .where(McpOAuthToken.token_hash == hash_secret(secret))
            .execution_options(populate_existing=True)
        )
    ).scalar_one_or_none()


async def _set(db: AsyncSession, sql: str, **params: object) -> None:
    await db.execute(text(sql), {k: str(v) for k, v in params.items()})


async def test_load_code_returns_the_approved_code(db_session: AsyncSession) -> None:
    client_id, code, request_id = await _code(db_session)

    loaded = await svc.load_code(db_session, client_id=str(client_id), code=code)

    request = await _request(db_session, request_id)
    assert loaded is not None
    assert loaded.code == code
    assert loaded.client_id == str(client_id)
    assert loaded.scopes == ["read", "write"]
    assert loaded.code_challenge == request.code_challenge
    assert str(loaded.redirect_uri) == CLAUDE_CB
    assert loaded.redirect_uri_provided_explicitly is True
    assert loaded.subject == str(SEED.primary_profile)
    assert request.code_expires_at is not None
    assert loaded.expires_at == request.code_expires_at.timestamp()


async def test_load_code_unknown_or_foreign_is_none(db_session: AsyncSession) -> None:
    client_id, code, _ = await _code(db_session)
    other = await insert_oauth_client(db_session)

    assert await svc.load_code(db_session, client_id=str(client_id), code="nope") is None
    assert await svc.load_code(db_session, client_id=str(other), code=code) is None
    assert await svc.load_code(db_session, client_id="not-a-uuid", code=code) is None


@pytest.mark.parametrize(("write", "scope"), [(True, "read write"), (False, "read")])
async def test_exchange_code_issues_a_pair(
    db_session: AsyncSession, write: bool, scope: str
) -> None:
    client_id, code, request_id = await _code(db_session, write=write)

    issued = await svc.exchange_code(db_session, client_id=str(client_id), code=code)

    assert issued.access_token.startswith(svc.ACCESS_PREFIX)
    assert issued.refresh_token is not None
    assert issued.refresh_token.startswith(svc.REFRESH_PREFIX)
    assert issued.token_type == "Bearer"
    assert issued.expires_in == 3600
    assert issued.scope == scope
    request = await _request(db_session, request_id)
    assert request.code_used_at is not None
    access = await _token_row(db_session, issued.access_token)
    refresh = await _token_row(db_session, issued.refresh_token)
    assert access is not None and access.kind == "access"
    assert refresh is not None and refresh.kind == "refresh"
    assert access.resource == refresh.resource == MCP_URL
    assert access.connection_id == refresh.connection_id == request.connection_id
    assert request.connection_id is not None
    connection = await _connection(db_session, request.connection_id)
    assert refresh.expires_at == connection.expires_at
    assert (access.expires_at - access.created_at) == timedelta(hours=1)
    client = await db_session.get(McpOAuthClient, client_id, populate_existing=True)
    assert client is not None and client.last_used_at is not None


async def test_exchange_code_twice_revokes_the_connection(db_session: AsyncSession) -> None:
    client_id, code, request_id = await _code(db_session)
    await svc.exchange_code(db_session, client_id=str(client_id), code=code)

    with pytest.raises(TokenError) as caught:
        await svc.exchange_code(db_session, client_id=str(client_id), code=code)

    assert caught.value.error == "invalid_grant"
    request = await _request(db_session, request_id)
    assert request.connection_id is not None
    assert (await _connection(db_session, request.connection_id)).revoked_at is not None


async def test_exchange_code_on_a_revoked_connection_is_invalid_grant(
    db_session: AsyncSession,
) -> None:
    client_id, code, request_id = await _code(db_session)
    request = await _request(db_session, request_id)
    await _set(
        db_session,
        "UPDATE public.personal_access_tokens SET revoked_at = now() WHERE id = :id",
        id=request.connection_id,
    )

    with pytest.raises(TokenError) as caught:
        await svc.exchange_code(db_session, client_id=str(client_id), code=code)

    assert caught.value.error == "invalid_grant"
    assert (await _request(db_session, request_id)).code_used_at is None


async def test_exchange_code_after_expiry_is_invalid_grant_without_revoking(
    db_session: AsyncSession,
) -> None:
    client_id, code, request_id = await _code(db_session)
    await _set(
        db_session,
        "UPDATE public.mcp_oauth_requests SET code_expires_at = now() - interval '1 minute' "
        "WHERE id = :id",
        id=request_id,
    )

    with pytest.raises(TokenError) as caught:
        await svc.exchange_code(db_session, client_id=str(client_id), code=code)

    assert caught.value.error == "invalid_grant"
    request = await _request(db_session, request_id)
    assert request.connection_id is not None
    assert (await _connection(db_session, request.connection_id)).revoked_at is None


async def test_exchange_code_unknown_is_invalid_grant(db_session: AsyncSession) -> None:
    client_id, _, _ = await _code(db_session)
    with pytest.raises(TokenError) as caught:
        await svc.exchange_code(db_session, client_id=str(client_id), code="nope")
    assert caught.value.error == "invalid_grant"


# --------------------------------------------------------------------------- refresh


async def _issued(db: AsyncSession, *, write: bool = True) -> tuple[UUID, str, str, UUID]:
    """client_id, access secret, refresh secret and the connection id."""
    client_id, code, request_id = await _code(db, write=write)
    issued = await svc.exchange_code(db, client_id=str(client_id), code=code)
    assert issued.refresh_token is not None
    request = await _request(db, request_id)
    assert request.connection_id is not None
    return client_id, issued.access_token, issued.refresh_token, request.connection_id


async def test_load_refresh_returns_the_token(db_session: AsyncSession) -> None:
    client_id, _, refresh, connection_id = await _issued(db_session)

    loaded = await svc.load_refresh(db_session, client_id=str(client_id), token=refresh)

    assert loaded is not None
    assert loaded.token == refresh
    assert loaded.client_id == str(client_id)
    assert loaded.scopes == ["read", "write", "offline_access"]
    assert loaded.resource == MCP_URL
    assert loaded.subject == str(SEED.primary_profile)
    connection = await _connection(db_session, connection_id)
    assert loaded.expires_at == int(connection.expires_at.timestamp())


async def test_load_refresh_unknown_foreign_or_revoked_is_none(db_session: AsyncSession) -> None:
    client_id, access, refresh, connection_id = await _issued(db_session)
    other = await insert_oauth_client(db_session)

    assert await svc.load_refresh(db_session, client_id=str(client_id), token="nope") is None
    assert await svc.load_refresh(db_session, client_id=str(client_id), token=access) is None
    assert await svc.load_refresh(db_session, client_id=str(other), token=refresh) is None
    assert await svc.load_refresh(db_session, client_id="not-a-uuid", token=refresh) is None
    await _set(
        db_session,
        "UPDATE public.personal_access_tokens SET revoked_at = now() WHERE id = :id",
        id=connection_id,
    )
    assert await svc.load_refresh(db_session, client_id=str(client_id), token=refresh) is None


async def test_rotate_refresh_issues_a_new_pair(db_session: AsyncSession) -> None:
    client_id, access, refresh, connection_id = await _issued(db_session, write=False)

    issued = await svc.rotate_refresh(db_session, client_id=str(client_id), token=refresh)

    assert issued.access_token.startswith(svc.ACCESS_PREFIX)
    assert issued.access_token != access
    assert issued.refresh_token is not None and issued.refresh_token != refresh
    assert issued.scope == "read"
    assert issued.expires_in == 3600
    old = await _token_row(db_session, refresh)
    new = await _token_row(db_session, issued.refresh_token)
    assert old is not None and old.rotated_at is not None
    assert new is not None and new.rotated_at is None
    assert new.connection_id == connection_id
    assert new.resource == MCP_URL


async def test_rotate_refresh_twice_revokes_the_connection(db_session: AsyncSession) -> None:
    client_id, _, refresh, connection_id = await _issued(db_session)
    await svc.rotate_refresh(db_session, client_id=str(client_id), token=refresh)

    with pytest.raises(TokenError) as caught:
        await svc.rotate_refresh(db_session, client_id=str(client_id), token=refresh)

    assert caught.value.error == "invalid_grant"
    assert (await _connection(db_session, connection_id)).revoked_at is not None


async def test_rotate_refresh_on_a_revoked_connection_is_invalid_grant(
    db_session: AsyncSession,
) -> None:
    client_id, _, refresh, connection_id = await _issued(db_session)
    await _set(
        db_session,
        "UPDATE public.personal_access_tokens SET revoked_at = now() WHERE id = :id",
        id=connection_id,
    )

    with pytest.raises(TokenError) as caught:
        await svc.rotate_refresh(db_session, client_id=str(client_id), token=refresh)

    assert caught.value.error == "invalid_grant"
    old = await _token_row(db_session, refresh)
    assert old is not None and old.rotated_at is None


@pytest.mark.parametrize("token", ["nope", "access"], ids=["unknown", "access-token"])
async def test_rotate_refresh_unknown_is_invalid_grant(
    db_session: AsyncSession, token: str
) -> None:
    client_id, access, _, _ = await _issued(db_session)
    with pytest.raises(TokenError) as caught:
        await svc.rotate_refresh(
            db_session, client_id=str(client_id), token=access if token == "access" else token
        )
    assert caught.value.error == "invalid_grant"


# --------------------------------------------------------------------------- access tokens


async def test_load_access_returns_the_token(db_session: AsyncSession) -> None:
    client_id, access, _, _ = await _issued(db_session, write=False)

    loaded = await svc.load_access(db_session, access)

    row = await _token_row(db_session, access)
    assert loaded is not None and row is not None
    assert loaded.token == access
    assert loaded.client_id == str(client_id)
    assert loaded.scopes == ["read"]
    assert loaded.resource == MCP_URL
    assert loaded.expires_at == int(row.expires_at.timestamp())


async def test_load_access_refuses_a_refresh_token(db_session: AsyncSession) -> None:
    _, _, refresh, _ = await _issued(db_session)
    assert await svc.load_access(db_session, refresh) is None
    assert await svc.load_access(db_session, "nope") is None


async def test_load_access_is_none_once_expired(db_session: AsyncSession) -> None:
    _, access, _, _ = await _issued(db_session)
    await _set(
        db_session,
        "UPDATE public.mcp_oauth_tokens SET expires_at = now() - interval '1 second' "
        "WHERE token_hash = :h",
        h=hash_secret(access),
    )
    assert await svc.load_access(db_session, access) is None


async def test_load_access_is_none_once_revoked(db_session: AsyncSession) -> None:
    _, access, _, connection_id = await _issued(db_session)
    await _set(
        db_session,
        "UPDATE public.personal_access_tokens SET revoked_at = now() WHERE id = :id",
        id=connection_id,
    )
    assert await svc.load_access(db_session, access) is None


async def test_active_access_row_applies_extra_predicates(db_session: AsyncSession) -> None:
    _, access, _, connection_id = await _issued(db_session)

    found = await svc._active_access_row(db_session, access)
    assert found is not None
    token_row, connection = found
    assert token_row.kind == "access"
    assert connection.id == connection_id

    assert await svc._active_access_row(db_session, access, false()) is None


@pytest.mark.parametrize(
    ("write", "scopes"), [(True, {"read", "write"}), (False, {"read"})], ids=["write", "read"]
)
async def test_resolve_principal_returns_the_connection_principal(
    db_session: AsyncSession, write: bool, scopes: set[str]
) -> None:
    _, access, _, connection_id = await _issued(db_session, write=write)

    principal = await svc.resolve_principal(db_session, access)

    connection = await _connection(db_session, connection_id)
    assert principal is not None
    assert principal.user_sub == SEED.primary_profile
    assert principal.token_id == connection_id
    assert principal.scopes == frozenset(scopes)
    assert principal.token_expires_at == connection.expires_at
    assert principal.project_ids is None


async def _expire_access(db: AsyncSession, access: str, _connection_id: UUID) -> None:
    await _set(
        db,
        "UPDATE public.mcp_oauth_tokens SET expires_at = now() - interval '1 second' "
        "WHERE token_hash = :h",
        h=hash_secret(access),
    )


async def _foreign_resource(db: AsyncSession, access: str, _connection_id: UUID) -> None:
    await _set(
        db,
        "UPDATE public.mcp_oauth_tokens SET resource = 'https://other.example/mcp' "
        "WHERE token_hash = :h",
        h=hash_secret(access),
    )


async def _revoke(db: AsyncSession, _access: str, connection_id: UUID) -> None:
    await _set(
        db,
        "UPDATE public.personal_access_tokens SET revoked_at = now() WHERE id = :id",
        id=connection_id,
    )


async def _expire_connection(db: AsyncSession, _access: str, connection_id: UUID) -> None:
    await _set(
        db,
        "UPDATE public.personal_access_tokens "
        "SET created_at = now() - interval '2 days', expires_at = now() - interval '1 day' "
        "WHERE id = :id",
        id=connection_id,
    )


async def _ban(db: AsyncSession, _access: str, _connection_id: UUID) -> None:
    await _set(
        db,
        "UPDATE auth.users SET banned_until = now() + interval '1 day' WHERE id = :id",
        id=SEED.primary_profile,
    )


@pytest.mark.parametrize(
    "spoil",
    [_expire_access, _foreign_resource, _revoke, _expire_connection, _ban],
    ids=["access-expired", "resource-mismatch", "revoked", "connection-expired", "banned"],
)
async def test_resolve_principal_refuses(db_session: AsyncSession, spoil: Any) -> None:
    _, access, _, connection_id = await _issued(db_session)
    assert await svc.resolve_principal(db_session, access) is not None

    await spoil(db_session, access, connection_id)

    assert await svc.resolve_principal(db_session, access) is None


@pytest.mark.parametrize(
    "secret",
    ["prumo_pat_" + "a" * 43, "prumo_oat_" + "a" * 43, "nope"],
    ids=["pat-prefix", "unknown", "no-prefix"],
)
async def test_resolve_principal_unknown_is_none(db_session: AsyncSession, secret: str) -> None:
    assert await svc.resolve_principal(db_session, secret) is None


async def test_resolve_principal_ignores_a_pat_prefixed_hash_match(
    db_session: AsyncSession,
) -> None:
    """The prefix gate runs first: a PAT secret never reaches the OAuth lookup."""
    _, access, _, _ = await _issued(db_session)
    pat_shaped = "prumo_pat_" + access.removeprefix(svc.ACCESS_PREFIX)
    await _set(
        db_session,
        "UPDATE public.mcp_oauth_tokens SET token_hash = :new WHERE token_hash = :old",
        new=hash_secret(pat_shaped),
        old=hash_secret(access),
    )
    assert await svc._active_access_row(db_session, pat_shaped) is not None

    assert await svc.resolve_principal(db_session, pat_shaped) is None


@pytest.mark.parametrize("which", ["access", "refresh"])
async def test_revoke_connection_by_token_revokes(db_session: AsyncSession, which: str) -> None:
    _, access, refresh, connection_id = await _issued(db_session)

    await svc.revoke_connection_by_token(db_session, access if which == "access" else refresh)

    assert (await _connection(db_session, connection_id)).revoked_at is not None


async def test_revoke_connection_by_unknown_token_is_a_no_op(db_session: AsyncSession) -> None:
    _, _, _, connection_id = await _issued(db_session)
    await svc.revoke_connection_by_token(db_session, "nope")
    assert (await _connection(db_session, connection_id)).revoked_at is None


# --------------------------------------------------------------------------- prune


async def _exists(db: AsyncSession, sql: str, **params: object) -> bool:
    return (await db.execute(text(sql), {k: str(v) for k, v in params.items()})).first() is not None


_CLIENT = "SELECT 1 FROM public.mcp_oauth_clients WHERE client_id = :id"
_REQUEST = "SELECT 1 FROM public.mcp_oauth_requests WHERE id = :id"
_TOKEN = "SELECT 1 FROM public.mcp_oauth_tokens WHERE token_hash = :h"


async def test_prune_deletes_exactly_the_stale_rows(db_session: AsyncSession) -> None:
    old_unused = await insert_oauth_client(db_session, created_at_offset=timedelta(hours=25))
    old_used = await insert_oauth_client(db_session, created_at_offset=timedelta(hours=25))
    await insert_oauth_connection(db_session, user_id=SEED.reviewer_profile, client_id=old_used)
    young_unused = await insert_oauth_client(db_session, created_at_offset=timedelta(hours=23))
    old_pending = await insert_oauth_client(db_session, created_at_offset=timedelta(hours=25))
    await insert_oauth_request(db_session, client_id=old_pending)
    old_lapsed = await insert_oauth_client(db_session, created_at_offset=timedelta(hours=25))
    await insert_oauth_request(db_session, client_id=old_lapsed, expires_in=-timedelta(minutes=1))
    pending = await insert_oauth_request(db_session, client_id=young_unused)
    lapsed = await insert_oauth_request(
        db_session, client_id=young_unused, expires_in=-timedelta(minutes=1)
    )
    _, _, fresh_decision = await _code(db_session)
    old_decision = await _decided(db_session)
    await _set(
        db_session,
        "UPDATE public.mcp_oauth_requests SET decided_at = now() - interval '25 hours' "
        "WHERE id = :id",
        id=old_decision,
    )
    _, access, refresh, _ = await _issued(db_session)
    _, expired_access, recently_rotated, _ = await _issued(db_session)
    await _set(
        db_session,
        "UPDATE public.mcp_oauth_tokens SET expires_at = now() - interval '1 second' "
        "WHERE token_hash = :h",
        h=hash_secret(expired_access),
    )
    _, _, long_rotated, _ = await _issued(db_session)
    await _set(
        db_session,
        "UPDATE public.mcp_oauth_tokens SET rotated_at = now() - interval '61 minutes' "
        "WHERE token_hash = :h",
        h=hash_secret(long_rotated),
    )
    await _set(
        db_session,
        "UPDATE public.mcp_oauth_tokens SET rotated_at = now() - interval '59 minutes' "
        "WHERE token_hash = :h",
        h=hash_secret(recently_rotated),
    )

    await svc.prune(db_session)

    assert not await _exists(db_session, _CLIENT, id=old_unused)
    assert await _exists(db_session, _CLIENT, id=old_used)
    assert await _exists(db_session, _CLIENT, id=young_unused)
    assert await _exists(db_session, _CLIENT, id=old_pending)
    assert not await _exists(db_session, _CLIENT, id=old_lapsed)
    assert await _exists(db_session, _REQUEST, id=pending)
    assert not await _exists(db_session, _REQUEST, id=lapsed)
    assert await _exists(db_session, _REQUEST, id=fresh_decision)
    assert not await _exists(db_session, _REQUEST, id=old_decision)
    assert await _exists(db_session, _TOKEN, h=hash_secret(access))
    assert await _exists(db_session, _TOKEN, h=hash_secret(refresh))
    assert not await _exists(db_session, _TOKEN, h=hash_secret(expired_access))
    assert await _exists(db_session, _TOKEN, h=hash_secret(recently_rotated))
    assert not await _exists(db_session, _TOKEN, h=hash_secret(long_rotated))


# --------------------------------------------------------------------------- connected apps


async def _expire_connection(db: AsyncSession, connection_id: UUID) -> None:
    await _set(
        db,
        "UPDATE public.personal_access_tokens "
        "SET created_at = now() - interval '2 days', expires_at = now() - interval '1 day' "
        "WHERE id = :id",
        id=connection_id,
    )


async def test_list_connections_returns_only_the_callers_oauth_rows(
    db_session: AsyncSession,
) -> None:
    me = SEED.reviewer_profile
    active = await insert_oauth_connection(
        db_session, user_id=me, client_id=await insert_oauth_client(db_session), name="Claude"
    )
    revoked = await insert_oauth_connection(
        db_session, user_id=me, client_id=await insert_oauth_client(db_session), name="Cursor"
    )
    await revoke_credential(db_session, revoked)
    expired = await insert_oauth_connection(
        db_session, user_id=me, client_id=await insert_oauth_client(db_session), name="Zed"
    )
    await _expire_connection(db_session, expired)
    foreign = await insert_oauth_connection(
        db_session,
        user_id=SEED.primary_profile,
        client_id=await insert_oauth_client(db_session),
    )
    pat = await insert_pat_row(db_session)

    rows = await svc.list_connections(db_session, user_id=me)

    by_id = {row.id: row for row in rows}
    assert set(by_id) == {active, revoked, expired}
    assert foreign not in by_id and pat not in by_id
    assert rows[0].id == active  # active first
    assert by_id[active].status == "active"
    assert by_id[active].client_name == "Claude"
    assert by_id[active].scope == "read_write"
    assert by_id[revoked].status == "revoked"
    assert by_id[expired].status == "expired"


async def test_revoke_connection_revokes_an_owned_row_idempotently(
    db_session: AsyncSession,
) -> None:
    connection_id = await insert_oauth_connection(
        db_session,
        user_id=SEED.reviewer_profile,
        client_id=await insert_oauth_client(db_session),
    )

    first = await svc.revoke_connection(
        db_session, user_id=SEED.reviewer_profile, connection_id=connection_id
    )
    second = await svc.revoke_connection(
        db_session, user_id=SEED.reviewer_profile, connection_id=connection_id
    )

    assert first.id == second.id == connection_id
    assert first.status == second.status == "revoked"
    assert (await _connection(db_session, connection_id)).revoked_at is not None


async def test_revoke_connection_refuses_a_foreign_row_and_a_pat(
    db_session: AsyncSession,
) -> None:
    foreign = await insert_oauth_connection(
        db_session,
        user_id=SEED.primary_profile,
        client_id=await insert_oauth_client(db_session),
    )
    pat = await insert_pat_row(db_session)  # the primary profile's own PAT

    with pytest.raises(TokenNotFoundError):
        await svc.revoke_connection(
            db_session, user_id=SEED.reviewer_profile, connection_id=foreign
        )
    with pytest.raises(TokenNotFoundError):
        await svc.revoke_connection(db_session, user_id=SEED.primary_profile, connection_id=pat)

    assert (await _connection(db_session, foreign)).revoked_at is None
    assert (await _connection(db_session, pat)).revoked_at is None


# --------------------------------------------------------------------------- revocation cascade

Revoker = Callable[[], Awaitable[object]]


async def _by_token(db: AsyncSession) -> tuple[UUID, Revoker]:
    _, access, _, connection_id = await _issued(db)
    return connection_id, lambda: svc.revoke_connection_by_token(db, access)


async def _connected_apps(db: AsyncSession) -> tuple[UUID, Revoker]:
    _, _, _, connection_id = await _issued(db)
    return connection_id, lambda: svc.revoke_connection(
        db, user_id=SEED.primary_profile, connection_id=connection_id
    )


async def _re_consent(db: AsyncSession) -> tuple[UUID, Revoker]:
    client_id = await insert_oauth_client(db)
    previous = await insert_oauth_connection(db, user_id=SEED.primary_profile, client_id=client_id)
    request_id = await insert_oauth_request(db, client_id=client_id)
    return previous, lambda: svc.decide_request(
        db, request_id=request_id, user_id=SEED.primary_profile, approve=True, write=False
    )


async def _code_reuse(db: AsyncSession) -> tuple[UUID, Revoker]:
    client_id, code, request_id = await _code(db)
    await svc.exchange_code(db, client_id=str(client_id), code=code)
    connection_id = (await _request(db, request_id)).connection_id
    assert connection_id is not None

    async def reuse() -> None:
        with pytest.raises(TokenError):
            await svc.exchange_code(db, client_id=str(client_id), code=code)

    return connection_id, reuse


async def _refresh_replay(db: AsyncSession) -> tuple[UUID, Revoker]:
    client_id, _, refresh, connection_id = await _issued(db)
    await svc.rotate_refresh(db, client_id=str(client_id), token=refresh)

    async def replay() -> None:
        with pytest.raises(TokenError):
            await svc.rotate_refresh(db, client_id=str(client_id), token=refresh)

    return connection_id, replay


_REVOCATIONS = {
    "revoke_by_token": _by_token,
    "connected_apps": _connected_apps,
    "re_consent": _re_consent,
    "code_reuse": _code_reuse,
    "refresh_replay": _refresh_replay,
}


@pytest.mark.parametrize("path", list(_REVOCATIONS), ids=list(_REVOCATIONS))
async def test_every_connection_revocation_stops_its_agent_batches(
    db_session: AsyncSession, path: str
) -> None:
    connection_id, revoke = await _REVOCATIONS[path](db_session)
    batch_id = await make_agent_batch(
        db_session,
        owner_id=SEED.primary_profile,
        project_id=SEED.primary_project,
        template_id=SEED.primary_template,
        token_id=connection_id,
    )
    assert await batch_halt(db_session, batch_id) == (None, [("queued", None)] * 2)

    await revoke()

    assert (await _connection(db_session, connection_id)).revoked_at is not None
    assert await batch_halt(db_session, batch_id) == (
        "AGENT_TOKEN_INACTIVE",
        [("cancelled", "STOPPED_AGENT_GUARD")] * 2,
    )
