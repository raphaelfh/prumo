"""Personal access token issuance, listing and revocation (spec §4.2, ADR 0020).

One active predicate (``active_clause``), one ownership guard
(``owned_token``) — both imported by later tasks rather than re-typed. The
cap (``MAX_ACTIVE_TOKENS``) is enforced by locking the caller's own profile
row before counting, so two concurrent creates at the boundary cannot both
observe "9 active" and both succeed; ``expires_at`` is computed in SQL so
``expires_at - created_at`` is exactly ``n`` days regardless of Python-side
clock skew across the request.

Services only ``flush()``/execute; they never commit — the caller (the
``/me/tokens`` endpoints here, the ``/mcp`` bearer lookup in a later task)
commits once per request.
"""

from __future__ import annotations

import hashlib
import secrets
import string
from datetime import timedelta
from typing import Any, Literal, cast
from uuid import UUID

from fastapi import status
from sqlalchemy import (
    ColumnElement,
    and_,
    case,
    column,
    exists,
    func,
    insert,
    or_,
    select,
    table,
    update,
)
from sqlalchemy.engine import CursorResult
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.error_handler import AppError
from app.models.personal_access_token import PersonalAccessToken
from app.models.user import Profile
from app.schemas.mcp_auth import McpPrincipal
from app.schemas.personal_access_token import (
    PersonalAccessTokenCreated,
    PersonalAccessTokenCreateRequest,
    PersonalAccessTokenRead,
    PersonalAccessTokenRefusalCode,
)

PAT_PREFIX = "prumo_pat_"
MAX_ACTIVE_TOKENS = 10
_BASE62 = string.digits + string.ascii_letters
_SECRET_CHARS = 43  # 62**43 > 2**256


class TokenLimitReachedError(AppError):
    def __init__(self) -> None:
        super().__init__(
            code=PersonalAccessTokenRefusalCode.TOKEN_LIMIT_REACHED,
            message=f"{MAX_ACTIVE_TOKENS} active tokens is the limit; revoke one first.",
            status_code=status.HTTP_409_CONFLICT,
        )


class TokenNotFoundError(Exception):
    """Missing and foreign alike (no existence oracle)."""


def hash_secret(secret: str) -> str:
    return hashlib.sha256(secret.encode("utf-8")).hexdigest()


def active_clause() -> ColumnElement[bool]:
    """THE active predicate: used by the cap, the list status and (Task 2b) the /mcp lookup."""
    return and_(
        PersonalAccessToken.revoked_at.is_(None), PersonalAccessToken.expires_at > func.now()
    )


def _new_secret() -> str:
    n = int.from_bytes(secrets.token_bytes(32), "big")
    chars = []
    for _ in range(_SECRET_CHARS):
        n, r = divmod(n, 62)
        chars.append(_BASE62[r])
    return PAT_PREFIX + "".join(chars)


def _read(
    row: PersonalAccessToken, token_status: Literal["active", "expired", "revoked"]
) -> PersonalAccessTokenRead:
    return PersonalAccessTokenRead(
        id=row.id,
        name=row.name,
        token_prefix=row.token_prefix,
        scope=row.scope,
        status=token_status,
        expires_at=row.expires_at,
        last_used_at=row.last_used_at,
        revoked_at=row.revoked_at,
        created_at=row.created_at,
    )


async def owned_token(
    db: AsyncSession, *, user_id: UUID, token_id: UUID
) -> PersonalAccessToken | None:
    """THE token ownership guard: scope in the WHERE clause."""
    return (
        await db.execute(
            select(PersonalAccessToken).where(
                PersonalAccessToken.id == token_id, PersonalAccessToken.user_id == user_id
            )
        )
    ).scalar_one_or_none()


