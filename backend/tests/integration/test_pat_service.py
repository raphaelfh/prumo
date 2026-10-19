"""Integration tests for ``app.services.pat_service`` (migration 0078, spec §4.2)."""

from __future__ import annotations

import asyncio
import hashlib
import re
from uuid import uuid4

import pytest
from pydantic import ValidationError
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker

from app.schemas.mcp_auth import McpPrincipal
from app.schemas.personal_access_token import PersonalAccessTokenCreateRequest
from app.services.pat_service import (
    PAT_PREFIX,
    ProjectNotAccessibleError,
    TokenLimitReachedError,
    TokenNotFoundError,
    create_token,
    list_tokens,
    owned_token,
    resolve_principal,
    revoke_owned,
    revoke_token,
    token_is_usable,
    touch_last_used,
)
from tests.integration.conftest import SEED
from tests.integration.helpers.pat_rows import insert_oauth_client, insert_oauth_connection


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
        await owned_token(
            db_session, user_id=SEED.reviewer_profile, token_id=foreign.token.id, kind="pat"
        )
        is None
    )
    assert (
        await owned_token(db_session, user_id=SEED.reviewer_profile, token_id=uuid4(), kind="pat")
        is None
    )

    own = await create_token(db_session, user_id=SEED.reviewer_profile, payload=_req())
    row = await owned_token(
        db_session, user_id=SEED.reviewer_profile, token_id=own.token.id, kind="pat"
    )
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
        scopes=frozenset({"read", "write"}),
        token_expires_at=created.token.expires_at,
        project_ids=None,
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
async def test_ai_run_defaults_to_false(db_session: AsyncSession) -> None:
    created = await create_token(
        db_session, user_id=SEED.reviewer_profile, payload=_req(scope="read_write")
    )

    ai_run = (
        await db_session.execute(
            text("SELECT ai_run FROM public.personal_access_tokens WHERE id = :id"),
            {"id": str(created.token.id)},
        )
    ).scalar_one()
    assert ai_run is False


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("scope", "ai_run", "expected"),
    [
        ("read", False, {"read"}),
        ("read", True, {"read", "ai_run"}),
        ("read_write", False, {"read", "write"}),
        ("read_write", True, {"read", "write", "ai_run"}),
    ],
    ids=["read", "read-ai_run", "read_write", "read_write-ai_run"],
)
async def test_resolve_principal_yields_the_four_scope_sets(
    db_session: AsyncSession, scope: str, ai_run: bool, expected: set[str]
) -> None:
    created = await create_token(
        db_session, user_id=SEED.reviewer_profile, payload=_req(scope=scope)
    )
    await db_session.execute(
        text("UPDATE public.personal_access_tokens SET ai_run = :ai_run WHERE id = :id"),
        {"ai_run": ai_run, "id": str(created.token.id)},
    )

    principal = await resolve_principal(db_session, created.secret)

    assert principal is not None
    assert principal.scopes == frozenset(expected)


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


@pytest.mark.asyncio
async def test_touch_last_used_skips_a_locked_row(_engine: AsyncEngine) -> None:
    Session = async_sessionmaker(_engine, expire_on_commit=False)
    async with Session() as setup:
        created = await create_token(setup, user_id=SEED.outsider_profile, payload=_req())
        await setup.commit()
    token_id = created.token.id

    try:
        async with Session() as holder, Session() as toucher:
            await holder.execute(
                text("SELECT id FROM public.personal_access_tokens WHERE id = :id FOR UPDATE"),
                {"id": str(token_id)},
            )
            assert await asyncio.wait_for(touch_last_used(toucher, token_id), 1) is False
            await toucher.rollback()
            await holder.rollback()

        async with Session() as after:  # the lock released, the throttle still admits it
            assert await touch_last_used(after, token_id) is True
            await after.rollback()
    finally:
        async with Session() as cleanup:
            await cleanup.execute(
                text("DELETE FROM public.personal_access_tokens WHERE id = :id"),
                {"id": str(token_id)},
            )
            await cleanup.commit()


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("update_user", "resolves"),
    [
        ("UPDATE auth.users SET banned_until = now() + interval '1 day' WHERE id = :id", False),
        ("UPDATE auth.users SET deleted_at = now() WHERE id = :id", False),
        ("UPDATE auth.users SET banned_until = now() - interval '1 day' WHERE id = :id", True),
    ],
    ids=["banned", "soft-deleted", "ban-expired"],
)
async def test_resolve_principal_refuses_banned_or_deleted_user(
    db_session: AsyncSession, update_user: str, resolves: bool
) -> None:
    """F8 (final review): a ban or a (soft) delete of the owning user ends
    every PAT at once; revocation stays the per-token kill switch."""
    created = await create_token(db_session, user_id=SEED.reviewer_profile, payload=_req())
    assert await resolve_principal(db_session, created.secret) is not None

    await db_session.execute(text(update_user), {"id": str(SEED.reviewer_profile)})
    assert (await resolve_principal(db_session, created.secret) is not None) is resolves


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("change", "usable"),
    [
        (None, True),
        ("UPDATE public.personal_access_tokens SET revoked_at = now() WHERE id = :tid", False),
        (
            "UPDATE public.personal_access_tokens "
            "SET created_at = now() - interval '2 days', expires_at = now() - interval '1 minute' "
            "WHERE id = :tid",
            False,
        ),
        ("UPDATE auth.users SET banned_until = now() + interval '1 day' WHERE id = :uid", False),
        ("UPDATE auth.users SET deleted_at = now() WHERE id = :uid", False),
    ],
    ids=["active", "revoked", "expired", "banned", "soft-deleted"],
)
async def test_token_is_usable(db_session: AsyncSession, change: str | None, usable: bool) -> None:
    """The dispatcher's credential check shares the /mcp lookup's predicate."""
    created = await create_token(db_session, user_id=SEED.reviewer_profile, payload=_req())
    if change is not None:
        await db_session.execute(
            text(change), {"tid": str(created.token.id), "uid": str(SEED.reviewer_profile)}
        )

    assert await token_is_usable(db_session, created.token.id) is usable
    assert (await resolve_principal(db_session, created.secret) is not None) is usable


