"""HTTP helpers for the OAuth flow tests: register a client, start an
authorization request, read the consent request id back, approve it, and
exchange, refresh or revoke its tokens (ADR 0022)."""

from __future__ import annotations

import base64
import hashlib
import secrets
from dataclasses import dataclass
from typing import Any
from urllib.parse import parse_qs, urlsplit
from uuid import UUID

from httpx import AsyncClient, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.mcp_oauth import McpOAuthRequest
from app.services.mcp_oauth_service import decide_request
from tests.integration.mcp.conftest import OAUTH_BASE_URL

CLAUDE_CB = "https://claude.ai/api/mcp/auth_callback"
MCP_URL = OAUTH_BASE_URL + "/mcp"


def pkce_pair() -> tuple[str, str]:
    """A PKCE verifier and its S256 challenge."""
    verifier = secrets.token_urlsafe(32)
    digest = hashlib.sha256(verifier.encode("ascii")).digest()
    return verifier, base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")


async def register(
    client: AsyncClient, *, redirect_uris: tuple[str, ...] = (CLAUDE_CB,), **extra: Any
) -> Response:
    return await client.post("/register", json={"redirect_uris": list(redirect_uris), **extra})


async def registered_client_id(client: AsyncClient, **kw: Any) -> str:
    r = await register(client, **kw)
    assert r.status_code == 201, r.text
    return str(r.json()["client_id"])


async def authorize(
    client: AsyncClient,
    client_id: str | None,
    *,
    challenge: str | None,
    redirect_uri: str | None = CLAUDE_CB,
    scope: str | None = None,
    resource: str | None = MCP_URL,
    state: str | None = "st",
    method: str | None = "S256",
) -> Response:
    """GET /authorize; a ``None`` argument is left out of the query string."""
    params = {
        "response_type": "code",
        "client_id": client_id,
        "code_challenge": challenge,
        "code_challenge_method": method,
        "redirect_uri": redirect_uri,
        "scope": scope,
        "resource": resource,
        "state": state,
    }
    return await client.get("/authorize", params={k: v for k, v in params.items() if v is not None})


def consent_request_id(resp: Response) -> UUID:
    query = parse_qs(urlsplit(resp.headers["location"]).query)
    return UUID(query["request"][0])


async def approve(db: AsyncSession, request_id: UUID, user_id: UUID, *, write: bool) -> str:
    """Approve a pending request as ``user_id``; the minted authorization code."""
    url = await decide_request(
        db, request_id=request_id, user_id=user_id, approve=True, write=write
    )
    await db.flush()
    return parse_qs(urlsplit(url).query)["code"][0]


async def exchange(
    client: AsyncClient,
    client_id: str,
    code: str,
    verifier: str,
    redirect_uri: str = CLAUDE_CB,
) -> Response:
    """POST /token with the authorization-code grant."""
    return await client.post(
        "/token",
        data={
            "grant_type": "authorization_code",
            "client_id": client_id,
            "code": code,
            "code_verifier": verifier,
            "redirect_uri": redirect_uri,
        },
    )


async def refresh(
    client: AsyncClient, client_id: str, refresh_token: str, scope: str | None = None
) -> Response:
    """POST /token with the refresh-token grant; ``scope`` only when given."""
    data = {"grant_type": "refresh_token", "client_id": client_id, "refresh_token": refresh_token}
    if scope is not None:
        data["scope"] = scope
    return await client.post("/token", data=data)


async def revoke(client: AsyncClient, client_id: str, token: str) -> Response:
    """POST /revoke as a public client. The SDK's revocation form requires a
    ``client_secret`` field even for public clients, so an empty one is sent."""
    return await client.post(
        "/revoke", data={"client_id": client_id, "token": token, "client_secret": ""}
    )


@dataclass(frozen=True)
class OAuthTokens:
    client_id: str
    access: str
    refresh: str
    connection_id: UUID


async def connect(
    client: AsyncClient, db: AsyncSession, user_id: UUID, *, write: bool = True
) -> OAuthTokens:
    """Register, authorize, approve as ``user_id`` and exchange the code."""
    client_id = await registered_client_id(client)
    verifier, challenge = pkce_pair()
    request_id = consent_request_id(await authorize(client, client_id, challenge=challenge))
    code = await approve(db, request_id, user_id, write=write)
    r = await exchange(client, client_id, code, verifier)
    assert r.status_code == 200, r.text
    body = r.json()
    request = await db.get(McpOAuthRequest, request_id, populate_existing=True)
    assert request is not None and request.connection_id is not None
    return OAuthTokens(
        client_id, body["access_token"], body["refresh_token"], request.connection_id
    )
