"""RLS + privilege probes for ``agent_actions`` (migration 0078).

Backend-only audit table: no PostgREST read/write path. Same shape as
``test_llm_connection_rls.py`` -- API-only, ``deny_all`` policy floor.
"""

from __future__ import annotations

import json
from typing import NamedTuple
from uuid import UUID

import pytest
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import AsyncSession

from tests.integration.conftest import SEED

_TABLE = "public.agent_actions"

_INSERT_ACTION = (
    "INSERT INTO public.agent_actions "
    "(id, project_id, user_id, tool, input, outcome, error_code) "
    "VALUES (gen_random_uuid(), :pid, :uid, 'rls-probe', '{}'::jsonb, 'refused', 'X')"
)


class Outcome(NamedTuple):
    """One statement run under the ``authenticated`` role."""

    rows: int
    error: str | None


async def _attempt(
    db: AsyncSession,
    *,
    user_id: UUID,
    sql: str,
    params: dict[str, str] | None = None,
    regrant_select: bool = False,
) -> Outcome:
    """Run one statement as ``user_id`` under ``authenticated``, then roll back."""
    await db.commit()
    try:
        if regrant_select:
            await db.execute(text(f"GRANT SELECT ON {_TABLE} TO authenticated"))
        await db.execute(
            text("SELECT set_config('request.jwt.claims', :claims, true)"),
            {"claims": json.dumps({"sub": str(user_id), "role": "authenticated"})},
        )
        await db.execute(text("SET LOCAL ROLE authenticated"))
        result = await db.execute(text(sql), params or {})
        rows = result.scalar_one() if result.returns_rows else result.rowcount
        return Outcome(rows=int(rows), error=None)
    except DBAPIError as exc:
        return Outcome(rows=0, error=str(exc.orig))
    finally:
        await db.rollback()


# =================== 1. GRANT layer: no privilege at all ===================


@pytest.mark.asyncio
@pytest.mark.parametrize("role", ["authenticated", "anon"])
@pytest.mark.parametrize("privilege", ["SELECT", "INSERT", "UPDATE", "DELETE"])
async def test_no_privilege_granted(db_session: AsyncSession, role: str, privilege: str) -> None:
    granted = (
        await db_session.execute(
            text("SELECT has_table_privilege(:role, :table, :privilege)"),
            {"role": role, "table": _TABLE, "privilege": privilege},
        )
    ).scalar_one()
    assert granted is False, (
        f"{role} holds {privilege} on {_TABLE} — the audit table "
        "must be API-only (migration 0078 REVOKE did not take effect)"
    )


@pytest.mark.asyncio
async def test_select_denied_by_missing_grant(db_session: AsyncSession) -> None:
    outcome = await _attempt(
        db_session,
        user_id=SEED.primary_profile,
        sql=f"SELECT count(*) FROM {_TABLE}",
    )
    assert outcome.error is not None and "permission denied" in outcome.error, (
        f"a manager JWT read {_TABLE} via PostgREST-shaped SQL (outcome={outcome}); "
        "audit rows must never be client-visible"
    )


@pytest.mark.asyncio
async def test_insert_denied_by_missing_grant(db_session: AsyncSession) -> None:
    outcome = await _attempt(
        db_session,
        user_id=SEED.primary_profile,
        sql=_INSERT_ACTION,
        params={"pid": str(SEED.primary_project), "uid": str(SEED.primary_profile)},
    )
    assert outcome.error is not None and "permission denied" in outcome.error, (
        f"a manager JWT inserted into {_TABLE} directly (outcome={outcome}), "
        "bypassing the audit service"
    )


# =================== 2. POLICY floor: deny_all holds ===================


@pytest.mark.asyncio
async def test_policy_floor_denies_select_even_with_grant(db_session: AsyncSession) -> None:
    await db_session.execute(
        text(_INSERT_ACTION),
        {"pid": str(SEED.primary_project), "uid": str(SEED.primary_profile)},
    )
    owner_count = (await db_session.execute(text(f"SELECT count(*) FROM {_TABLE}"))).scalar_one()
    assert owner_count >= 1, "fixture row must be visible to the table owner"

    outcome = await _attempt(
        db_session,
        user_id=SEED.primary_profile,
        sql=f"SELECT count(*) FROM {_TABLE}",
        regrant_select=True,
    )
    assert outcome == Outcome(rows=0, error=None), (
        f"deny_all is not the floor: with SELECT re-granted, {_TABLE} "
        f"returned rows to a manager JWT (outcome={outcome})"
    )
