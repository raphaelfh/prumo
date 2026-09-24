"""Per-tool BOLA cases (spec §3 choke point already proves membership; this
file proves each real tool actually answers NOT_FOUND, not just the probes
in test_mcp_choke_point.py). Task 6a starts the table; each later tool task
adds its own rows."""

from __future__ import annotations

from uuid import uuid4

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from tests.integration.conftest import SEED
from tests.integration.mcp.tool_calls import call_tool, error_payload

BOLA_CASES = [
    pytest.param(
        "pat_outsider_rw",
        "get_project",
        {"project_id": str(SEED.primary_project)},
        "NOT_FOUND",
        id="get_project-outsider-on-foreign-project",
    ),
    pytest.param(
        "pat_primary_rw",
        "get_project",
        {"project_id": str(uuid4())},
        "NOT_FOUND",
        id="get_project-random-uuid",
    ),
]


@pytest.mark.parametrize(("pat_fixture", "tool", "arguments", "expected_code"), BOLA_CASES)
async def test_bola_returns_expected_code(
    mcp_client,
    pat_outsider_rw,
    pat_primary_rw,
    pat_fixture: str,
    tool: str,
    arguments: dict,
    expected_code: str,
) -> None:
    # Not request.getfixturevalue: resolving an async (pytest_asyncio) fixture
    # that way from inside an already-running async test raises "Runner.run()
    # cannot be called from a running event loop" in this repo's pytest-asyncio
    # setup. The PATs the table's rows name are requested as ordinary fixture
    # args instead, and selected here by name.
    pats = {"pat_outsider_rw": pat_outsider_rw, "pat_primary_rw": pat_primary_rw}
    result = await call_tool(mcp_client, pats[pat_fixture], tool, arguments)
    assert error_payload(result)["code"] == expected_code


async def test_get_project_not_found_after_membership_removed(
    mcp_client, pat_reviewer_rw, db_session: AsyncSession
) -> None:
    await db_session.execute(
        text("DELETE FROM public.project_members WHERE project_id = :p AND user_id = :u"),
        {"p": str(SEED.primary_project), "u": str(SEED.reviewer_profile)},
    )
    result = await call_tool(
        mcp_client, pat_reviewer_rw, "get_project", {"project_id": str(SEED.primary_project)}
    )
    assert error_payload(result)["code"] == "NOT_FOUND"
