"""OAuth for ``/mcp``: the authorization server's domain rules (ADR 0022).

Functions take the caller's session and never commit; they return the SDK's
pydantic types and raise its protocol errors (``RegistrationError``,
``AuthorizeError``, ``TokenError``), which its handlers turn into RFC
6749/7591 responses. The consent functions serve the ``/api/v1/oauth`` routes
instead and raise ``AppError`` subclasses, which the global handler maps.

Clocks: a timestamp is compared on the clock that wrote it. Request and code
times (``expires_at``, ``decided_at``, ``code_expires_at``) are app-clock
(``datetime.now(UTC)``); connection and token times (``expires_at``,
``rotated_at``) and client ``created_at`` are database-clock (``now()``).
"""

from __future__ import annotations

import secrets
from datetime import UTC, datetime, timedelta
from urllib.parse import urlsplit
from uuid import UUID, uuid4

from fastapi import status
from mcp.server.auth.provider import (
    AccessToken,
    AuthorizationCode,
    AuthorizationParams,
    AuthorizeError,
    RefreshToken,
    RegistrationError,
    TokenError,
    construct_redirect_uri,
)
from mcp.shared.auth import OAuthClientInformationFull, OAuthToken
from pydantic import AnyUrl
from sqlalchemy import ColumnElement, and_, delete, exists, func, insert, or_, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.error_handler import AppError, NotFoundError
from app.core.integrity import violates_constraint
from app.models.mcp_oauth import McpOAuthClient, McpOAuthRequest, McpOAuthToken
from app.models.personal_access_token import PersonalAccessToken
from app.schemas.mcp_auth import McpPrincipal
from app.schemas.mcp_oauth import OAuthConsentRefusalCode, OAuthConsentRequestRead
from app.services.pat_service import (
    active_clause,
    hash_secret,
    new_secret,
    revoke_credential,
    user_locked_out,
)

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
# How long an access token is valid; a refresh token lives as long as its connection.
ACCESS_TTL = timedelta(hours=1)
ACCESS_PREFIX = "prumo_oat_"
REFRESH_PREFIX = "prumo_ort_"
DEFAULT_CLIENT_NAME = "MCP client"

_MAX_REDIRECT_URIS = 5
_ALWAYS_GRANTED = "read"
_MAX_CLIENT_NAME = 80
_LOOPBACK_HOSTS = frozenset({"localhost", "127.0.0.1", "::1"})
_UQ_USER_CLIENT = "uq_personal_access_tokens_oauth_user_client"
# Pruning horizons: a client nobody connected, a decided request, a rotated
# refresh token (kept this long so a replay still trips reuse detection).
_UNUSED_CLIENT_TTL = timedelta(hours=24)
_DECIDED_REQUEST_TTL = timedelta(hours=24)
_ROTATED_TOKEN_TTL = timedelta(hours=1)


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


def _client_key(client_id: str) -> UUID | None:
    try:
        return UUID(client_id)
    except ValueError:
        return None


async def get_client(db: AsyncSession, client_id: str) -> OAuthClientInformationFull | None:
    """The registered client, or ``None`` for an unknown or malformed id."""
    key = _client_key(client_id)
    if key is None:
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


async def _update_request(db: AsyncSession, request_id: UUID, **values: object) -> None:
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
        await _update_request(db, request_id, decided_at=now)
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
    await _update_request(
        db,
        request_id,
        decided_at=now,
        user_id=user_id,
        connection_id=connection_id,
        code_hash=hash_secret(code),
        code_expires_at=now + CODE_TTL,
    )
    return construct_redirect_uri(row.redirect_uri, code=code, state=row.state)


# --------------------------------------------------------------------------- tokens


def granted_scopes(scope: str) -> list[str]:
    """A connection's ``scope`` (``read`` / ``read_write``) as OAuth scopes."""
    return list(OAUTH_SCOPES) if scope == "read_write" else [_ALWAYS_GRANTED]


def _invalid_grant() -> TokenError:
    return TokenError("invalid_grant")


async def _active_connection(
    db: AsyncSession, connection_id: UUID, *extra: ColumnElement[bool]
) -> PersonalAccessToken | None:
    return (
        await db.execute(
            select(PersonalAccessToken)
            .where(PersonalAccessToken.id == connection_id, active_clause(), *extra)
            .execution_options(populate_existing=True)
        )
    ).scalar_one_or_none()


