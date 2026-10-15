"""Direct unit tests of the OAuth provider adapter (ADR 0022): each method
opens its own session through ``mcp_session.session_factory``, calls the
service, and commits only writes. Driven directly so its lines register diff
coverage (the httpx ASGITransport path registers none)."""

from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from unittest.mock import AsyncMock, MagicMock, call
from uuid import UUID

import pytest
from mcp.server.auth.provider import (
    AccessToken,
    AuthorizationCode,
    AuthorizationParams,
    RefreshToken,
    TokenError,
)
from mcp.shared.auth import OAuthClientInformationFull, OAuthToken
from pydantic import AnyUrl

from app.api.mcp import session as mcp_session
from app.api.mcp.oauth import provider as provider_module
from app.api.mcp.oauth.provider import PrumoOAuthProvider
from app.core.config import settings

CLIENT = OAuthClientInformationFull(
    client_id="00000000-0000-4000-8000-000000000001",
    redirect_uris=[AnyUrl("https://claude.ai/api/mcp/auth_callback")],
    token_endpoint_auth_method="none",
)
PARAMS = AuthorizationParams(
    state="st",
    scopes=["read"],
    code_challenge="c",
    redirect_uri=AnyUrl("https://claude.ai/api/mcp/auth_callback"),
    redirect_uri_provided_explicitly=True,
)
REQUEST_ID = UUID("00000000-0000-4000-8000-0000000000aa")
CODE = AuthorizationCode(
    code="the-code",
    scopes=["read"],
    expires_at=0.0,
    client_id=CLIENT.client_id,
    code_challenge="c",
    redirect_uri=AnyUrl("https://claude.ai/api/mcp/auth_callback"),
    redirect_uri_provided_explicitly=True,
)
REFRESH = RefreshToken(token="prumo_ort_x", client_id=CLIENT.client_id, scopes=["read"])
ACCESS = AccessToken(token="prumo_oat_x", client_id=CLIENT.client_id, scopes=["read"])
TOKENS = OAuthToken(access_token="a", token_type="Bearer", expires_in=3600, refresh_token="r")


@pytest.fixture
def db(monkeypatch: pytest.MonkeyPatch) -> MagicMock:
    session = MagicMock()
    session.commit = AsyncMock()

    @asynccontextmanager
    async def factory() -> AsyncIterator[MagicMock]:
        yield session

    monkeypatch.setattr(mcp_session, "session_factory", factory)
    return session


async def test_get_client_reads_without_committing(
    db: MagicMock, monkeypatch: pytest.MonkeyPatch
) -> None:
    get_client = AsyncMock(return_value=CLIENT)
    monkeypatch.setattr(provider_module.mcp_oauth_service, "get_client", get_client)

    found = await PrumoOAuthProvider().get_client("some-id")

    assert found is CLIENT
    get_client.assert_awaited_once_with(db, "some-id")
    db.commit.assert_not_awaited()


async def test_register_client_prunes_after_the_insert_and_commits_once(
    db: MagicMock, monkeypatch: pytest.MonkeyPatch
) -> None:
    calls = MagicMock()
    calls.register = AsyncMock(return_value=None)
    calls.prune = AsyncMock(return_value=None)
    monkeypatch.setattr(provider_module.mcp_oauth_service, "register_client", calls.register)
    monkeypatch.setattr(provider_module.mcp_oauth_service, "prune", calls.prune)

    await PrumoOAuthProvider().register_client(CLIENT)

    assert calls.mock_calls == [call.register(db, CLIENT), call.prune(db)]
    db.commit.assert_awaited_once()


async def test_authorize_commits_and_points_at_consent(
    db: MagicMock, monkeypatch: pytest.MonkeyPatch
) -> None:
    create = AsyncMock(return_value=REQUEST_ID)
    monkeypatch.setattr(provider_module.mcp_oauth_service, "create_request", create)
    monkeypatch.setattr(settings, "PUBLIC_APP_URL", "https://app.example/")

    url = await PrumoOAuthProvider().authorize(CLIENT, PARAMS)

    assert url == f"https://app.example/oauth/consent?request={REQUEST_ID}"
    create.assert_awaited_once_with(db, client=CLIENT, params=PARAMS)
    db.commit.assert_awaited_once()


