"""The non-raising role helpers in ``app.api.deps.security``.

``is_project_manager`` is the boolean twin of ``ensure_project_manager``: a
route that owns its refusal shape (404 for an outsider, 403 for a member who
is not a manager) branches on it instead of catching the 403 the ``ensure_*``
helper raises. It must agree with ``public.is_project_manager`` — the
function the RLS policies call — for every caller class, including a project
that does not exist.
"""

from __future__ import annotations

from uuid import UUID, uuid4

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps.security import is_project_manager
from tests.integration.conftest import SEED


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("profile", "project", "expected"),
    [
        pytest.param(SEED.primary_profile, SEED.primary_project, True, id="manager"),
        pytest.param(SEED.reviewer_profile, SEED.primary_project, False, id="reviewer"),
        pytest.param(SEED.outsider_profile, SEED.primary_project, False, id="outsider"),
        pytest.param(SEED.primary_profile, uuid4(), False, id="missing-project"),
    ],
)
async def test_is_project_manager(
    db_session: AsyncSession, profile: UUID, project: UUID, expected: bool
) -> None:
    assert await is_project_manager(db_session, project, profile) is expected


@pytest.mark.asyncio
async def test_is_project_manager_accepts_a_raw_subject(db_session: AsyncSession) -> None:
    """A JWT ``sub`` string is normalised inside the helper, like ``is_project_member``."""
    assert await is_project_manager(db_session, SEED.primary_project, str(SEED.primary_profile))
