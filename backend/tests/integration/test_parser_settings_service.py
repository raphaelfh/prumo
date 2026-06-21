"""Integration tests for ParserSettingsService.

Covers:
- default is "auto" when no parsing key is set (LlamaParse-when-key policy)
- legacy stored "standard" normalises to "docling" on read
- set_for_project + get_for_project round-trips "llamaparse"
- set_for_project rejects unknown parser_type with ValueError
- get_for_project raises ProjectNotFoundError for a missing project
"""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.parser_settings_service import (
    ParserSettingsService,
    ProjectNotFoundError,
)
from tests.integration.conftest import SEED


async def _clear_parsing_setting(db: AsyncSession, project_id: uuid.UUID) -> None:
    """Restore the seed-clean state (no ``parsing`` key). db_session_real
    persists commits, so any test that commits a parser setting must undo it."""
    await db.execute(
        text("UPDATE public.projects SET settings = settings - 'parsing' WHERE id = :pid"),
        {"pid": str(project_id)},
    )
    await db.commit()


@pytest.mark.asyncio
async def test_default_is_auto(db_session_real: AsyncSession) -> None:
    await _clear_parsing_setting(db_session_real, SEED.primary_project)
    svc = ParserSettingsService(db_session_real)
    assert await svc.get_for_project(SEED.primary_project) == "auto"


@pytest.mark.asyncio
async def test_legacy_standard_normalises_to_docling(db_session_real: AsyncSession) -> None:
    svc = ParserSettingsService(db_session_real)
    await svc.set_for_project(project_id=SEED.primary_project, parser_type="standard")
    db_session_real.expire_all()
    assert await svc.get_for_project(SEED.primary_project) == "docling"


@pytest.mark.asyncio
async def test_set_and_get_llamaparse(db_session_real: AsyncSession) -> None:
    svc = ParserSettingsService(db_session_real)
    merged = await svc.set_for_project(project_id=SEED.primary_project, parser_type="llamaparse")
    assert merged == {"type": "llamaparse"}
    # Expire the identity map so the next read issues a real SELECT against the DB,
    # proving the JSONB column was actually written (not just mutated in memory).
    db_session_real.expire_all()
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
