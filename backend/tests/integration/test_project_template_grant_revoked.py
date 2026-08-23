"""Table-privilege probes for ``project_extraction_templates`` (migration 0057).

Baseline granted ``ALL`` to ``authenticated`` and manager-gated the four
policies, so a manager JWT could write the table straight through
PostgREST. That routes around every guard the portable-template slice put
in the endpoints — §5.6's kind-scoped sibling deactivation on activate,
and §5.7's "never the active template", "never one referenced by
``extraction_runs`` / ``extraction_instances``", and the template-scoped
``extraction_hitl_configs`` cleanup that has no FK to cascade from. RLS is
the security floor, but the GRANT is what lets the request reach a policy
at all; 0057 removes it now that clone / import / PATCH-active / DELETE
are all manager-gated typed endpoints.

Two properties, and the second is the regression guard that matters:

1. EFFECT — ``authenticated`` holds none of INSERT / UPDATE / DELETE, and
   a PROJECT MANAGER (the one caller the policies still admit) is refused
   with a privilege error rather than an RLS refusal. Asserting the
   message distinguishes the two: both are SQLSTATE 42501.
2. SAFETY — ``authenticated`` still SELECTs the table. Eight frontend call
   sites read it straight from PostgREST; a revoke that caught SELECT
   would blank every template picker.

Grants are invisible to mocks, so this runs against the real local
Postgres and assumes the DB is at head (>= 0057) — the standard
integration-test contract. Shape follows its 0054 sibling,
``test_config_write_grant_revoked.py``, whose ``_attempt`` helper (run one
statement as a real JWT sub under the ``authenticated`` role, then roll
back) is reused rather than duplicated.
"""

from __future__ import annotations

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from tests.integration.conftest import SEED
from tests.integration.test_config_write_grant_revoked import _attempt

_TABLE = "public.project_extraction_templates"

# ``is_active`` defaults to true, which would collide with
# ``uq_one_active_extraction_template_per_project`` on a project that already
# has an active extraction template. Pinning it false keeps a regression
# failing on the GRANT (or on RLS), never on an unrelated index.
_INSERT_TEMPLATE = f"""
    INSERT INTO {_TABLE} (project_id, name, framework, created_by, is_active)
    VALUES (:pid, 'grant-probe', 'CUSTOM', :uid, false)
"""


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
        f"authenticated still holds {privilege} on {_TABLE} — a manager JWT "
        "can create, switch or delete project templates straight through "
        "PostgREST, around the §5.6/§5.7 endpoint guards (migration 0057 "
        "revoke did not take effect)"
    )


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("sql", "params"),
    [
        pytest.param(
            _INSERT_TEMPLATE,
            {"pid": str(SEED.primary_project), "uid": str(SEED.primary_profile)},
            id="insert-template",
        ),
        pytest.param(
            f"UPDATE {_TABLE} SET is_active = true WHERE id = :id",
            {"id": str(SEED.primary_template)},
            id="activate-template",
        ),
        pytest.param(
            f"DELETE FROM {_TABLE} WHERE id = :id",
            {"id": str(SEED.primary_template)},
            id="delete-template",
        ),
    ],
)
async def test_manager_write_denied_by_missing_grant(
    db_session: AsyncSession, sql: str, params: dict[str, str]
) -> None:
    """The caller the policies still admit — a project manager — is now
    stopped one layer earlier, by the table privilege."""
    outcome = await _attempt(db_session, user_id=SEED.primary_profile, sql=sql, params=params)
    assert outcome.error is not None and "permission denied" in outcome.error, (
        "PostgREST write hole: a manager JWT wrote project_extraction_templates "
        f"directly (outcome={outcome}), bypassing the typed endpoints"
    )
    assert "row-level security" not in outcome.error, (
        "the refusal came from RLS, not from the missing GRANT — 0057 must "
        f"stop the statement before any policy is consulted (outcome={outcome})"
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
        f"authenticated lost SELECT on {_TABLE} — 0057 must revoke writes "
        "only; the frontend reads the table from PostgREST"
    )


@pytest.mark.asyncio
async def test_authenticated_can_still_read(db_session: AsyncSession) -> None:
    """The behavioural half: a real JWT session still gets rows back."""
    outcome = await _attempt(
        db_session,
        user_id=SEED.primary_profile,
        sql=f"SELECT count(*) FROM {_TABLE} WHERE project_id = :pid",
        params={"pid": str(SEED.primary_project)},
    )
    assert outcome.error is None, (
        f"reading {_TABLE} as authenticated failed ({outcome.error}) — "
        "0057 broke the template read path"
    )
    assert outcome.rows > 0, (
        f"{_TABLE} read back 0 rows as authenticated (outcome={outcome}); "
        "the seeded template must stay visible through the SELECT policy"
    )
