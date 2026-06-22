"""Regression: export template load must be scoped by project_id (BOLA).

``_load_active_template_version`` loaded the template by id alone, so a member
of project A could request an export with ``project_id=A`` (passing the
membership gate in ``assert_can_export``) but ``template_id`` belonging to
project B. The async (Celery) export path then built and uploaded a downloadable
workbook carrying project B's template metadata — a cross-project info leak.

The loader now filters by ``project_id``, mirroring the reviewer-picker query.
See post-merge review 2026-06-21.
"""

from __future__ import annotations

from unittest.mock import MagicMock

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.error_handler import NotFoundError
from app.services.extraction_export_service import ExtractionExportService
from tests.integration.conftest import SEED

pytestmark = pytest.mark.asyncio


def _service(db: AsyncSession) -> ExtractionExportService:
    return ExtractionExportService(db=db, user_id=str(SEED.primary_profile), storage=MagicMock())


async def test_template_load_rejects_cross_project_template(db_session: AsyncSession) -> None:
    """Loading primary_template under the WRONG project must not resolve.

    primary_template belongs to primary_project; requesting it under
    secondary_project must raise a template-level NotFoundError (the project
    filter excluded it), never leak the foreign template.
    """
    with pytest.raises(NotFoundError) as exc:
        await _service(db_session)._load_active_template_version(
            SEED.primary_template, SEED.secondary_project
        )
    assert "not found" in str(exc.value).lower()
    await db_session.rollback()


async def test_template_load_resolves_under_owning_project(db_session: AsyncSession) -> None:
    """Positive control: the project filter does not over-reject the owner.

    Loading primary_template under primary_project resolves the template
    (proving the added project_id predicate matches the legitimate case).
    """
    template, _version = await _service(db_session)._load_active_template_version(
        SEED.primary_template, SEED.primary_project
    )
    assert template.id == SEED.primary_template
    await db_session.rollback()
