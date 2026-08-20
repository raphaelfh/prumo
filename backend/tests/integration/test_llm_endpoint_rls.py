"""RLS + privilege probes for ``project_llm_endpoints`` (migration 0055).

The table stores Fernet-encrypted endpoint API keys, so its posture is
stricter than the config tables': API-only, nothing readable from
PostgREST. 0055 ships two layers and this file pins both:

1. GRANT layer — ``authenticated`` / ``anon`` hold NO privilege at all
   (0054's REVOKE pattern, extended to SELECT: unlike the config tables
   there is no frontend read path to preserve — a SELECT would hand out
   ciphertexts). A probe must fail with "permission denied", not with an
   RLS refusal and never with an empty result.
2. POLICY floor — ``deny_all`` (``FOR ALL USING (false)``). A Supabase
   ``GRANT ALL ON ALL TABLES`` is one dashboard click, so the floor test
   re-grants SELECT inside its own rolled-back transaction (the
   ``test_config_write_rls._attempt_write`` rationale) and asserts the
   policy still returns zero rows.

Probe shape follows ``test_config_write_grant_revoked.py`` /
``test_config_write_rls.py``: run as the ``authenticated`` role with a
real JWT sub in the ``request.jwt.claims`` GUC, roll everything back.
The backend's own role owns the table and bypasses RLS — services are
untouched by either layer.
"""

from __future__ import annotations

import json
from typing import NamedTuple
from uuid import UUID, uuid4

import pytest
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import AsyncSession

from tests.integration.conftest import SEED

_TABLE = "public.project_llm_endpoints"

_INSERT_ENDPOINT = (
    "INSERT INTO public.project_llm_endpoints "
    "(id, project_id, label, base_url, created_by) "
    "VALUES (:id, :pid, 'rls-probe', 'https://llm.example.com/v1', :uid)"
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
        f"{role} holds {privilege} on {_TABLE} — the endpoint-secrets table "
        "must be API-only (migration 0055 REVOKE did not take effect)"
    )


@pytest.mark.asyncio
async def test_select_denied_by_missing_grant(db_session: AsyncSession) -> None:
    """Even a project manager's JWT must not read endpoint rows: the
    refusal is a privilege error, never an empty result."""
    outcome = await _attempt(
        db_session,
        user_id=SEED.primary_profile,
        sql=f"SELECT count(*) FROM {_TABLE}",
    )
    assert outcome.error is not None and "permission denied" in outcome.error, (
        f"secrets leak: a manager JWT read {_TABLE} via PostgREST-shaped SQL "
        f"(outcome={outcome}); encrypted_api_key ciphertexts must never be "
        "client-visible"
    )


@pytest.mark.asyncio
async def test_insert_denied_by_missing_grant(db_session: AsyncSession) -> None:
    outcome = await _attempt(
        db_session,
        user_id=SEED.primary_profile,
        sql=_INSERT_ENDPOINT,
        params={
            "id": str(uuid4()),
            "pid": str(SEED.primary_project),
            "uid": str(SEED.primary_profile),
        },
    )
    assert outcome.error is not None and "permission denied" in outcome.error, (
        f"a manager JWT inserted into {_TABLE} directly (outcome={outcome}), "
        "bypassing the typed endpoints and the SSRF guard"
    )


# =================== 2. POLICY floor: deny_all holds ===================


@pytest.mark.asyncio
async def test_policy_floor_denies_select_even_with_grant(db_session: AsyncSession) -> None:
    """If the grant ever comes back (one dashboard click), ``deny_all``
    must still return zero rows — proven against a row that exists."""
    await db_session.execute(
        text(_INSERT_ENDPOINT),
        {
            "id": str(uuid4()),
            "pid": str(SEED.primary_project),
            "uid": str(SEED.primary_profile),
        },
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
