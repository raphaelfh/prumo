"""Table-privilege probes for the config tables (migration 0054).

0049 manager-gated the INSERT/UPDATE *policies* on
``extraction_entity_types`` / ``extraction_fields`` and recorded a
residual in its own docstring: ``GRANT ALL ... TO authenticated`` stayed,
so a manager's JWT could still write these tables through PostgREST,
bypassing every endpoint-layer validation. RLS is the security floor, but
the GRANT is what lets the request reach a policy at all. 0054 removes
it now that B-7/B-9 route every config write through manager-gated typed
endpoints.

Two properties, and the second is the regression guard that matters:

1. EFFECT — ``authenticated`` holds neither INSERT nor UPDATE, and a
   PROJECT MANAGER (the one caller 0049's policies still admit) is
   refused with a privilege error rather than an RLS refusal. Asserting
   the message distinguishes the two: both are SQLSTATE 42501.
2. SAFETY — ``authenticated`` still SELECTs both tables. ~10 frontend
   call sites read them straight from PostgREST; a revoke that caught
   SELECT would blank the template-config UI.

Grants are invisible to mocks, so this runs against the real local
Postgres and assumes the DB is at head (>= 0054) — the standard
integration-test contract. Probe shape follows
``test_config_write_rls.py``; the catalogue assertions follow
``test_min_one_manager_exec_grant.py`` (migration 0046).
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
from tests.integration.test_config_write_rls import (
    _INSERT_PROJECT_ENTITY_TYPE,
    _INSERT_PROJECT_FIELD,
)

_TABLES = ("extraction_entity_types", "extraction_fields")


class Outcome(NamedTuple):
    """One statement run under the ``authenticated`` role."""

    rows: int
    error: str | None


async def _attempt(db: AsyncSession, *, user_id: UUID, sql: str, params: dict[str, str]) -> Outcome:
    """Run one statement as ``user_id`` under ``authenticated``, then roll back.

    Unlike ``test_config_write_rls._attempt_write`` this deliberately does
    NOT re-grant: the missing privilege is exactly what is under test.
    ``rows`` is the single returned value for a SELECT, the affected
    rowcount otherwise.
    """
    await db.commit()
    try:
        await db.execute(
            text("SELECT set_config('request.jwt.claims', :claims, true)"),
            {"claims": json.dumps({"sub": str(user_id), "role": "authenticated"})},
        )
        await db.execute(text("SET LOCAL ROLE authenticated"))
        result = await db.execute(text(sql), params)
        rows = result.scalar_one() if result.returns_rows else result.rowcount
        return Outcome(rows=int(rows), error=None)
    except DBAPIError as exc:
        return Outcome(rows=0, error=str(exc.orig))
    finally:
        await db.rollback()


# =================== 1. EFFECT: writes are gone ===================


@pytest.mark.asyncio
@pytest.mark.parametrize("privilege", ["INSERT", "UPDATE"])
@pytest.mark.parametrize("table", _TABLES)
async def test_write_privilege_revoked(
    db_session: AsyncSession, table: str, privilege: str
) -> None:
    granted = (
        await db_session.execute(
            text("SELECT has_table_privilege('authenticated', :table, :privilege)"),
            {"table": f"public.{table}", "privilege": privilege},
        )
    ).scalar_one()
    assert granted is False, (
        f"authenticated still holds {privilege} on public.{table} — a manager "
        "JWT can write the template config straight through PostgREST, around "
        "every endpoint validation (migration 0054 revoke did not take effect)"
    )


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("sql", "params"),
    [
        pytest.param(
            _INSERT_PROJECT_ENTITY_TYPE,
            {"tid": str(SEED.primary_template)},
            id="insert-section",
        ),
        pytest.param(
            "UPDATE public.extraction_entity_types SET label = 'grant-probe' WHERE id = :id",
            {"id": str(SEED.primary_entity_type)},
            id="update-section",
        ),
        pytest.param(
            _INSERT_PROJECT_FIELD,
            {"etid": str(SEED.primary_entity_type)},
            id="insert-field",
        ),
        pytest.param(
            "UPDATE public.extraction_fields SET label = 'grant-probe' WHERE id = :id",
            {"id": str(SEED.primary_field)},
            id="update-field",
        ),
    ],
)
async def test_manager_write_denied_by_missing_grant(
    db_session: AsyncSession, sql: str, params: dict[str, str]
) -> None:
    """The caller 0049's policies still admit — a project manager — is now
    stopped one layer earlier, by the table privilege."""
    outcome = await _attempt(db_session, user_id=SEED.primary_profile, sql=sql, params=params)
    assert outcome.error is not None and "permission denied" in outcome.error, (
        "PostgREST write hole: a manager JWT wrote the template config "
        f"directly (outcome={outcome}), bypassing the typed endpoints"
    )
    assert "row-level security" not in outcome.error, (
        "the refusal came from RLS, not from the missing GRANT — 0054 must "
        f"stop the statement before any policy is consulted (outcome={outcome})"
    )


# =================== 2. SAFETY: the read path survives ===================


@pytest.mark.asyncio
@pytest.mark.parametrize("table", _TABLES)
async def test_select_privilege_kept(db_session: AsyncSession, table: str) -> None:
    granted = (
        await db_session.execute(
            text("SELECT has_table_privilege('authenticated', :table, 'SELECT')"),
            {"table": f"public.{table}"},
        )
    ).scalar_one()
    assert granted is True, (
        f"authenticated lost SELECT on public.{table} — 0054 must revoke "
        "writes only; the frontend reads both tables from PostgREST"
    )


@pytest.mark.asyncio
@pytest.mark.parametrize("table", _TABLES)
async def test_authenticated_can_still_read(db_session: AsyncSession, table: str) -> None:
    """The behavioural half: a real JWT session still gets rows back."""
    outcome = await _attempt(
        db_session,
        user_id=SEED.primary_profile,
        sql=f"SELECT count(*) FROM public.{table}",
        params={},
    )
    assert outcome.error is None, (
        f"reading public.{table} as authenticated failed ({outcome.error}) — "
        "0054 broke the template-config read path"
    )
    assert outcome.rows > 0, (
        f"public.{table} read back 0 rows as authenticated (outcome={outcome}); "
        "the seeded template must stay visible through the SELECT policy"
    )
