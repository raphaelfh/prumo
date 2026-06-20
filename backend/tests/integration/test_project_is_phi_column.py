import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.project import Project
from tests.integration.conftest import SEED


@pytest.mark.asyncio
async def test_project_is_phi_defaults_false(db_session_real: AsyncSession) -> None:
    project_id = SEED.primary_project
    project = (
        await db_session_real.execute(select(Project).where(Project.id == project_id))
    ).scalar_one()
    assert project.is_phi is False
    project.is_phi = True
    await db_session_real.flush()
    refreshed = (
        await db_session_real.execute(select(Project).where(Project.id == project_id))
    ).scalar_one()
    assert refreshed.is_phi is True
