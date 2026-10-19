"""Personal access token issuance, listing and revocation (spec §4.2, ADR 0020).

The ``personal_access_tokens`` table also holds OAuth connections
(``kind='oauth'``, ADR 0022): list, cap and revoke filter on ``kind``, and
the bearer lookup matches ``token_hash``, which an OAuth row never has, so
no PAT path sees one.

One active predicate (``active_clause``), one ownership guard
(``owned_token``, for both kinds), one revocation write
(``revoke_credential``) — all imported rather than re-typed. The
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
    text,
    update,
)
from sqlalchemy.engine import CursorResult
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.error_handler import AppError
from app.models.personal_access_token import PersonalAccessToken
from app.models.user import Profile
from app.schemas.mcp_auth import McpPrincipal, scope_set
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


class ProjectNotAccessibleError(AppError):
    """A listed project is missing or foreign: one answer for both (no existence oracle)."""

    def __init__(self) -> None:
        super().__init__(
            code=PersonalAccessTokenRefusalCode.PROJECT_NOT_ACCESSIBLE,
            message="A listed project does not exist or you are not a member of it.",
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
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


def status_expr() -> ColumnElement[str]:
    """A credential row's status: ``'active'``, ``'revoked'`` or ``'expired'``."""
    return case(
        (active_clause(), "active"),
        (PersonalAccessToken.revoked_at.is_not(None), "revoked"),
        else_="expired",
    )


# Supabase's `auth.users`, which the app does not map: only the two columns
# that end a user's access. A hard delete needs no check -- it cascades
# through `profiles` to the user's tokens.
_auth_users = table(
    "users", column("id"), column("banned_until"), column("deleted_at"), schema="auth"
)


def user_locked_out() -> ColumnElement[bool]:
    """True when the credential row's user is banned or soft-deleted."""
    return exists().where(
        _auth_users.c.id == PersonalAccessToken.user_id,
        or_(_auth_users.c.banned_until > func.now(), _auth_users.c.deleted_at.is_not(None)),
    )


def usable_clause() -> ColumnElement[bool]:
    """THE usable predicate: an active credential of a user who is not locked out."""
    return and_(active_clause(), ~user_locked_out())


async def token_is_usable(db: AsyncSession, token_id: UUID | None) -> bool:
    """Whether the credential ``token_id`` may still act; ``False`` for ``None``."""
    if token_id is None:
        return False
    return bool(
        await db.scalar(select(exists().where(PersonalAccessToken.id == token_id, usable_clause())))
    )


def new_secret(prefix: str) -> str:
    """``prefix`` + 43 base62 characters (256 bits of entropy)."""
    n = int.from_bytes(secrets.token_bytes(32), "big")
    chars = []
    for _ in range(_SECRET_CHARS):
        n, r = divmod(n, 62)
        chars.append(_BASE62[r])
    return prefix + "".join(chars)


def _read(
    row: PersonalAccessToken, token_status: Literal["active", "expired", "revoked"]
) -> PersonalAccessTokenRead:
    assert row.token_prefix is not None  # a PAT row always has one (kind_shape_check)
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
        project_ids=row.project_ids,
    )


async def owned_token(
    db: AsyncSession, *, user_id: UUID, token_id: UUID, kind: Literal["pat", "oauth"]
) -> PersonalAccessToken | None:
    """THE ownership guard for a credential row — a personal access token or an
    OAuth connection — in its owner: owner and ``kind`` in the WHERE clause."""
    return (
        await db.execute(
            select(PersonalAccessToken).where(
                PersonalAccessToken.id == token_id,
                PersonalAccessToken.user_id == user_id,
                PersonalAccessToken.kind == kind,
            )
        )
    ).scalar_one_or_none()


async def revoke_credential(db: AsyncSession, token_id: UUID) -> None:
    """THE revocation write for a credential row of either kind; idempotent.

    id-only WHERE: the caller has already proven ownership (``owned_token``)
    or holds a capability for the row — never re-state ``user_id`` here, or
    check_scope_guards would count a second predicate.
    """
    await db.execute(
        update(PersonalAccessToken)
        .where(PersonalAccessToken.id == token_id, PersonalAccessToken.revoked_at.is_(None))
        .values(revoked_at=func.now())
    )


