"""Minimum-one-manager guard — trigger + heal (migration 0043).

These tests run against the real local Supabase Postgres: the guard is a
``BEFORE UPDATE OF role, project_id OR DELETE`` row trigger on
``project_members`` backed by a ``SECURITY DEFINER`` function, entirely
invisible to mocks. See
``docs/superpowers/specs/2026-07-05-min-one-manager-guard-design.md``.

Fixture choice: ``db_session_real`` throughout. The guard aborts the
offending statement (not the whole session), but several tests need
cross-connection visibility (TOCTOU) or want committed rows they tear down
explicitly; a uniform real-commit fixture keeps setup/teardown honest and
sidesteps SAVEPOINT-plus-error fragility. Every test cleans up by deleting
its *project* (the DB-level ``ON DELETE CASCADE`` removes members through the
trigger's carve-out) — never by deleting member rows directly, which would
itself trip the guard.
"""

from __future__ import annotations

import asyncio
from collections.abc import Sequence
from uuid import UUID, uuid4

import pytest
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from app.core.config import settings
from tests.integration.conftest import SEED

# The heal statement, verbatim from migration 0043's upgrade(). Kept in sync
# by hand; the roundtrip test proves the migration applies, this proves the
# heal's data effect (both promote-existing and insert-missing variants).
_HEAL_SQL = text(
    """
    WITH zero_manager_projects AS (
        SELECT p.id AS project_id, p.created_by_id
        FROM public.projects p
        WHERE NOT EXISTS (
            SELECT 1 FROM public.project_members m
            WHERE m.project_id = p.id AND m.role = 'manager'
        )
    ),
    promoted AS (
        UPDATE public.project_members m
        SET role = 'manager'
        FROM zero_manager_projects z
        WHERE m.project_id = z.project_id
          AND m.user_id = z.created_by_id
        RETURNING m.project_id
    )
    INSERT INTO public.project_members (project_id, user_id, role)
    SELECT z.project_id, z.created_by_id, 'manager'
    FROM zero_manager_projects z
    WHERE z.project_id NOT IN (SELECT project_id FROM promoted)
    ON CONFLICT (project_id, user_id) DO NOTHING;
    """
)


def _is_pm001(exc: BaseException) -> bool:
    """True when a caught DB error carries the custom PM001 SQLSTATE."""
    orig = getattr(exc, "orig", exc)
    # asyncpg surfaces the RAISE's ERRCODE as .sqlstate; be tolerant of pgcode.
    code = getattr(orig, "sqlstate", None) or getattr(orig, "pgcode", None)
    return code == "PM001"


async def _make_project(
    db: AsyncSession,
    manager_ids: Sequence[UUID],
    reviewer_ids: Sequence[UUID] = (),
    *,
    creator: UUID | None = None,
) -> tuple[UUID, dict[UUID, UUID]]:
    """INSERT a fresh project with the given manager/reviewer members.

    Members are inserted (the trigger never fires on INSERT). Returns
    ``(project_id, {user_id: member_id})``. Not committed — caller commits.
    """
    pid = uuid4()
    await db.execute(
        text("INSERT INTO public.projects (id, name, created_by_id) VALUES (:id, :name, :cb)"),
        {"id": str(pid), "name": f"guard-test-{pid}", "cb": str(creator or SEED.primary_profile)},
    )
    members: dict[UUID, UUID] = {}
    for uid in manager_ids:
        mid = uuid4()
        await db.execute(
            text(
                "INSERT INTO public.project_members (id, project_id, user_id, role) "
                "VALUES (:id, :pid, :uid, 'manager')"
            ),
            {"id": str(mid), "pid": str(pid), "uid": str(uid)},
        )
        members[uid] = mid
    for uid in reviewer_ids:
        mid = uuid4()
        await db.execute(
            text(
                "INSERT INTO public.project_members (id, project_id, user_id, role) "
                "VALUES (:id, :pid, :uid, 'reviewer')"
            ),
            {"id": str(mid), "pid": str(pid), "uid": str(uid)},
        )
        members[uid] = mid
    return pid, members


async def _delete_project(db: AsyncSession, *pids: UUID) -> None:
    """Cleanup: DELETE the project(s). The DB cascade removes members through
    the trigger's carve-out (parent gone => guard stands down)."""
    await db.rollback()
    for pid in pids:
        await db.execute(text("DELETE FROM public.projects WHERE id = :pid"), {"pid": str(pid)})
    await db.commit()