@pytest.mark.asyncio
async def test_token_is_usable_is_false_without_a_token(db_session: AsyncSession) -> None:
    assert await token_is_usable(db_session, None) is False
    assert await token_is_usable(db_session, uuid4()) is False


# --- optional per-project restriction ----------------------------------------


async def _token_count(db: AsyncSession, user_id) -> int:
    return (
        await db.execute(
            text("SELECT count(*) FROM public.personal_access_tokens WHERE user_id = :u"),
            {"u": str(user_id)},
        )
    ).scalar_one()


@pytest.mark.asyncio
async def test_create_without_project_ids_is_unrestricted(db_session: AsyncSession) -> None:
    created = await create_token(db_session, user_id=SEED.reviewer_profile, payload=_req())

    assert created.token.project_ids is None
    principal = await resolve_principal(db_session, created.secret)
    assert principal is not None
    assert principal.project_ids is None
    assert principal.reaches(uuid4())


@pytest.mark.asyncio
async def test_create_with_project_ids_restricts_the_principal(db_session: AsyncSession) -> None:
    payload = PersonalAccessTokenCreateRequest(
        name="a-only", scope="read", expires_in_days=30, project_ids=[SEED.primary_project]
    )
    created = await create_token(db_session, user_id=SEED.reviewer_profile, payload=payload)

    assert created.token.project_ids == [SEED.primary_project]
    principal = await resolve_principal(db_session, created.secret)
    assert principal is not None
    assert principal.project_ids == frozenset({SEED.primary_project})
    assert principal.reaches(SEED.primary_project)
    assert not principal.reaches(SEED.secondary_project)
    listed = await list_tokens(db_session, user_id=SEED.reviewer_profile)
    assert next(t for t in listed if t.id == created.token.id).project_ids == [SEED.primary_project]


@pytest.mark.parametrize(
    "project_id",
    [pytest.param(SEED.secondary_project, id="foreign"), pytest.param(uuid4(), id="missing")],
)
@pytest.mark.asyncio
async def test_create_refuses_a_project_the_caller_cannot_reach(
    db_session: AsyncSession, project_id
) -> None:
    before = await _token_count(db_session, SEED.reviewer_profile)
    payload = PersonalAccessTokenCreateRequest(
        name="x",
        scope="read",
        expires_in_days=30,
        project_ids=[SEED.primary_project, project_id],
    )
    with pytest.raises(ProjectNotAccessibleError) as exc:
        await create_token(db_session, user_id=SEED.reviewer_profile, payload=payload)

    assert exc.value.code == "PROJECT_NOT_ACCESSIBLE"
    assert exc.value.status_code == 422
    assert await _token_count(db_session, SEED.reviewer_profile) == before


@pytest.mark.parametrize(
    "project_ids",
    [
        pytest.param([], id="empty"),
        pytest.param([uuid4() for _ in range(21)], id="twenty-one"),
        pytest.param([SEED.primary_project, SEED.primary_project], id="duplicate"),
    ],
)
def test_create_request_rejects_bad_project_ids(project_ids) -> None:
    with pytest.raises(ValidationError):
        PersonalAccessTokenCreateRequest(
            name="x", scope="read", expires_in_days=30, project_ids=project_ids
        )