async def revoke_owned(
    db: AsyncSession, *, user_id: UUID, token_id: UUID, kind: Literal["pat", "oauth"]
) -> PersonalAccessToken:
    """Revoke the caller's own credential row of ``kind``; missing and foreign
    alike raise ``TokenNotFoundError``."""
    row = await owned_token(db, user_id=user_id, token_id=token_id, kind=kind)
    if row is None:
        raise TokenNotFoundError()
    await revoke_credential(db, row.id)
    await db.refresh(row)
    return row


async def _assert_projects_reachable(
    db: AsyncSession, *, user_id: UUID, project_ids: list[UUID]
) -> None:
    """Every listed project, in one query, through the membership helper RLS uses."""
    reachable = (
        await db.execute(
            text(
                "SELECT count(*) FROM unnest(CAST(:ids AS uuid[])) AS p(id) "
                "WHERE public.is_project_member(p.id, :uid)"
            ),
            {"ids": [str(p) for p in project_ids], "uid": str(user_id)},
        )
    ).scalar_one()
    if reachable != len(project_ids):
        raise ProjectNotAccessibleError()


async def create_token(
    db: AsyncSession, *, user_id: UUID, payload: PersonalAccessTokenCreateRequest
) -> PersonalAccessTokenCreated:
    # Lock the caller's profile row first so two concurrent creates cannot both pass the count.
    await db.execute(select(Profile.id).where(Profile.id == user_id).with_for_update())
    active = (
        await db.execute(
            select(func.count())
            .select_from(PersonalAccessToken)
            .where(
                PersonalAccessToken.user_id == user_id,
                PersonalAccessToken.kind == "pat",
                active_clause(),
            )
        )
    ).scalar_one()
    if active >= MAX_ACTIVE_TOKENS:
        raise TokenLimitReachedError()
    if payload.project_ids is not None:
        await _assert_projects_reachable(db, user_id=user_id, project_ids=payload.project_ids)
    secret = new_secret(PAT_PREFIX)
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
                project_ids=payload.project_ids,
            )
            .returning(PersonalAccessToken)
        )
    ).scalar_one()
    return PersonalAccessTokenCreated(token=_read(row, "active"), secret=secret)


async def list_tokens(db: AsyncSession, *, user_id: UUID) -> list[PersonalAccessTokenRead]:
    rows = (
        await db.execute(
            select(PersonalAccessToken, status_expr().label("status"))
            .where(PersonalAccessToken.user_id == user_id, PersonalAccessToken.kind == "pat")
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
    return _read(await revoke_owned(db, user_id=user_id, token_id=token_id, kind="pat"), "revoked")


async def resolve_principal(db: AsyncSession, secret: str) -> McpPrincipal | None:
    """The /mcp bearer lookup: active tokens of a user who is neither banned
    nor soft-deleted, by the indexed hash, in one query (ADR 0020)."""
    if not secret.startswith(PAT_PREFIX):
        return None
    row = (
        await db.execute(
            select(PersonalAccessToken).where(
                PersonalAccessToken.token_hash == hash_secret(secret),
                usable_clause(),
            )
        )
    ).scalar_one_or_none()
    if row is None:
        return None
    return McpPrincipal(
        user_sub=row.user_id,
        token_id=row.id,
        scopes=scope_set(row.scope, row.ai_run),
        token_expires_at=row.expires_at,
        project_ids=None if row.project_ids is None else frozenset(row.project_ids),
    )


async def touch_last_used(db: AsyncSession, token_id: UUID) -> bool:
    """At most one write per 5 minutes per token; the throttle is in the WHERE clause.

    A row another transaction holds locked (a concurrent revoke or touch) is
    skipped, never waited on: ``False``, as for a throttled row.
    """
    unlocked_due = (
        select(PersonalAccessToken.id)
        .where(
            PersonalAccessToken.id == token_id,
            or_(
                PersonalAccessToken.last_used_at.is_(None),
                PersonalAccessToken.last_used_at < func.now() - timedelta(minutes=5),
            ),
        )
        .with_for_update(skip_locked=True)
    )
    result = await db.execute(
        update(PersonalAccessToken)
        .where(PersonalAccessToken.id.in_(unlocked_due))
        .values(last_used_at=func.now())
    )
    return cast("CursorResult[Any]", result).rowcount == 1
