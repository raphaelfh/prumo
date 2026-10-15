"""RLS + privilege probes for the credential tables (migrations 0078, 0083).

``personal_access_tokens`` and the three OAuth tables (``mcp_oauth_clients``,
``mcp_oauth_requests``, ``mcp_oauth_tokens``) are backend-only, same posture
as ``llm_connections`` (0072): their rows hold SHA-256 hashes of bearer
secrets or the state that mints them, so ``authenticated`` / ``anon`` hold
no privilege at all, and the ``deny_all`` policy is the floor even if a
dashboard GRANT ever restores SELECT. Probe shape mirrors
``test_llm_connection_rls.py``.
"""

from __future__ import annotations

import json
from collections.abc import Awaitable, Callable
from typing import NamedTuple
from uuid import UUID, uuid4

import pytest
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import AsyncSession

from tests.integration.conftest import SEED
from tests.integration.helpers.pat_rows import (
    insert_oauth_client,
    insert_oauth_connection,
    insert_oauth_request,
    insert_pat_row,
)


async def _seed_pat(db: AsyncSession) -> None:
    await insert_pat_row(db, name="rls")


async def _seed_oauth_client(db: AsyncSession) -> None:
    await insert_oauth_client(db)


async def _seed_oauth_request(db: AsyncSession) -> None:
    await insert_oauth_request(db, client_id=await insert_oauth_client(db))


async def _seed_oauth_token(db: AsyncSession) -> None:
    connection_id = await insert_oauth_connection(
        db, user_id=SEED.primary_profile, client_id=await insert_oauth_client(db)
    )
    await db.execute(
        text(
            "INSERT INTO public.mcp_oauth_tokens "
            "(id, connection_id, kind, token_hash, resource, expires_at) "
            "VALUES (:id, :cid, 'access', :hash, 'https://api.example/mcp', "
            "now() + interval '1 hour')"
        ),
        {"id": str(uuid4()), "cid": str(connection_id), "hash": uuid4().hex},
    )


_SEEDERS: dict[str, Callable[[AsyncSession], Awaitable[None]]] = {
    "public.personal_access_tokens": _seed_pat,
    "public.mcp_oauth_clients": _seed_oauth_client,
    "public.mcp_oauth_requests": _seed_oauth_request,
    "public.mcp_oauth_tokens": _seed_oauth_token,
}
_TABLES = pytest.mark.parametrize("table", list(_SEEDERS), ids=lambda t: t.split(".")[1])


class Outcome(NamedTuple):
    """One statement run under the ``authenticated`` role."""

    rows: int
    error: str | None


async def _attempt(
    db: AsyncSession,
    *,
    table: str,
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
            await db.execute(text(f"GRANT SELECT ON {table} TO authenticated"))
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
@_TABLES
@pytest.mark.parametrize("role", ["authenticated", "anon"])
@pytest.mark.parametrize("privilege", ["SELECT", "INSERT", "UPDATE", "DELETE"])
async def test_no_privilege_granted(
    db_session: AsyncSession, table: str, role: str, privilege: str
) -> None:
    granted = (
        await db_session.execute(
            text("SELECT has_table_privilege(:role, :table, :privilege)"),
            {"role": role, "table": table, "privilege": privilege},
        )
    ).scalar_one()
    assert granted is False, (
        f"{role} holds {privilege} on {table} — credential tables must be "
        "API-only (the migration's REVOKE did not take effect)"
    )


@pytest.mark.asyncio
@_TABLES
async def test_select_denied_by_missing_grant(db_session: AsyncSession, table: str) -> None:
    """Even the token owner's JWT must not read credential rows directly: the
    refusal is a privilege error, never an empty result."""
    outcome = await _attempt(
        db_session,
        table=table,
        user_id=SEED.primary_profile,
        sql=f"SELECT count(*) FROM {table}",
    )
    assert outcome.error is not None and "permission denied" in outcome.error, (
        f"secrets leak: an authenticated JWT read {table} via PostgREST-shaped "
        f"SQL (outcome={outcome}); token_hash rows must never be client-visible"
    )


# =================== 2. POLICY floor: deny_all holds ===================


@pytest.mark.asyncio
@_TABLES
async def test_policy_floor_denies_select_even_with_grant(
    db_session: AsyncSession, table: str
) -> None:
    """If the grant ever comes back (one dashboard click), ``deny_all``
    must still return zero rows — proven against a row that exists."""
    await _SEEDERS[table](db_session)
    owner_count = (await db_session.execute(text(f"SELECT count(*) FROM {table}"))).scalar_one()
    assert owner_count >= 1, "fixture row must be visible to the table owner"

    outcome = await _attempt(
        db_session,
        table=table,
        user_id=SEED.primary_profile,
        sql=f"SELECT count(*) FROM {table}",
        regrant_select=True,
    )
    assert outcome == Outcome(rows=0, error=None), (
        f"deny_all is not the floor: with SELECT re-granted, {table} "
        f"returned rows to the owner's JWT (outcome={outcome})"
    )