async def _make_user(db: AsyncSession, tag: str) -> UUID:
    """Insert an auth.users row + its public.profiles row.

    Locally the ``handle_new_user`` trigger materialises the profile from the
    auth.users insert, but CI's ``supabase_stub.sql`` does NOT carry that
    trigger — so insert the profile explicitly (``ON CONFLICT DO NOTHING``
    no-ops when the trigger already fired). Mirrors the conftest SEED and
    ``test_membership_guards.outsider_user`` fallbacks.
    """
    uid = uuid4()
    email = f"{tag}-{uid}@min-manager-test.local"
    await db.execute(
        text(
            "INSERT INTO auth.users (id, email, instance_id, aud, role) "
            "VALUES (:id, :email, '00000000-0000-0000-0000-000000000000', "
            "'authenticated', 'authenticated')"
        ),
        {"id": str(uid), "email": email},
    )
    await db.execute(
        text(
            "INSERT INTO public.profiles (id, email, full_name) "
            "VALUES (:id, :email, :name) ON CONFLICT (id) DO NOTHING"
        ),
        {"id": str(uid), "email": email, "name": f"Guard test {tag}"},
    )
    return uid


async def _manager_count(db: AsyncSession, pid: UUID) -> int:
    return (
        await db.execute(
            text(
                "SELECT count(*) FROM public.project_members "
                "WHERE project_id = :pid AND role = 'manager'"
            ),
            {"pid": str(pid)},
        )
    ).scalar_one()


# =========================== DELETE path ===========================


@pytest.mark.asyncio
async def test_delete_last_manager_raises(db_session_real: AsyncSession) -> None:
    pid, members = await _make_project(db_session_real, [SEED.primary_profile])
    await db_session_real.commit()
    try:
        with pytest.raises(DBAPIError) as ei:
            await db_session_real.execute(
                text("DELETE FROM public.project_members WHERE id = :id"),
                {"id": str(members[SEED.primary_profile])},
            )
        assert _is_pm001(ei.value), f"expected PM001, got {ei.value.orig!r}"
    finally:
        await _delete_project(db_session_real, pid)


@pytest.mark.asyncio
async def test_delete_manager_with_second_succeeds(db_session_real: AsyncSession) -> None:
    pid, members = await _make_project(
        db_session_real, [SEED.primary_profile, SEED.reviewer_profile]
    )
    await db_session_real.commit()
    try:
        await db_session_real.execute(
            text("DELETE FROM public.project_members WHERE id = :id"),
            {"id": str(members[SEED.primary_profile])},
        )
        await db_session_real.commit()
        assert await _manager_count(db_session_real, pid) == 1
    finally:
        await _delete_project(db_session_real, pid)


# =========================== UPDATE path ===========================


@pytest.mark.asyncio
async def test_demote_last_manager_raises(db_session_real: AsyncSession) -> None:
    pid, members = await _make_project(db_session_real, [SEED.primary_profile])
    await db_session_real.commit()
    try:
        with pytest.raises(DBAPIError) as ei:
            await db_session_real.execute(
                text("UPDATE public.project_members SET role = 'reviewer' WHERE id = :id"),
                {"id": str(members[SEED.primary_profile])},
            )
        assert _is_pm001(ei.value), f"expected PM001, got {ei.value.orig!r}"
    finally:
        await _delete_project(db_session_real, pid)


@pytest.mark.asyncio
async def test_demote_manager_with_second_succeeds(db_session_real: AsyncSession) -> None:
    """UPDATE-path success arm: demoting one of two managers is allowed."""
    pid, members = await _make_project(
        db_session_real, [SEED.primary_profile, SEED.reviewer_profile]
    )
    await db_session_real.commit()
    try:
        await db_session_real.execute(
            text("UPDATE public.project_members SET role = 'reviewer' WHERE id = :id"),
            {"id": str(members[SEED.primary_profile])},
        )
        await db_session_real.commit()
        assert await _manager_count(db_session_real, pid) == 1
    finally:
        await _delete_project(db_session_real, pid)