async def _issue_pair(
    db: AsyncSession, connection: PersonalAccessToken, *, resource: str
) -> OAuthToken:
    """Mint an access and a refresh token for ``connection``, stored as hashes."""
    access, refresh = new_secret(ACCESS_PREFIX), new_secret(REFRESH_PREFIX)
    await db.execute(
        insert(McpOAuthToken).values(
            [
                {
                    "id": uuid4(),
                    "connection_id": connection.id,
                    "kind": "access",
                    "token_hash": hash_secret(access),
                    "resource": resource,
                    "expires_at": func.now() + ACCESS_TTL,
                },
                {
                    "id": uuid4(),
                    "connection_id": connection.id,
                    "kind": "refresh",
                    "token_hash": hash_secret(refresh),
                    "resource": resource,
                    "expires_at": connection.expires_at,
                },
            ]
        )
    )
    await db.execute(
        update(McpOAuthClient)
        .where(McpOAuthClient.client_id == connection.oauth_client_id)
        .values(last_used_at=func.now())
    )
    return OAuthToken(
        access_token=access,
        token_type="Bearer",
        expires_in=int(ACCESS_TTL.total_seconds()),
        refresh_token=refresh,
        scope=" ".join(granted_scopes(connection.scope)),
    )


async def load_code(db: AsyncSession, *, client_id: str, code: str) -> AuthorizationCode | None:
    """The approved code ``client_id`` holds, or ``None``.

    No expiry or reuse check: the SDK checks expiry, client, redirect URI and
    the PKCE verifier next; reuse is detected in ``exchange_code`` only.
    """
    key = _client_key(client_id)
    if key is None:
        return None
    found = (
        await db.execute(
            select(McpOAuthRequest, PersonalAccessToken.scope)
            .join(PersonalAccessToken, PersonalAccessToken.id == McpOAuthRequest.connection_id)
            .where(McpOAuthRequest.code_hash == hash_secret(code), McpOAuthRequest.client_id == key)
        )
    ).one_or_none()
    if found is None:
        return None
    row, scope = found
    # decide_request writes the hash, its expiry and the user together.
    assert row.code_expires_at is not None and row.user_id is not None
    return AuthorizationCode(
        code=code,
        scopes=granted_scopes(scope),
        expires_at=row.code_expires_at.timestamp(),
        client_id=str(row.client_id),
        code_challenge=row.code_challenge,
        redirect_uri=AnyUrl(row.redirect_uri),
        redirect_uri_provided_explicitly=row.redirect_uri_provided_explicitly,
        resource=row.resource,
        subject=str(row.user_id),
    )


async def exchange_code(db: AsyncSession, *, client_id: str, code: str) -> OAuthToken:
    """Spend a code once for a token pair; ``TokenError("invalid_grant")`` otherwise.

    The request row is locked, so of two concurrent exchanges one issues and
    the other sees the code spent. A spent code presented again revokes the
    connection it minted.
    """
    key = _client_key(client_id)
    row = (
        None
        if key is None
        else (
            await db.execute(
                select(McpOAuthRequest)
                .where(
                    McpOAuthRequest.code_hash == hash_secret(code),
                    McpOAuthRequest.client_id == key,
                )
                .with_for_update()
                .execution_options(populate_existing=True)
            )
        ).scalar_one_or_none()
    )
    if row is None or row.connection_id is None or row.code_expires_at is None:
        raise _invalid_grant()
    if row.code_used_at is not None:
        await revoke_credential(db, row.connection_id)
        raise _invalid_grant()
    now = datetime.now(UTC)
    connection = await _active_connection(db, row.connection_id)
    if connection is None or row.code_expires_at <= now:
        raise _invalid_grant()
    await _update_request(db, row.id, code_used_at=now)
    return await _issue_pair(db, connection, resource=row.resource or settings.mcp_resource_url)


async def load_refresh(db: AsyncSession, *, client_id: str, token: str) -> RefreshToken | None:
    """``client_id``'s refresh token on an active connection, or ``None``.

    A rotated token is still returned: ``rotate_refresh`` detects the reuse.
    """
    key = _client_key(client_id)
    if key is None:
        return None
    found = (
        await db.execute(
            select(McpOAuthToken, PersonalAccessToken)
            .join(PersonalAccessToken, PersonalAccessToken.id == McpOAuthToken.connection_id)
            .where(
                McpOAuthToken.token_hash == hash_secret(token),
                McpOAuthToken.kind == "refresh",
                PersonalAccessToken.oauth_client_id == key,
                active_clause(),
            )
        )
    ).one_or_none()
    if found is None:
        return None
    row, connection = found
    return RefreshToken(
        token=token,
        client_id=str(connection.oauth_client_id),
        # offline_access listed so a refresh repeating it passes the SDK's
        # subset check; it is never echoed back.
        scopes=[*granted_scopes(connection.scope), OFFLINE_ACCESS],
        expires_at=int(row.expires_at.timestamp()),
        resource=row.resource,
        subject=str(connection.user_id),
    )


