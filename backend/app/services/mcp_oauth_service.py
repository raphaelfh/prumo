"""OAuth for ``/mcp``: the authorization server's domain rules (ADR 0022).

Functions take the caller's session and never commit; they return the SDK's
pydantic types and raise its protocol errors (``RegistrationError``,
``AuthorizeError``), which its handlers turn into RFC 6749/7591 responses.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from urllib.parse import urlsplit
from uuid import UUID, uuid4

from mcp.server.auth.provider import AuthorizationParams, AuthorizeError, RegistrationError
from mcp.shared.auth import OAuthClientInformationFull
from pydantic import AnyUrl
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.mcp_oauth import McpOAuthClient, McpOAuthRequest

# The granting scopes: what a connection can hold (``read`` / ``read_write``).
OAUTH_SCOPES: tuple[str, ...] = ("read", "write")

# A no-op marker: accepted at registration and authorize so hosts that ask for
# refresh tokens by scope can connect; never granted (refresh tokens are always
# issued).
OFFLINE_ACCESS = "offline_access"

# How long a user has to decide on a pending authorization request.
REQUEST_TTL = timedelta(minutes=10)
DEFAULT_CLIENT_NAME = "MCP client"

_MAX_REDIRECT_URIS = 5
_MAX_CLIENT_NAME = 80
_LOOPBACK_HOSTS = frozenset({"localhost", "127.0.0.1", "::1"})


def redirect_uri_allowed(uri: str) -> bool:
    """An allow-listed URI (exact match) or a loopback ``http`` URI on any port.

    Never one carrying user info or a fragment.
    """
    parts = urlsplit(uri)
    if parts.username is not None or parts.password is not None or "#" in uri:
        return False
    if uri in settings.mcp_oauth_redirect_uris_list:
        return True
    return parts.scheme == "http" and parts.hostname in _LOOPBACK_HOSTS


def _refuse(description: str) -> RegistrationError:
    return RegistrationError("invalid_client_metadata", description)


async def register_client(db: AsyncSession, info: OAuthClientInformationFull) -> None:
    """Store a public client; ``RegistrationError`` when its metadata is refused."""
    if info.token_endpoint_auth_method != "none":
        raise _refuse("only public clients may register: token_endpoint_auth_method must be none")
    redirect_uris = [str(uri) for uri in info.redirect_uris or []]
    if not 1 <= len(redirect_uris) <= _MAX_REDIRECT_URIS:
        raise _refuse(f"between 1 and {_MAX_REDIRECT_URIS} redirect_uris are required")
    if not all(redirect_uri_allowed(uri) for uri in redirect_uris):
        raise _refuse("redirect_uris must be an allowed callback or a loopback http URI")
    name = (info.client_name or "").strip()[:_MAX_CLIENT_NAME] or DEFAULT_CLIENT_NAME
    db.add(
        McpOAuthClient(
            client_id=UUID(info.client_id),
            client_name=name,
            redirect_uris=redirect_uris,
            # The SDK applies the default scopes when none was sent; an empty
            # one reaches us as None.
            scope=info.scope or " ".join(OAUTH_SCOPES),
        )
    )
    await db.flush()


async def get_client(db: AsyncSession, client_id: str) -> OAuthClientInformationFull | None:
    """The registered client, or ``None`` for an unknown or malformed id."""
    try:
        key = UUID(client_id)
    except ValueError:
        return None
    row = await db.get(McpOAuthClient, key)
    if row is None:
        return None
    return OAuthClientInformationFull(
        client_id=str(row.client_id),
        client_name=row.client_name,
        redirect_uris=[AnyUrl(uri) for uri in row.redirect_uris],
        scope=row.scope,
        token_endpoint_auth_method="none",
        grant_types=["authorization_code", "refresh_token"],
        response_types=["code"],
        client_id_issued_at=int(row.created_at.timestamp()),
    )


async def create_request(
    db: AsyncSession, *, client: OAuthClientInformationFull, params: AuthorizationParams
) -> UUID:
    """Store a pending authorization request; its id is the consent capability.

    ``AuthorizeError("invalid_target")`` when ``resource`` names another server.
    """
    resource: str | None = None
    if params.resource is not None:
        if params.resource.rstrip("/") != settings.mcp_resource_url:
            raise AuthorizeError("invalid_target", "resource must be this server's MCP endpoint")
        resource = settings.mcp_resource_url
    asked = params.scopes or (client.scope or "").split()
    request_id = uuid4()
    db.add(
        McpOAuthRequest(
            id=request_id,
            client_id=UUID(client.client_id),
            redirect_uri=str(params.redirect_uri),
            redirect_uri_provided_explicitly=params.redirect_uri_provided_explicitly,
            code_challenge=params.code_challenge,
            state=params.state,
            # Granting scopes only, in canonical order: offline_access is never stored.
            requested_scopes=[scope for scope in OAUTH_SCOPES if scope in asked],
            resource=resource,
            expires_at=datetime.now(UTC) + REQUEST_TTL,
        )
    )
    await db.flush()
    return request_id
