"""Integration tests for ``app.services.pat_service`` (migration 0077, spec §4.2)."""

from __future__ import annotations

import asyncio
import hashlib
import re
from uuid import uuid4

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker

from app.schemas.mcp_auth import McpPrincipal
from app.schemas.personal_access_token import PersonalAccessTokenCreateRequest
from app.services.pat_service import (
    PAT_PREFIX,
    TokenLimitReachedError,
    TokenNotFoundError,
    create_token,
    list_tokens,
    owned_token,
    resolve_principal,
    revoke_token,
    touch_last_used,
)
from tests.integration.conftest import SEED


def _req(name: str = "t", scope: str = "read", days: int = 30) -> PersonalAccessTokenCreateRequest:
    return PersonalAccessTokenCreateRequest(name=name, scope=scope, expires_in_days=days)  # type: ignore[arg-type]


@pytest.mark.asyncio
async def test_create_stores_only_the_hash(db_session: AsyncSession) -> None:
    created = await create_token(db_session, user_id=SEED.reviewer_profile, payload=_req())

    assert re.fullmatch(r"prumo_pat_[0-9A-Za-z]{43}", created.secret)
    assert created.token.token_prefix == created.secret[:16]

    row_hash = (
        await db_session.execute(
            text("SELECT token_hash FROM public.personal_access_tokens WHERE id = :id"),
            {"id": str(created.token.id)},
        )
    ).scalar_one()
    assert row_hash == hashlib.sha256(created.secret.encode()).hexdigest()

    leak_count = (
        await db_session.execute(
            text(
                "SELECT count(*) FROM public.personal_access_tokens "
                "WHERE token_hash = :s OR name = :s OR token_prefix = :s"
            ),
            {"s": created.secret},
        )
    ).scalar_one()
    assert leak_count == 0

    assert created.token.status == "active"


@pytest.mark.asyncio
async def test_expires_in_days_365_is_exact(db_session: AsyncSession) -> None:
    created = await create_token(db_session, user_id=SEED.reviewer_profile, payload=_req(days=365))

    is_exact = (
        await db_session.execute(
            text(
                "SELECT expires_at - created_at = interval '365 days' "
                "FROM public.personal_access_tokens WHERE id = :id"
            ),
            {"id": str(created.token.id)},
        )
    ).scalar_one()
    assert is_exact is True


@pytest.mark.asyncio
async def test_expired_and_revoked_do_not_count_toward_cap(db_session: AsyncSession) -> None:
    created_tokens = []
    for i in range(10):
        created = await create_token(
            db_session, user_id=SEED.reviewer_profile, payload=_req(name=f"cap-{i}")
        )
        created_tokens.append(created)

    # Age one token into expiry.
    await db_session.execute(
        text(
            "UPDATE public.personal_access_tokens "
            "SET created_at = now() - interval '2 days', expires_at = now() - interval '1 day' "
            "WHERE id = :id"
        ),
        {"id": str(created_tokens[0].token.id)},
    )
    # Revoke another.
    await revoke_token(
        db_session, user_id=SEED.reviewer_profile, token_id=created_tokens[1].token.id
    )

    # 11th create succeeds (only 8 active remain among the first 10).
    eleventh = await create_token(
        db_session, user_id=SEED.reviewer_profile, payload=_req(name="cap-10")
    )
    assert eleventh.token.status == "active"

    # One more push over the cap (9 active now) succeeds, bringing active to 10.
    twelfth = await create_token(
        db_session, user_id=SEED.reviewer_profile, payload=_req(name="cap-11")
    )
    assert twelfth.token.status == "active"

    with pytest.raises(TokenLimitReachedError) as exc_info:
        await create_token(db_session, user_id=SEED.reviewer_profile, payload=_req(name="cap-12"))
    assert exc_info.value.code == "TOKEN_LIMIT_REACHED"
    assert exc_info.value.status_code == 409


@pytest.mark.asyncio
async def test_list_tokens_status_and_order(db_session: AsyncSession) -> None:
    a = await create_token(db_session, user_id=SEED.reviewer_profile, payload=_req(name="A"))
    b = await create_token(db_session, user_id=SEED.reviewer_profile, payload=_req(name="B"))
    c = await create_token(db_session, user_id=SEED.reviewer_profile, payload=_req(name="C"))
    d = await create_token(db_session, user_id=SEED.reviewer_profile, payload=_req(name="D"))
    foreign = await create_token(db_session, user_id=SEED.primary_profile, payload=_req(name="F"))

    await db_session.execute(
        text(
            "UPDATE public.personal_access_tokens SET created_at = now() - interval '4 hours' "
            "WHERE id = :id"
        ),
        {"id": str(a.token.id)},
    )
    await db_session.execute(
        text(
            "UPDATE public.personal_access_tokens SET created_at = now() - interval '3 hours' "
            "WHERE id = :id"
        ),
        {"id": str(b.token.id)},
    )
    await db_session.execute(
        text(
            "UPDATE public.personal_access_tokens SET created_at = now() - interval '2 hours' "
            "WHERE id = :id"
        ),
        {"id": str(c.token.id)},
    )
    await revoke_token(db_session, user_id=SEED.reviewer_profile, token_id=c.token.id)
    await db_session.execute(
        text(
            "UPDATE public.personal_access_tokens "
            "SET created_at = now() - interval '2 days', expires_at = now() - interval '1 day' "
            "WHERE id = :id"
        ),
        {"id": str(d.token.id)},
    )

    rows = await list_tokens(db_session, user_id=SEED.reviewer_profile)
    assert [(t.name, t.status) for t in rows] == [
        ("B", "active"),
        ("A", "active"),
        ("C", "revoked"),
        ("D", "expired"),
    ]
    assert foreign.token.id not in {t.id for t in rows}


