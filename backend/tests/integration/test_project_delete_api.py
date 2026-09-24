"""DELETE /api/v1/projects/{id} — the one path that deletes a project.

Same gate order as ``PATCH .../details``: a non-member and a missing project
get the same 404, a member who is not a manager gets 403, and only a manager
deletes. The seed project is used deliberately: it carries articles,
templates and members, so a manager's delete proves the whole graph under it
cascades from the backend role (the test's transaction rolls it back).
"""

from __future__ import annotations

from uuid import UUID, uuid4

import pytest
from httpx import AsyncClient
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from tests.integration.conftest import SEED
from tests.integration.helpers import engine_setup

client_as_manager = engine_setup.client_as_manager
client_as_outsider = engine_setup.client_as_outsider
client_as_reviewer = engine_setup.client_as_reviewer

_URL = "/api/v1/projects/{pid}"


async def _count(db: AsyncSession, table: str, column: str, pid: UUID) -> int:
    return (
        await db.execute(
            text(f"SELECT count(*) FROM public.{table} WHERE {column} = :pid"),  # noqa: S608 — test-local names
            {"pid": str(pid)},
        )
    ).scalar_one()


@pytest.mark.asyncio
async def test_project_delete_gate_order(
    db_session: AsyncSession,
    client_as_manager: AsyncClient,
    client_as_reviewer: AsyncClient,
    client_as_outsider: AsyncClient,
) -> None:
    pid = SEED.primary_project

    reviewer = await client_as_reviewer.delete(_URL.format(pid=pid))
    outsider = await client_as_outsider.delete(_URL.format(pid=pid))
    missing = await client_as_manager.delete(_URL.format(pid=uuid4()))

    assert reviewer.status_code == 403, reviewer.text
    assert outsider.status_code == 404, outsider.text
    assert missing.status_code == 404, missing.text
    assert missing.json()["error"] == outsider.json()["error"]
    assert await _count(db_session, "projects", "id", pid) == 1


@pytest.mark.asyncio
async def test_manager_deletes_the_project_and_its_graph(
    db_session: AsyncSession, client_as_manager: AsyncClient
) -> None:
    pid = SEED.primary_project
    assert await _count(db_session, "articles", "project_id", pid) > 0  # precondition
    assert await _count(db_session, "project_members", "project_id", pid) > 0

    res = await client_as_manager.delete(_URL.format(pid=pid))

    assert res.status_code == 200, res.text
    assert res.json()["data"] == {"id": str(pid)}
    assert await _count(db_session, "projects", "id", pid) == 0
    assert await _count(db_session, "articles", "project_id", pid) == 0
    assert await _count(db_session, "project_members", "project_id", pid) == 0
    await db_session.rollback()