async def test_load_authorization_code_reads_without_committing(
    db: MagicMock, monkeypatch: pytest.MonkeyPatch
) -> None:
    load = AsyncMock(return_value=CODE)
    monkeypatch.setattr(provider_module.mcp_oauth_service, "load_code", load)

    found = await PrumoOAuthProvider().load_authorization_code(CLIENT, "the-code")

    assert found is CODE
    load.assert_awaited_once_with(db, client_id=CLIENT.client_id, code="the-code")
    db.commit.assert_not_awaited()


async def test_load_refresh_token_reads_without_committing(
    db: MagicMock, monkeypatch: pytest.MonkeyPatch
) -> None:
    load = AsyncMock(return_value=REFRESH)
    monkeypatch.setattr(provider_module.mcp_oauth_service, "load_refresh", load)

    found = await PrumoOAuthProvider().load_refresh_token(CLIENT, "prumo_ort_x")

    assert found is REFRESH
    load.assert_awaited_once_with(db, client_id=CLIENT.client_id, token="prumo_ort_x")
    db.commit.assert_not_awaited()


async def test_load_access_token_reads_without_committing(
    db: MagicMock, monkeypatch: pytest.MonkeyPatch
) -> None:
    load = AsyncMock(return_value=ACCESS)
    monkeypatch.setattr(provider_module.mcp_oauth_service, "load_access", load)

    found = await PrumoOAuthProvider().load_access_token("prumo_oat_x")

    assert found is ACCESS
    load.assert_awaited_once_with(db, "prumo_oat_x")
    db.commit.assert_not_awaited()


async def _exchange_code(provider: PrumoOAuthProvider) -> OAuthToken:
    return await provider.exchange_authorization_code(CLIENT, CODE)


async def _rotate(provider: PrumoOAuthProvider) -> OAuthToken:
    return await provider.exchange_refresh_token(CLIENT, REFRESH, ["read"])


_GRANTS = [
    ("exchange_code", _exchange_code, {"client_id": CLIENT.client_id, "code": "the-code"}),
    ("rotate_refresh", _rotate, {"client_id": CLIENT.client_id, "token": "prumo_ort_x"}),
]


@pytest.mark.parametrize(("service_fn", "grant", "kwargs"), _GRANTS, ids=["code", "refresh"])
async def test_grant_commits_the_issued_pair(
    db: MagicMock, monkeypatch: pytest.MonkeyPatch, service_fn: str, grant, kwargs: dict
) -> None:
    issue = AsyncMock(return_value=TOKENS)
    monkeypatch.setattr(provider_module.mcp_oauth_service, service_fn, issue)

    issued = await grant(PrumoOAuthProvider())

    assert issued is TOKENS
    issue.assert_awaited_once_with(db, **kwargs)
    db.commit.assert_awaited_once()


@pytest.mark.parametrize(("service_fn", "grant", "kwargs"), _GRANTS, ids=["code", "refresh"])
async def test_grant_refusal_commits_then_reraises(
    db: MagicMock, monkeypatch: pytest.MonkeyPatch, service_fn: str, grant, kwargs: dict
) -> None:
    refusal = TokenError("invalid_grant")
    issue = AsyncMock(side_effect=refusal)
    monkeypatch.setattr(provider_module.mcp_oauth_service, service_fn, issue)

    with pytest.raises(TokenError) as caught:
        await grant(PrumoOAuthProvider())

    assert caught.value is refusal
    issue.assert_awaited_once_with(db, **kwargs)
    db.commit.assert_awaited_once()


@pytest.mark.parametrize("token", [ACCESS, REFRESH], ids=["access", "refresh"])
async def test_revoke_token_passes_the_secret_and_commits(
    db: MagicMock, monkeypatch: pytest.MonkeyPatch, token: AccessToken | RefreshToken
) -> None:
    revoke = AsyncMock(return_value=None)
    monkeypatch.setattr(provider_module.mcp_oauth_service, "revoke_connection_by_token", revoke)

    await PrumoOAuthProvider().revoke_token(token)

    revoke.assert_awaited_once_with(db, token.token)
    db.commit.assert_awaited_once()
