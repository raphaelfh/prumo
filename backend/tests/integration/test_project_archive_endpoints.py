"""PATCH /api/v1/projects/{id}/archive — auth, round-trip, and the flag.

The auth assertions are the point of this file. The column behind this route is
governed by the manager-only ``project_update`` RLS policy
(``backend/alembic/versions/baseline_v1.sql:2835``) and the API must not be
looser than it. The guard answers 403 for a non-member AND for a project that
does not exist, so the route is not an existence oracle.
"""

from __future__ import annotations

from uuid import UUID, uuid4

import pytest
from httpx import AsyncClient
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.project_archive import ProjectNotFoundError, set_project_archived
from tests.integration.conftest import SEED
from tests.integration.helpers import engine_setup

# Re-bound at module level (the repo's idiom for borrowing fixtures) so pytest
# collects them here; a ``from ... import`` would be shadowed by the test
# parameters and trip F811.
client_as_manager = engine_setup.client_as_manager
client_as_outsider = engine_setup.client_as_outsider
client_as_reviewer = engine_setup.client_as_reviewer

_URL = "/api/v1/projects/{pid}/archive"


async def _is_active(db: AsyncSession, project_id: UUID) -> bool:
    return bool(
        (
            await db.execute(
                text("SELECT is_active FROM public.projects WHERE id = :pid"),
                {"pid": str(project_id)},
            )
        ).scalar_one()
    )


@pytest.mark.asyncio
async def test_a_manager_archives_and_restores(
    db_session: AsyncSession, client_as_manager: AsyncClient
) -> None:
    archived = await client_as_manager.patch(
        _URL.format(pid=SEED.primary_project), json={"archived": True}
    )
    assert archived.status_code == 200, archived.text
    assert archived.json()["data"]["is_active"] is False

    restored = await client_as_manager.patch(
        _URL.format(pid=SEED.primary_project), json={"archived": False}
    )
    assert restored.status_code == 200, restored.text
    assert restored.json()["data"]["is_active"] is True
    await db_session.rollback()


@pytest.mark.asyncio
async def test_a_reviewer_is_refused_and_the_row_is_untouched(
    db_session: AsyncSession, client_as_reviewer: AsyncClient
) -> None:
    """The BOLA case: a real member of this project, without the role."""
    before = await _is_active(db_session, SEED.primary_project)

    res = await client_as_reviewer.patch(
        _URL.format(pid=SEED.primary_project), json={"archived": True}
    )

    assert res.status_code == 403, res.text
    # Refused, not merely un-echoed: assert the row, not the response.
    assert await _is_active(db_session, SEED.primary_project) is before
    await db_session.rollback()


@pytest.mark.asyncio
async def test_an_outsider_is_refused_on_a_real_project(
    client_as_outsider: AsyncClient,
) -> None:
    """A REAL project id, so this proves membership is checked — not just id validity."""
    res = await client_as_outsider.patch(
        _URL.format(pid=SEED.primary_project), json={"archived": True}
    )
    assert res.status_code == 403, res.text


@pytest.mark.asyncio
async def test_a_nonexistent_project_answers_exactly_like_a_foreign_one(
    client_as_manager: AsyncClient,
) -> None:
    """403 for both, so the route is not an existence oracle."""
    res = await client_as_manager.patch(_URL.format(pid=uuid4()), json={"archived": True})
    assert res.status_code == 403, res.text


@pytest.mark.asyncio
async def test_the_service_called_directly(db_session: AsyncSession) -> None:
    """Exercises the service WITHOUT the HTTP layer.

    The endpoint tests above drive it through httpx's ASGI transport, whose
    frames coverage does not register — so the service's own branches would be
    reported uncovered despite being exercised.
    """
    written = await set_project_archived(db_session, SEED.primary_project, archived=True)
    assert written["is_active"] is False
    assert written["id"] == SEED.primary_project
    assert await _is_active(db_session, SEED.primary_project) is False

    with pytest.raises(ProjectNotFoundError):
        await set_project_archived(db_session, uuid4(), archived=True)
    await db_session.rollback()
