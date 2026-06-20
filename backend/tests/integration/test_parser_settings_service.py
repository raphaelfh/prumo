"""Integration tests for ParserSettingsService.

Covers:
- default is "standard" when no parsing key is set
- set_for_project + get_for_project round-trips "llamaparse"
- set_for_project rejects unknown parser_type with ValueError
- get_for_project raises ProjectNotFoundError for a missing project
"""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.parser_settings_service import (
    ParserSettingsService,
    ProjectNotFoundError,
)
from tests.integration.conftest import SEED


@pytest.mark.asyncio
async def test_default_is_standard(db_session_real: AsyncSession) -> None:
    svc = ParserSettingsService(db_session_real)
    assert await svc.get_for_project(SEED.primary_project) == "standard"


@pytest.mark.asyncio
async def test_set_and_get_llamaparse(db_session_real: AsyncSession) -> None:
    svc = ParserSettingsService(db_session_real)
    merged = await svc.set_for_project(project_id=SEED.primary_project, parser_type="llamaparse")
    assert merged == {"type": "llamaparse"}
    assert await svc.get_for_project(SEED.primary_project) == "llamaparse"


@pytest.mark.asyncio
async def test_rejects_unknown_type(db_session_real: AsyncSession) -> None:
    svc = ParserSettingsService(db_session_real)
    with pytest.raises(ValueError):
        await svc.set_for_project(project_id=SEED.primary_project, parser_type="bogus")


@pytest.mark.asyncio
async def test_missing_project_raises(db_session_real: AsyncSession) -> None:
    svc = ParserSettingsService(db_session_real)
    with pytest.raises(ProjectNotFoundError):
        await svc.get_for_project(uuid.uuid4())
