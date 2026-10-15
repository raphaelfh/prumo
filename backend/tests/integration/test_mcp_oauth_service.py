"""The OAuth authorization server's domain rules, called directly on
``db_session`` (ADR 0022): the redirect allow-list, client registration and
lookup, and the pending authorization request."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

import pytest
from mcp.server.auth.provider import AuthorizationParams, AuthorizeError, RegistrationError
from mcp.shared.auth import OAuthClientInformationFull
from pydantic import AnyUrl
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings, settings
from app.models.mcp_oauth import McpOAuthClient, McpOAuthRequest
from app.services import mcp_oauth_service as svc

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
