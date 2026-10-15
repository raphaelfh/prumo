"""OAuth for ``/mcp``: the authorization server's domain rules (ADR 0022).

Functions take the caller's session and never commit; they return the SDK's
pydantic types and raise its protocol errors (``RegistrationError``,
``AuthorizeError``), which its handlers turn into RFC 6749/7591 responses.
The consent functions serve the ``/api/v1/oauth`` routes instead and raise
``AppError`` subclasses, which the global handler maps.
"""

from __future__ import annotations

import secrets
from datetime import UTC, datetime, timedelta
from urllib.parse import urlsplit
from uuid import UUID, uuid4

from fastapi import status
from mcp.server.auth.provider import (
    AuthorizationParams,
    AuthorizeError,
    RegistrationError,
    construct_redirect_uri,
)
from mcp.shared.auth import OAuthClientInformationFull
from pydantic import AnyUrl
from sqlalchemy import func, insert, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.error_handler import AppError, NotFoundError
from app.core.integrity import violates_constraint
from app.models.mcp_oauth import McpOAuthClient, McpOAuthRequest
from app.models.personal_access_token import PersonalAccessToken
from app.schemas.mcp_oauth import OAuthConsentRefusalCode, OAuthConsentRequestRead
from app.services.pat_service import hash_secret, revoke_credential

# The granting scopes: what a connection can hold (``read`` / ``read_write``).
OAUTH_SCOPES: tuple[str, ...] = ("read", "write")

# A no-op marker: accepted at registration and authorize so hosts that ask for
# refresh tokens by scope can connect; never granted (refresh tokens are always
# issued).
OFFLINE_ACCESS = "offline_access"

# How long a user has to decide on a pending authorization request.
REQUEST_TTL = timedelta(minutes=10)
# How long an approval's authorization code may be exchanged (single use).
CODE_TTL = timedelta(minutes=5)
# How long a connection lives before the user must approve the app again.
CONNECTION_TTL = timedelta(days=90)
DEFAULT_CLIENT_NAME = "MCP client"

_MAX_REDIRECT_URIS = 5
_ALWAYS_GRANTED = "read"
_MAX_CLIENT_NAME = 80
_LOOPBACK_HOSTS = frozenset({"localhost", "127.0.0.1", "::1"})
_UQ_USER_CLIENT = "uq_personal_access_tokens_oauth_user_client"


class ConsentRequestNotFoundError(NotFoundError):
    """Unknown or expired request (or OAuth off): one answer for all three."""

    def __init__(self) -> None:
        super().__init__("OAuth request", message="This request expired or does not exist.")


class ConsentRequestDecidedError(AppError):
    """The request was already approved or denied, or a concurrent approval
    for the same user and app won."""

    def __init__(self) -> None:
        super().__init__(
            code=OAuthConsentRefusalCode.REQUEST_ALREADY_DECIDED,
            message="This request was already answered.",
            status_code=status.HTTP_409_CONFLICT,
        )


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
            # Granting scopes only, in canonical order: read always (the fixed
            # consent box), write when asked; offline_access is never stored.
            requested_scopes=[s for s in OAUTH_SCOPES if s == _ALWAYS_GRANTED or s in asked],
            resource=resource,
            expires_at=datetime.now(UTC) + REQUEST_TTL,
        )
    )
    await db.flush()
    return request_id


async def _undecided_request(db: AsyncSession, request_id: UUID, *, lock: bool) -> McpOAuthRequest:
    """The request, refused when missing, decided or expired — decided first,
    so a reloaded consent page shows the answer rather than "expired".

    The lock covers the request row ONLY (no join): a ``FOR UPDATE`` over the
    client would serialize two approvals for one app on the client row and
    hide the unique-index conflict that ``decide_request`` maps to a 409.
    """
    stmt = (
        select(McpOAuthRequest)
        .where(McpOAuthRequest.id == request_id)
        .execution_options(populate_existing=True)
    )
    if lock:
        stmt = stmt.with_for_update()
    row = (await db.execute(stmt)).scalar_one_or_none()
    if row is None:
        raise ConsentRequestNotFoundError()
    if row.decided_at is not None:
        raise ConsentRequestDecidedError()
    if row.expires_at <= datetime.now(UTC):
        raise ConsentRequestNotFoundError()
    return row


async def _client_name(db: AsyncSession, client_id: UUID) -> str:
    return (
        await db.execute(
            select(McpOAuthClient.client_name).where(McpOAuthClient.client_id == client_id)
        )
    ).scalar_one()


async def get_consent_request(db: AsyncSession, *, request_id: UUID) -> OAuthConsentRequestRead:
    """What the consent page shows for a pending request."""
    row = await _undecided_request(db, request_id, lock=False)
    return OAuthConsentRequestRead(
        client_name=await _client_name(db, row.client_id),
        redirect_host=urlsplit(row.redirect_uri).netloc,
        requested_scopes=list(row.requested_scopes),
        offers_write="write" in row.requested_scopes,
        expires_at=row.expires_at,
    )


async def _record_decision(db: AsyncSession, request_id: UUID, **values: object) -> None:
    # One ORM UPDATE: it also refreshes the request row held by this session.
    await db.execute(
        update(McpOAuthRequest).where(McpOAuthRequest.id == request_id).values(**values)
    )


async def decide_request(
    db: AsyncSession, *, request_id: UUID, user_id: UUID, approve: bool, write: bool
) -> str:
    """Record ``user_id``'s decision; the redirect back to the app.

    A deny redirects with ``error=access_denied``. An approval replaces the
    user's previous connection to the app (one unrevoked per user and app),
    creates the new one and mints a single-use authorization code, stored
    only as its hash. Never commits.
    """
    row = await _undecided_request(db, request_id, lock=True)
    now = datetime.now(UTC)
    if not approve:
        await _record_decision(db, request_id, decided_at=now)
        return construct_redirect_uri(row.redirect_uri, error="access_denied", state=row.state)

    previous = (
        await db.execute(
            select(PersonalAccessToken.id).where(
                PersonalAccessToken.kind == "oauth",
                PersonalAccessToken.user_id == user_id,
                PersonalAccessToken.oauth_client_id == row.client_id,
                PersonalAccessToken.revoked_at.is_(None),
            )
        )
    ).scalar_one_or_none()
    if previous is not None:
        await revoke_credential(db, previous)

    granted = "read_write" if write and "write" in row.requested_scopes else "read"
    name = await _client_name(db, row.client_id)
    try:
        connection_id = (
            await db.execute(
                insert(PersonalAccessToken)
                .values(
                    kind="oauth",
                    user_id=user_id,
                    oauth_client_id=row.client_id,
                    name=name,
                    scope=granted,
                    expires_at=func.now() + CONNECTION_TTL,
                    project_ids=None,
                )
                .returning(PersonalAccessToken.id)
            )
        ).scalar_one()
    except IntegrityError as exc:
        if violates_constraint(exc, _UQ_USER_CLIENT):
            raise ConsentRequestDecidedError() from exc
        raise

    code = secrets.token_urlsafe(32)
    await _record_decision(
        db,
        request_id,
        decided_at=now,
        user_id=user_id,
        connection_id=connection_id,
        code_hash=hash_secret(code),
        code_expires_at=now + CODE_TTL,
    )
    return construct_redirect_uri(row.redirect_uri, code=code, state=row.state)
