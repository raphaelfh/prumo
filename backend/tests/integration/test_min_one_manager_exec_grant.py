"""EXECUTE-grant hardening for ``enforce_min_one_manager`` (migration 0046).

Migration 0046 revokes the default ``PUBLIC``/``anon``/``authenticated``
EXECUTE grant on the ``public.enforce_min_one_manager()`` trigger function,
clearing two Supabase advisors ("SECURITY DEFINER function executable by
anon/authenticated"). Grants are invisible to mocks, so these run against the
real local Postgres and assume the DB is at migration head (>= 0046) — the
standard integration-test contract.

Two properties:

1. EFFECT (the migration's RED->GREEN driver) — ``anon`` and ``authenticated``
   no longer hold EXECUTE on the function. ``has_execute`` is True before 0046,
   False after.

2. SAFETY — the guard still fires for an ``authenticated`` caller *despite* the
   revoke. PostgreSQL does not check the invoking role's EXECUTE privilege when
   a trigger fires, so removing the (never-load-bearing) grant cannot disable
   the min-one-manager invariant for real, non-service-role writers. The
   existing ``test_min_one_manager_guard`` suite only exercises the service
   role, which is unaffected by the revoke (it owns the function); this pins
   the actually-revoked role. A permission-denied (SQLSTATE 42501) here instead
   of PM001 would mean the revoke broke enforcement.

Helpers are reused verbatim from ``test_min_one_manager_guard`` (same
cross-test-module import pattern as ``test_reviewer_ready_rls``).
"""

from __future__ import annotations

import json

import pytest
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import AsyncSession

from tests.integration.conftest import SEED
from tests.integration.test_min_one_manager_guard import (
    _delete_project,
    _is_pm001,
    _make_project,
    _make_user,
)


@pytest.mark.asyncio
@pytest.mark.parametrize("role", ["anon", "authenticated"])
async def test_execute_revoked_from_client_role(db_session_real: AsyncSession, role: str) -> None:
    """anon/authenticated must NOT hold EXECUTE on the trigger function."""
    granted = (
        await db_session_real.execute(
            text(
                "SELECT has_function_privilege("
                ":role, 'public.enforce_min_one_manager()', 'EXECUTE')"
            ),
            {"role": role},
        )
    ).scalar_one()
    assert granted is False, (
        f"{role} still holds EXECUTE on public.enforce_min_one_manager() — "
        "migration 0046 revoke did not take effect"
    )


@pytest.mark.asyncio
async def test_guard_still_fires_for_authenticated_after_revoke(
    db_session_real: AsyncSession,
) -> None:
    """An ``authenticated`` sole manager deleting their own row still trips
    PM001 — trigger execution does not require the caller's EXECUTE grant."""
    uid = await _make_user(db_session_real, "authmgr")
    await db_session_real.commit()
    # Creator is a different profile so the project's created_by_id RESTRICT
    # never masks the member-row DELETE path we want to exercise.
    pid, members = await _make_project(db_session_real, [uid], creator=SEED.primary_profile)
    await db_session_real.commit()
    member_id = members[uid]
    try:
        # Act AS the authenticated user, who is this project's sole manager, so
        # the project_members_delete RLS policy (USING is_project_manager)
        # permits the DELETE and it reaches the BEFORE-DELETE guard.
        await db_session_real.execute(
            text("SELECT set_config('request.jwt.claims', :claims, true)"),
            {"claims": json.dumps({"sub": str(uid), "role": "authenticated"})},
        )
        await db_session_real.execute(text("SET LOCAL ROLE authenticated"))
        with pytest.raises(DBAPIError) as ei:
            await db_session_real.execute(
                text("DELETE FROM public.project_members WHERE id = :id"),
                {"id": str(member_id)},
            )
        assert _is_pm001(ei.value), (
            f"expected PM001 (guard fired), got {ei.value.orig!r} — a "
            "permission-denied (42501) would mean the revoke broke the trigger"
        )
    finally:
        # _delete_project rollback()s first, ending the aborted txn and the
        # transaction-local SET ROLE, then removes the project (cascade clears
        # the member row via the guard's carve-out).
        await _delete_project(db_session_real, pid)
        await db_session_real.execute(
            text("DELETE FROM auth.users WHERE id = :id"), {"id": str(uid)}
        )
        await db_session_real.commit()
