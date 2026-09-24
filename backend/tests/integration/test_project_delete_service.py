"""``project_delete_service.delete_project_row`` against the real schema."""

from __future__ import annotations

from uuid import uuid4

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.error_handler import NotFoundError
from app.services.project_delete_service import delete_project_row
from tests.integration.conftest import SEED


@pytest.mark.asyncio
async def test_deletes_the_row(db_session: AsyncSession) -> None:
    await delete_project_row(db_session, SEED.primary_project)

    remaining = (
        await db_session.execute(
            text("SELECT count(*) FROM public.projects WHERE id = :pid"),
            {"pid": str(SEED.primary_project)},
        )
    ).scalar_one()
    assert remaining == 0


@pytest.mark.asyncio
async def test_missing_project_is_not_found(db_session: AsyncSession) -> None:
    with pytest.raises(NotFoundError) as info:
        await delete_project_row(db_session, uuid4())
    assert info.value.status_code == 404