@pytest.mark.asyncio
async def test_move_sole_manager_to_other_project_raises(
    db_session_real: AsyncSession,
) -> None:
    """Reparenting the sole manager empties its old project => raise."""
    src, members = await _make_project(db_session_real, [SEED.outsider_profile])
    dst, _ = await _make_project(db_session_real, [SEED.primary_profile])
    await db_session_real.commit()
    try:
        with pytest.raises(DBAPIError) as ei:
            await db_session_real.execute(
                text("UPDATE public.project_members SET project_id = :dst WHERE id = :id"),
                {"dst": str(dst), "id": str(members[SEED.outsider_profile])},
            )
        assert _is_pm001(ei.value), f"expected PM001, got {ei.value.orig!r}"
    finally:
        await _delete_project(db_session_real, src, dst)


@pytest.mark.asyncio
async def test_unrelated_column_update_on_sole_manager_succeeds(
    db_session_real: AsyncSession,
) -> None:
    """A permissions-only write on the sole manager must NOT trip the guard
    (the trigger is scoped to ``UPDATE OF role, project_id``)."""
    pid, members = await _make_project(db_session_real, [SEED.primary_profile])
    await db_session_real.commit()
    try:
        await db_session_real.execute(
            text(
                "UPDATE public.project_members SET permissions = '{\"can_export\": true}' "
                "WHERE id = :id"
            ),
            {"id": str(members[SEED.primary_profile])},
        )
        await db_session_real.commit()
        assert await _manager_count(db_session_real, pid) == 1
    finally:
        await _delete_project(db_session_real, pid)


# =========================== cascade carve-out ===========================


@pytest.mark.asyncio
async def test_delete_project_with_one_manager_succeeds(
    db_session_real: AsyncSession,
) -> None:
    """Deleting the project cascades to its lone manager row; the carve-out
    lets it go (the project itself is a legitimate way to reach zero members)."""
    pid, _ = await _make_project(db_session_real, [SEED.primary_profile])
    await db_session_real.commit()
    ok = True
    try:
        await db_session_real.execute(
            text("DELETE FROM public.projects WHERE id = :pid"), {"pid": str(pid)}
        )
        await db_session_real.commit()
        remaining = (
            await db_session_real.execute(
                text("SELECT count(*) FROM public.project_members WHERE project_id = :pid"),
                {"pid": str(pid)},
            )
        ).scalar_one()
        assert remaining == 0
    except Exception:
        ok = False
        raise
    finally:
        if not ok:
            await _delete_project(db_session_real, pid)


# =========================== profile-deletion cascade ===========================


@pytest.mark.asyncio
async def test_delete_sole_manager_profile_raises(db_session_real: AsyncSession) -> None:
    """Deleting a profile that is the sole manager of a live project cascades
    into the guard and raises — intentional (forces reassignment first)."""
    uid = await _make_user(db_session_real, "solemgr")
    await db_session_real.commit()
    # Creator is a DIFFERENT profile (SEED.primary_profile) so deleting ``uid``
    # is not blocked by projects.created_by_id RESTRICT — it must reach the
    # user_id CASCADE into project_members, where the guard fires.
    pid, _ = await _make_project(db_session_real, [uid], creator=SEED.primary_profile)
    await db_session_real.commit()
    try:
        with pytest.raises(DBAPIError) as ei:
            await db_session_real.execute(
                text("DELETE FROM public.profiles WHERE id = :id"), {"id": str(uid)}
            )
        assert _is_pm001(ei.value), f"expected PM001, got {ei.value.orig!r}"
    finally:
        await _delete_project(db_session_real, pid)
        await db_session_real.execute(
            text("DELETE FROM auth.users WHERE id = :id"), {"id": str(uid)}
        )
        await db_session_real.commit()


@pytest.mark.asyncio
async def test_delete_membershipless_profile_succeeds(
    db_session_real: AsyncSession,
) -> None:
    uid = await _make_user(db_session_real, "outsider")
    await db_session_real.commit()
    try:
        await db_session_real.execute(
            text("DELETE FROM public.profiles WHERE id = :id"), {"id": str(uid)}
        )
        await db_session_real.commit()
        gone = (
            await db_session_real.execute(
                text("SELECT count(*) FROM public.profiles WHERE id = :id"), {"id": str(uid)}
            )
        ).scalar_one()
        assert gone == 0
    finally:
        await db_session_real.rollback()
        await db_session_real.execute(
            text("DELETE FROM auth.users WHERE id = :id"), {"id": str(uid)}
        )
        await db_session_real.commit()