async def rotate_refresh(db: AsyncSession, *, client_id: str, token: str) -> OAuthToken:
    """Spend a refresh token for a new pair; ``TokenError("invalid_grant")`` otherwise.

    The token row is locked; a token already rotated (a replay, or the loser
    of a concurrent use) revokes its connection.
    """
    row = (
        await db.execute(
            select(McpOAuthToken)
            .where(McpOAuthToken.token_hash == hash_secret(token), McpOAuthToken.kind == "refresh")
            .with_for_update()
            .execution_options(populate_existing=True)
        )
    ).scalar_one_or_none()
    if row is None:
        raise _invalid_grant()
    if row.rotated_at is not None:
        await revoke_credential(db, row.connection_id)
        raise _invalid_grant()
    key = _client_key(client_id)
    connection = (
        None
        if key is None
        else await _active_connection(
            db, row.connection_id, PersonalAccessToken.oauth_client_id == key
        )
    )
    if connection is None:
        raise _invalid_grant()
    await db.execute(
        update(McpOAuthToken).where(McpOAuthToken.id == row.id).values(rotated_at=func.now())
    )
    return await _issue_pair(db, connection, resource=row.resource)


async def _active_access_row(
    db: AsyncSession, secret: str, *extra: ColumnElement[bool]
) -> tuple[McpOAuthToken, PersonalAccessToken] | None:
    """THE lookup of a live access token: unexpired, on an active OAuth connection."""
    found = (
        await db.execute(
            select(McpOAuthToken, PersonalAccessToken)
            .join(PersonalAccessToken, PersonalAccessToken.id == McpOAuthToken.connection_id)
            .where(
                McpOAuthToken.token_hash == hash_secret(secret),
                McpOAuthToken.kind == "access",
                McpOAuthToken.expires_at > func.now(),
                PersonalAccessToken.kind == "oauth",
                active_clause(),
                *extra,
            )
        )
    ).one_or_none()
    if found is None:
        return None
    row, connection = found
    return row, connection


async def load_access(db: AsyncSession, token: str) -> AccessToken | None:
    found = await _active_access_row(db, token)
    if found is None:
        return None
    row, connection = found
    return AccessToken(
        token=token,
        client_id=str(connection.oauth_client_id),
        scopes=granted_scopes(connection.scope),
        expires_at=int(row.expires_at.timestamp()),
        resource=row.resource,
        subject=str(connection.user_id),
    )


async def resolve_principal(db: AsyncSession, secret: str) -> McpPrincipal | None:
    """The ``/mcp`` principal for an access token bound to this server's MCP
    resource, of a user who is neither banned nor soft-deleted; ``None``
    otherwise. ``token_id`` is the connection id, so audit rows, the draft
    label and the per-token limits work as for a PAT."""
    if not secret.startswith(ACCESS_PREFIX):
        return None
    found = await _active_access_row(
        db, secret, McpOAuthToken.resource == settings.mcp_resource_url, ~user_locked_out()
    )
    if found is None:
        return None
    _, connection = found
    return McpPrincipal(
        user_sub=connection.user_id,
        token_id=connection.id,
        scope=connection.scope,
        token_expires_at=connection.expires_at,
        project_ids=None if connection.project_ids is None else frozenset(connection.project_ids),
    )


async def revoke_connection_by_token(db: AsyncSession, token: str) -> None:
    """Revoke the connection an access or refresh token belongs to; unknown is a no-op."""
    connection_id = (
        await db.execute(
            select(McpOAuthToken.connection_id).where(
                McpOAuthToken.token_hash == hash_secret(token)
            )
        )
    ).scalar_one_or_none()
    if connection_id is not None:
        await revoke_credential(db, connection_id)


async def prune(db: AsyncSession) -> None:
    """Delete clients nobody connected after a day (unless a request of theirs
    is still pending), lapsed or day-old decided requests, and expired or
    rotated-over-an-hour tokens."""
    now = datetime.now(UTC)
    await db.execute(
        delete(McpOAuthClient).where(
            McpOAuthClient.created_at < func.now() - _UNUSED_CLIENT_TTL,
            ~exists().where(PersonalAccessToken.oauth_client_id == McpOAuthClient.client_id),
            # A live pending request keeps its client: the cascade would
            # take it from under a user still on the consent page.
            ~exists().where(
                McpOAuthRequest.client_id == McpOAuthClient.client_id,
                McpOAuthRequest.decided_at.is_(None),
                McpOAuthRequest.expires_at > now,
            ),
        )
    )
    await db.execute(
        delete(McpOAuthRequest).where(
            or_(
                and_(McpOAuthRequest.decided_at.is_(None), McpOAuthRequest.expires_at <= now),
                McpOAuthRequest.decided_at < now - _DECIDED_REQUEST_TTL,
            )
        )
    )
    await db.execute(
        delete(McpOAuthToken).where(
            or_(
                McpOAuthToken.expires_at <= func.now(),
                McpOAuthToken.rotated_at < func.now() - _ROTATED_TOKEN_TTL,
            )
        )
    )
