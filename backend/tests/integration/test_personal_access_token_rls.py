"""RLS + privilege probes for ``personal_access_tokens`` (migration 0077).

Backend-only table, same posture as ``llm_connections`` (0072): the row
holds a SHA-256 hash of a bearer secret, so ``authenticated`` / ``anon``
hold no privilege at all, and the ``deny_all`` policy is the floor even
if a dashboard GRANT ever restores SELECT. Probe shape mirrors
``test_llm_connection_rls.py``.
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

_TABLE = "public.personal_access_tokens"

_INSERT_TOKEN = (
    "INSERT INTO public.personal_access_tokens "
    "(id, user_id, name, token_prefix, token_hash, scope, expires_at) "
    "VALUES (gen_random_uuid(), :uid, 'rls', 'prumo_pat_abcdef', md5(random()::text), "
    "'read', now() + interval '1 day')"
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
    """Run one statement as ``user_id`` under ``authenticated``, then roll back.

    ``regrant_select=True`` restores the SELECT privilege inside this
    rolled-back transaction so the statement reaches the POLICY — that
    aims the probe at the ``deny_all`` floor instead of the missing
    grant. The default probes the grant layer itself.
    """
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
        f"{role} holds {privilege} on {_TABLE} — the personal-access-token "
        "table must be API-only (migration 0077 REVOKE did not take effect)"
    )


@pytest.mark.asyncio
async def test_select_denied_by_missing_grant(db_session: AsyncSession) -> None:
    """Even the token owner's JWT must not read token rows directly: the
    refusal is a privilege error, never an empty result."""
    outcome = await _attempt(
        db_session,
        user_id=SEED.primary_profile,
        sql=f"SELECT count(*) FROM {_TABLE}",
    )
    assert outcome.error is not None and "permission denied" in outcome.error, (
        f"secrets leak: an authenticated JWT read {_TABLE} via PostgREST-shaped "
        f"SQL (outcome={outcome}); token_hash rows must never be client-visible"
    )


# =================== 2. POLICY floor: deny_all holds ===================


@pytest.mark.asyncio
async def test_policy_floor_denies_select_even_with_grant(db_session: AsyncSession) -> None:
    """If the grant ever comes back (one dashboard click), ``deny_all``
    must still return zero rows — proven against a row that exists."""
    await db_session.execute(
        text(_INSERT_TOKEN),
        {"uid": str(SEED.primary_profile)},
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
        f"returned rows to the owner's JWT (outcome={outcome})"
    )
