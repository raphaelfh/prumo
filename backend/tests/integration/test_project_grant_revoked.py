"""Table-privilege probes for ``projects`` (migration 0077).

Baseline granted ``ALL`` to ``authenticated`` behind manager-gated RLS, so a
manager JWT could ``PATCH`` / ``DELETE /rest/v1/projects`` directly, around
``PATCH /projects/{id}/details`` (typed whitelist, ``expected``
precondition) and ``DELETE /projects/{id}``. 0077 removes the writes.

Three properties:

1. EFFECT — ``authenticated`` holds none of INSERT / UPDATE / DELETE, and a
   PROJECT MANAGER (the one caller the policies still admit) is refused by
   the missing privilege, not by RLS. Both are SQLSTATE 42501, so the
   message is what tells them apart.
2. SAFETY, reads — ``authenticated`` still SELECTs its own project: the
   Settings load, the hub and the project view read it through PostgREST.
3. SAFETY, create — ``create_project_with_member`` (SECURITY DEFINER, the
   only client create path) still creates a project for an
   ``authenticated`` caller.

Grants are invisible to mocks, so this runs against the real local Postgres
at head. ``_attempt`` (one statement as a real JWT sub under
``authenticated``, then rolled back) is reused from the 0054 sibling.
"""

from __future__ import annotations

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from tests.integration.conftest import SEED
from tests.integration.test_config_write_grant_revoked import _attempt

_TABLE = "public.projects"


# =================== 1. EFFECT: writes are gone ===================


@pytest.mark.asyncio
@pytest.mark.parametrize("privilege", ["INSERT", "UPDATE", "DELETE"])
async def test_write_privilege_revoked(db_session: AsyncSession, privilege: str) -> None:
    granted = (
        await db_session.execute(
            text("SELECT has_table_privilege('authenticated', :table, :privilege)"),
            {"table": _TABLE, "privilege": privilege},
        )
    ).scalar_one()
    assert granted is False, (
        f"authenticated still holds {privilege} on {_TABLE} — a manager JWT can "
        "write projects straight through PostgREST, around PATCH .../details and "
        "DELETE /projects/{id} (migration 0077 revoke did not take effect)"
    )


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("sql", "params"),
    [
        pytest.param(
            f"INSERT INTO {_TABLE} (name, created_by_id) VALUES ('grant-probe', :uid)",
            {"uid": str(SEED.primary_profile)},
            id="insert-project",
        ),
        pytest.param(
            f"UPDATE {_TABLE} SET description = 'grant-probe' WHERE id = :pid",
            {"pid": str(SEED.primary_project)},
            id="update-details",
        ),
        pytest.param(
            f"UPDATE {_TABLE} SET settings = '{{}}'::jsonb WHERE id = :pid",
            {"pid": str(SEED.primary_project)},
            id="update-settings",
        ),
        pytest.param(
            f"DELETE FROM {_TABLE} WHERE id = :pid",
            {"pid": str(SEED.primary_project)},
            id="delete-project",
        ),
    ],
)
async def test_manager_write_denied_by_missing_grant(
    db_session: AsyncSession, sql: str, params: dict[str, str]
) -> None:
    """The caller the policies still admit — the project's manager — is now
    stopped one layer earlier, by the table privilege."""
    outcome = await _attempt(db_session, user_id=SEED.primary_profile, sql=sql, params=params)
    assert outcome.error is not None and "permission denied" in outcome.error, (
        "PostgREST write hole: a manager JWT wrote public.projects directly "
        f"(outcome={outcome}), bypassing the typed endpoints"
    )
    assert "row-level security" not in outcome.error, (
        "the refusal came from RLS, not from the missing GRANT — 0077 must stop "
        f"the statement before any policy is consulted (outcome={outcome})"
    )


# =================== 2. SAFETY: the read path survives ===================


@pytest.mark.asyncio
async def test_select_privilege_kept(db_session: AsyncSession) -> None:
    granted = (
        await db_session.execute(
            text("SELECT has_table_privilege('authenticated', :table, 'SELECT')"),
            {"table": _TABLE},
        )
    ).scalar_one()
    assert granted is True, (
        f"authenticated lost SELECT on {_TABLE} — 0077 must revoke writes only; "
        "the frontend reads projects from PostgREST"
    )


@pytest.mark.asyncio
async def test_member_can_still_read_its_project(db_session: AsyncSession) -> None:
    outcome = await _attempt(
        db_session,
        user_id=SEED.primary_profile,
        sql=f"SELECT count(*) FROM {_TABLE} WHERE id = :pid",
        params={"pid": str(SEED.primary_project)},
    )
    assert outcome == (1, None), (
        f"reading {_TABLE} as its manager returned {outcome} — 0077 broke the "
        "project read path (expected the one seeded row through project_select)"
    )


# =================== 3. SAFETY: the create RPC survives ===================


@pytest.mark.asyncio
async def test_create_rpc_still_creates_a_project(db_session: AsyncSession) -> None:
    """SECURITY DEFINER runs the INSERT as the function owner, not the caller."""
    outcome = await _attempt(
        db_session,
        user_id=SEED.outsider_profile,
        # One call in a subquery: in a WHERE clause the volatile RPC would run per row.
        sql=(
            "SELECT count(*) FROM (SELECT public.create_project_with_member('grant-probe') AS id) p "
            "WHERE p.id IS NOT NULL"
        ),
        params={},
    )
    assert outcome == (1, None), (
        f"create_project_with_member failed for an authenticated caller ({outcome}) "
        "— 0077 must leave the RPC create path working"
    )
