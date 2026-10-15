"""HTTP helpers for the OAuth flow tests: register a client, start an
authorization request, read the consent request id back (ADR 0022)."""

from __future__ import annotations

import base64
import hashlib
import secrets
from typing import Any
from urllib.parse import parse_qs, urlsplit
from uuid import UUID

from httpx import AsyncClient, Response

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