# --- OAuth connection rows (migration 0083) ----------------------------------


async def _oauth_connection(db: AsyncSession, user_id=SEED.primary_profile):
    client_id = await insert_oauth_client(db)
    return await insert_oauth_connection(db, user_id=user_id, client_id=client_id)


@pytest.mark.asyncio
async def test_oauth_rows_are_not_listed_or_counted(db_session: AsyncSession) -> None:
    oauth_ids = {await _oauth_connection(db_session) for _ in range(10)}
    active_oauth = (
        await db_session.execute(
            text(
                "SELECT count(*) FROM public.personal_access_tokens "
                "WHERE user_id = :u AND kind = 'oauth' AND revoked_at IS NULL"
            ),
            {"u": str(SEED.primary_profile)},
        )
    ).scalar_one()
    assert active_oauth >= 10  # precondition: the cap would bite if OAuth rows counted

    listed = await list_tokens(db_session, user_id=SEED.primary_profile)
    assert oauth_ids.isdisjoint({t.id for t in listed})

    created = await create_token(db_session, user_id=SEED.primary_profile, payload=_req())
    assert created.token.status == "active"


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "insert_sql",
    [
        "INSERT INTO public.personal_access_tokens "
        "(id, user_id, kind, oauth_client_id, name, token_hash, scope, expires_at) "
        "VALUES (gen_random_uuid(), :u, 'oauth', :c, 'x', 'h', 'read', now() + interval '1 day')",
        "INSERT INTO public.personal_access_tokens "
        "(id, user_id, kind, oauth_client_id, name, token_prefix, token_hash, scope, "
        "expires_at) VALUES (gen_random_uuid(), :u, 'pat', :c, 'x', 'prumo_pat_abcdef', 'h', 'read', now() + interval '1 day')",
    ],
    ids=["oauth-with-hash", "pat-with-client"],
)
async def test_kind_shape_check_refuses_mixed_rows(
    db_session: AsyncSession, insert_sql: str
) -> None:
    client_id = await insert_oauth_client(db_session)
    with pytest.raises(Exception, match="ck_personal_access_tokens_kind_shape_check"):
        async with db_session.begin_nested():
            await db_session.execute(
                text(insert_sql), {"u": str(SEED.primary_profile), "c": str(client_id)}
            )


@pytest.mark.asyncio
async def test_owned_token_is_kind_scoped(db_session: AsyncSession) -> None:
    connection_id = await _oauth_connection(db_session)

    assert (
        await owned_token(
            db_session, user_id=SEED.primary_profile, token_id=connection_id, kind="pat"
        )
        is None
    )
    row = await owned_token(
        db_session, user_id=SEED.primary_profile, token_id=connection_id, kind="oauth"
    )
    assert row is not None
    assert row.id == connection_id
    assert row.kind == "oauth"
    for kind in ("pat", "oauth"):
        assert (
            await owned_token(
                db_session, user_id=SEED.reviewer_profile, token_id=connection_id, kind=kind
            )
            is None
        )


@pytest.mark.asyncio
async def test_revoke_token_ignores_oauth_rows(db_session: AsyncSession) -> None:
    connection_id = await _oauth_connection(db_session)

    with pytest.raises(TokenNotFoundError):
        await revoke_token(db_session, user_id=SEED.primary_profile, token_id=connection_id)
    still_active = (
        await db_session.execute(
            text("SELECT revoked_at IS NULL FROM public.personal_access_tokens WHERE id = :id"),
            {"id": str(connection_id)},
        )
    ).scalar_one()
    assert still_active is True


@pytest.mark.asyncio
async def test_revoke_owned_oauth_is_idempotent(db_session: AsyncSession) -> None:
    connection_id = await _oauth_connection(db_session)

    first = await revoke_owned(
        db_session, user_id=SEED.primary_profile, token_id=connection_id, kind="oauth"
    )
    assert first.revoked_at is not None
    # now() is fixed inside the test transaction: backdate the first revocation so a
    # second write (a missing `revoked_at IS NULL` guard) would be visible.
    first_revoked_at = (
        await db_session.execute(
            text(
                "UPDATE public.personal_access_tokens "
                "SET revoked_at = revoked_at - interval '1 hour' WHERE id = :id "
                "RETURNING revoked_at"
            ),
            {"id": str(connection_id)},
        )
    ).scalar_one()
    second = await revoke_owned(
        db_session, user_id=SEED.primary_profile, token_id=connection_id, kind="oauth"
    )
    assert second.id == connection_id
    assert second.revoked_at == first_revoked_at

    with pytest.raises(TokenNotFoundError):
        await revoke_owned(
            db_session, user_id=SEED.reviewer_profile, token_id=connection_id, kind="oauth"
        )