@pytest.mark.asyncio
async def test_owned_token_is_none_for_foreign_and_missing(db_session: AsyncSession) -> None:
    foreign = await create_token(db_session, user_id=SEED.primary_profile, payload=_req())

    assert (
        await owned_token(db_session, user_id=SEED.reviewer_profile, token_id=foreign.token.id)
        is None
    )
    assert await owned_token(db_session, user_id=SEED.reviewer_profile, token_id=uuid4()) is None

    own = await create_token(db_session, user_id=SEED.reviewer_profile, payload=_req())
    row = await owned_token(db_session, user_id=SEED.reviewer_profile, token_id=own.token.id)
    assert row is not None
    assert row.id == own.token.id


@pytest.mark.asyncio
async def test_revoke_is_idempotent_and_owner_scoped(db_session: AsyncSession) -> None:
    created = await create_token(db_session, user_id=SEED.reviewer_profile, payload=_req())

    first = await revoke_token(db_session, user_id=SEED.reviewer_profile, token_id=created.token.id)
    second = await revoke_token(
        db_session, user_id=SEED.reviewer_profile, token_id=created.token.id
    )
    assert first.status == "revoked"
    assert second.status == "revoked"
    assert first.revoked_at == second.revoked_at

    foreign = await create_token(db_session, user_id=SEED.primary_profile, payload=_req())
    with pytest.raises(TokenNotFoundError):
        await revoke_token(db_session, user_id=SEED.reviewer_profile, token_id=foreign.token.id)


@pytest.mark.asyncio
async def test_concurrent_creates_at_nine_active_admit_exactly_one(_engine: AsyncEngine) -> None:
    Session = async_sessionmaker(_engine, expire_on_commit=False)

    async with Session() as setup:
        for i in range(9):
            await create_token(setup, user_id=SEED.outsider_profile, payload=_req(name=f"conc-{i}"))
        await setup.commit()

    async def _attempt(name: str) -> str:
        async with Session() as session:
            try:
                await create_token(session, user_id=SEED.outsider_profile, payload=_req(name=name))
                await session.commit()
                return "ok"
            except TokenLimitReachedError:
                await session.rollback()
                return "refused"

    try:
        results = await asyncio.gather(_attempt("conc-9"), _attempt("conc-10"))
        assert sorted(results) == ["ok", "refused"]
    finally:
        async with Session() as cleanup:
            await cleanup.execute(
                text("DELETE FROM public.personal_access_tokens WHERE user_id = :uid"),
                {"uid": str(SEED.outsider_profile)},
            )
            await cleanup.commit()


@pytest.mark.asyncio
async def test_resolve_principal_matches_only_active_well_formed(db_session: AsyncSession) -> None:
    created = await create_token(
        db_session, user_id=SEED.reviewer_profile, payload=_req(scope="read_write")
    )

    principal = await resolve_principal(db_session, created.secret)
    assert principal == McpPrincipal(
        user_sub=SEED.reviewer_profile,
        token_id=created.token.id,
        scope="read_write",
        token_expires_at=created.token.expires_at,
    )

    assert await resolve_principal(db_session, "abc") is None
    assert await resolve_principal(db_session, PAT_PREFIX + "a" * 43) is None

    await revoke_token(db_session, user_id=SEED.reviewer_profile, token_id=created.token.id)
    assert await resolve_principal(db_session, created.secret) is None

    aged = await create_token(db_session, user_id=SEED.reviewer_profile, payload=_req())
    await db_session.execute(
        text(
            "UPDATE public.personal_access_tokens "
            "SET created_at = now() - interval '2 days', expires_at = now() - interval '1 day' "
            "WHERE id = :id"
        ),
        {"id": str(aged.token.id)},
    )
    assert await resolve_principal(db_session, aged.secret) is None


@pytest.mark.asyncio
async def test_touch_last_used_is_throttled(db_session: AsyncSession) -> None:
    created = await create_token(db_session, user_id=SEED.reviewer_profile, payload=_req())

    assert await touch_last_used(db_session, created.token.id) is True
    assert await touch_last_used(db_session, created.token.id) is False

    await db_session.execute(
        text(
            "UPDATE public.personal_access_tokens "
            "SET last_used_at = now() - interval '6 minutes' WHERE id = :id"
        ),
        {"id": str(created.token.id)},
    )
    assert await touch_last_used(db_session, created.token.id) is True