async def create_token(
    db: AsyncSession, *, user_id: UUID, payload: PersonalAccessTokenCreateRequest
) -> PersonalAccessTokenCreated:
    # Lock the caller's profile row first so two concurrent creates cannot both pass the count.
    await db.execute(select(Profile.id).where(Profile.id == user_id).with_for_update())
    active = (
        await db.execute(
            select(func.count())
            .select_from(PersonalAccessToken)
            .where(PersonalAccessToken.user_id == user_id, active_clause())
        )
    ).scalar_one()
    if active >= MAX_ACTIVE_TOKENS:
        raise TokenLimitReachedError()
    secret = _new_secret()
    row = (
        await db.execute(
            insert(PersonalAccessToken)
            .values(
                user_id=user_id,
                name=payload.name,
                token_prefix=secret[: len(PAT_PREFIX) + 6],
                token_hash=hash_secret(secret),
                scope=payload.scope,
                expires_at=func.now() + func.make_interval(0, 0, 0, payload.expires_in_days),
            )
            .returning(PersonalAccessToken)
        )
    ).scalar_one()
    return PersonalAccessTokenCreated(token=_read(row, "active"), secret=secret)


async def list_tokens(db: AsyncSession, *, user_id: UUID) -> list[PersonalAccessTokenRead]:
    status_expr = case(
        (active_clause(), "active"),
        (PersonalAccessToken.revoked_at.is_not(None), "revoked"),
        else_="expired",
    )
    rows = (
        await db.execute(
            select(PersonalAccessToken, status_expr.label("status"))
            .where(PersonalAccessToken.user_id == user_id)
            .order_by(
                case((active_clause(), 0), else_=1),
                PersonalAccessToken.created_at.desc(),
                PersonalAccessToken.id.desc(),
            )
            .limit(50)
        )
    ).all()
    return [
        _read(row, cast("Literal['active', 'expired', 'revoked']", token_status))
        for row, token_status in rows
    ]


async def revoke_token(
    db: AsyncSession, *, user_id: UUID, token_id: UUID
) -> PersonalAccessTokenRead:
    row = await owned_token(db, user_id=user_id, token_id=token_id)
    if row is None:
        raise TokenNotFoundError()
    # id-only WHERE: ownership was proven by owned_token — never re-state user_id here,
    # or check_scope_guards would count a second predicate.
    await db.execute(
        update(PersonalAccessToken)
        .where(PersonalAccessToken.id == row.id, PersonalAccessToken.revoked_at.is_(None))
        .values(revoked_at=func.now())
    )
    await db.refresh(row)
    return _read(row, "revoked")


# Supabase's `auth.users`, which the app does not map: only the two columns
# that end a user's access. A hard delete needs no check -- it cascades
# through `profiles` to the user's tokens.
_auth_users = table(
    "users", column("id"), column("banned_until"), column("deleted_at"), schema="auth"
)


async def resolve_principal(db: AsyncSession, secret: str) -> McpPrincipal | None:
    """The /mcp bearer lookup: active tokens of a user who is neither banned
    nor soft-deleted, by the indexed hash, in one query (ADR 0020)."""
    if not secret.startswith(PAT_PREFIX):
        return None
    user_locked_out = exists().where(
        _auth_users.c.id == PersonalAccessToken.user_id,
        or_(_auth_users.c.banned_until > func.now(), _auth_users.c.deleted_at.is_not(None)),
    )
    row = (
        await db.execute(
            select(PersonalAccessToken).where(
                PersonalAccessToken.token_hash == hash_secret(secret),
                active_clause(),
                ~user_locked_out,
            )
        )
    ).scalar_one_or_none()
    if row is None:
        return None
    return McpPrincipal(
        user_sub=row.user_id, token_id=row.id, scope=row.scope, token_expires_at=row.expires_at
    )


async def touch_last_used(db: AsyncSession, token_id: UUID) -> bool:
    """At most one write per 5 minutes per token; the throttle is in the WHERE clause."""
    result = await db.execute(
        update(PersonalAccessToken)
        .where(
            PersonalAccessToken.id == token_id,
            or_(
                PersonalAccessToken.last_used_at.is_(None),
                PersonalAccessToken.last_used_at < func.now() - timedelta(minutes=5),
            ),
        )
        .values(last_used_at=func.now())
    )
    return cast("CursorResult[Any]", result).rowcount == 1
