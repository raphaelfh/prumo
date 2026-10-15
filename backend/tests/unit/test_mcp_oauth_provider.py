"""Direct unit tests of the OAuth provider adapter (ADR 0022): each method
opens its own session through ``mcp_session.session_factory``, calls the
service, and commits only writes. Driven directly so its lines register diff
coverage (the httpx ASGITransport path registers none)."""

from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from unittest.mock import AsyncMock, MagicMock
from uuid import UUID

import pytest
from mcp.server.auth.provider import AuthorizationParams
from mcp.shared.auth import OAuthClientInformationFull
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


async def test_register_client_commits_once(db: MagicMock, monkeypatch: pytest.MonkeyPatch) -> None:
    register = AsyncMock(return_value=None)
    monkeypatch.setattr(provider_module.mcp_oauth_service, "register_client", register)

    await PrumoOAuthProvider().register_client(CLIENT)

    register.assert_awaited_once_with(db, CLIENT)
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
