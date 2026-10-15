"""Shared raw-INSERT helpers for credential rows in tests.

The service layer never inserts a token row directly outside
``pat_service`` (issuance goes through a hash + prefix pipeline the
callers here don't need); tests that only need a row to hang an
``agent_actions.token_id`` or FK-delete case off of use these, instead of
each integration module writing its own raw INSERT. The ``insert_oauth_*``
helpers build the OAuth side (migration 0083): a registered client, a
pending authorization request, a ``kind='oauth'`` connection row and an
access token on it.
"""

from __future__ import annotations

import base64
import hashlib
from collections.abc import Sequence
from datetime import timedelta
from uuid import UUID, uuid4

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.pat_service import hash_secret
from tests.integration.conftest import SEED


async def insert_pat_row(db: AsyncSession, name: str = "audit-probe") -> UUID:
    """Insert a throwaway, valid ``personal_access_tokens`` row and return its id."""
    token_id = uuid4()
    await db.execute(
        text(
            "INSERT INTO public.personal_access_tokens "
            "(id, user_id, name, token_prefix, token_hash, scope, expires_at) "
            "VALUES (:id, :uid, :name, 'prumo_pat_abcdef', :hash, "
            "'read_write', now() + interval '30 days')"
        ),
        {"id": str(token_id), "uid": str(SEED.primary_profile), "name": name, "hash": uuid4().hex},
    )
    return token_id


def _s256(verifier: str) -> str:
    digest = hashlib.sha256(verifier.encode("ascii")).digest()
    return base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")


async def insert_oauth_client(
    db: AsyncSession,
    *,
    client_name: str = "Claude",
    redirect_uris: Sequence[str] = ("https://claude.ai/api/mcp/auth_callback",),
    scope: str = "read write",
    created_at_offset: timedelta = timedelta(0),
) -> UUID:
    """Insert a registered OAuth client; ``created_at = now() - created_at_offset``."""
    client_id = uuid4()
    await db.execute(
        text(
            "INSERT INTO public.mcp_oauth_clients "
            "(client_id, client_name, redirect_uris, scope, created_at) "
            "VALUES (:id, :name, CAST(:uris AS text[]), :scope, now() - CAST(:offset AS interval))"
        ),
        {
            "id": str(client_id),
            "name": client_name,
            "uris": list(redirect_uris),
            "scope": scope,
            "offset": created_at_offset,
        },
    )
    return client_id


async def insert_oauth_request(
    db: AsyncSession,
    *,
    client_id: UUID,
    requested_scopes: Sequence[str] = ("read", "write"),
    expires_in: timedelta = timedelta(minutes=10),
    redirect_uri: str = "https://claude.ai/api/mcp/auth_callback",
    state: str | None = "st",
    code_challenge: str = _s256("v" * 43),
) -> UUID:
    """Insert a pending (undecided) authorization request; ``expires_at = now() + expires_in``."""
    request_id = uuid4()
    await db.execute(
        text(
            "INSERT INTO public.mcp_oauth_requests "
            "(id, client_id, redirect_uri, redirect_uri_provided_explicitly, code_challenge, "
            "state, requested_scopes, expires_at) "
            "VALUES (:id, :cid, :uri, true, :challenge, :state, CAST(:scopes AS text[]), "
            "now() + CAST(:interval AS interval))"
        ),
        {
            "id": str(request_id),
            "cid": str(client_id),
            "uri": redirect_uri,
            "challenge": code_challenge,
            "state": state,
            "scopes": list(requested_scopes),
            "interval": expires_in,
        },
    )
    return request_id


async def insert_oauth_connection(
    db: AsyncSession,
    *,
    user_id: UUID,
    client_id: UUID,
    scope: str = "read_write",
    name: str = "Claude",
    expires_in: timedelta = timedelta(days=90),
) -> UUID:
    """Insert an unrevoked ``kind='oauth'`` credential row (no hash, no prefix)."""
    connection_id = uuid4()
    await db.execute(
        text(
            "INSERT INTO public.personal_access_tokens "
            "(id, user_id, kind, oauth_client_id, name, scope, expires_at) "
            "VALUES (:id, :uid, 'oauth', :cid, :name, :scope, now() + CAST(:interval AS interval))"
        ),
        {
            "id": str(connection_id),
            "uid": str(user_id),
            "cid": str(client_id),
            "name": name,
            "scope": scope,
            "interval": expires_in,
        },
    )
    return connection_id


async def insert_oauth_access_token(
    db: AsyncSession,
    *,
    connection_id: UUID,
    secret: str,
    resource: str,
    expires_in: timedelta = timedelta(hours=1),
) -> UUID:
    """Insert a ``kind='access'`` token row for ``secret`` (stored as its hash)
    on ``connection_id``; ``expires_at = now() + expires_in``."""
    token_id = uuid4()
    await db.execute(
        text(
            "INSERT INTO public.mcp_oauth_tokens "
            "(id, connection_id, kind, token_hash, resource, expires_at) "
            "VALUES (:id, :cid, 'access', :hash, :resource, now() + CAST(:interval AS interval))"
        ),
        {
            "id": str(token_id),
            "cid": str(connection_id),
            "hash": hash_secret(secret),
            "resource": resource,
            "interval": expires_in,
        },
    )
    return token_id
