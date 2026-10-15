"""The OAuth authorization server's domain rules, called directly on
``db_session`` (ADR 0022): the redirect allow-list, client registration and
lookup, the pending authorization request and the consent decision."""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime, timedelta
from typing import Any
from urllib.parse import parse_qs, urlsplit
from uuid import UUID, uuid4

import pytest
from mcp.server.auth.provider import AuthorizationParams, AuthorizeError, RegistrationError
from mcp.shared.auth import OAuthClientInformationFull
from pydantic import AnyUrl
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker

from app.core.config import Settings, settings
from app.models.mcp_oauth import McpOAuthClient, McpOAuthRequest
from app.models.personal_access_token import PersonalAccessToken
from app.services import mcp_oauth_service as svc
from tests.integration.conftest import SEED
from tests.integration.helpers.pat_rows import (
    insert_oauth_client,
    insert_oauth_connection,
    insert_oauth_request,
)

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