# =========================== heal (data migration) ===========================


@pytest.mark.asyncio
async def test_heal_promotes_existing_creator_row(db_session_real: AsyncSession) -> None:
    """Zero-manager project whose creator is already a (non-manager) member:
    the heal promotes that row to manager. Idempotent on re-run."""
    # Build the zero-manager state via INSERT (the trigger never fires on INSERT).
    pid, members = await _make_project(
        db_session_real, [], reviewer_ids=[SEED.outsider_profile], creator=SEED.outsider_profile
    )
    await db_session_real.commit()
    try:
        assert await _manager_count(db_session_real, pid) == 0
        await db_session_real.execute(_HEAL_SQL)
        await db_session_real.commit()
        role = (
            await db_session_real.execute(
                text(
                    "SELECT role FROM public.project_members "
                    "WHERE project_id = :pid AND user_id = :uid"
                ),
                {"pid": str(pid), "uid": str(SEED.outsider_profile)},
            )
        ).scalar_one()
        assert role == "manager"
        # Idempotent: a second heal is a no-op (still exactly one manager row).
        await db_session_real.execute(_HEAL_SQL)
        await db_session_real.commit()
        assert await _manager_count(db_session_real, pid) == 1
    finally:
        await _delete_project(db_session_real, pid)


@pytest.mark.asyncio
async def test_heal_inserts_missing_creator_row(db_session_real: AsyncSession) -> None:
    """Zero-manager project whose creator has no membership row: the heal
    inserts one as manager."""
    pid, _ = await _make_project(db_session_real, [], creator=SEED.outsider_profile)
    await db_session_real.commit()
    try:
        assert await _manager_count(db_session_real, pid) == 0
        await db_session_real.execute(_HEAL_SQL)
        await db_session_real.commit()
        rows = (
            await db_session_real.execute(
                text(
                    "SELECT count(*) FROM public.project_members "
                    "WHERE project_id = :pid AND user_id = :uid AND role = 'manager'"
                ),
                {"pid": str(pid), "uid": str(SEED.outsider_profile)},
            )
        ).scalar_one()
        assert rows == 1
    finally:
        await _delete_project(db_session_real, pid)


# =========================== concurrency (TOCTOU) ===========================


@pytest.mark.asyncio
async def test_concurrent_double_demotion_keeps_one_manager(
    db_session_real: AsyncSession,
) -> None:
    """Two connections concurrently demote the two managers of one project.
    The lock-then-count serializes them: exactly one succeeds, >=1 manager
    remains. Without the FOR UPDATE lock both would pass and reach zero."""
    pid, members = await _make_project(
        db_session_real, [SEED.primary_profile, SEED.reviewer_profile]
    )
    await db_session_real.commit()
    m1 = members[SEED.primary_profile]
    m2 = members[SEED.reviewer_profile]

    engine_a = create_async_engine(settings.async_database_url, echo=False, pool_pre_ping=True)
    engine_b = create_async_engine(settings.async_database_url, echo=False, pool_pre_ping=True)
    SessionA = async_sessionmaker(engine_a, class_=AsyncSession, expire_on_commit=False)
    SessionB = async_sessionmaker(engine_b, class_=AsyncSession, expire_on_commit=False)

    async def _demote(SessionCls: async_sessionmaker[AsyncSession], mid: UUID) -> bool:
        """Demote member ``mid`` in its own transaction; True on success."""
        async with SessionCls() as s:
            try:
                await s.execute(
                    text("UPDATE public.project_members SET role = 'reviewer' WHERE id = :id"),
                    {"id": str(mid)},
                )
                await s.commit()
                return True
            except Exception:
                await s.rollback()
                return False

    try:
        results = await asyncio.gather(
            _demote(SessionA, m1), _demote(SessionB, m2), return_exceptions=False
        )
        # Exactly one demotion succeeds; the invariant (>=1 manager) holds.
        assert results.count(True) == 1, f"expected exactly one success, got {results}"
        assert await _manager_count(db_session_real, pid) >= 1
    finally:
        await engine_a.dispose()
        await engine_b.dispose()
        await _delete_project(db_session_real, pid)
