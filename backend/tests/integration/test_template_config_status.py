"""GET config-status (slice B-4): the Draft chip's read model.

``has_pending_changes`` mirrors the trigger-stamped marker;
``active_version`` mirrors the active version row. BOLA: foreign
templates 404, never leak draft timing.
"""

from __future__ import annotations

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.project_template_active_service import ProjectTemplateNotFoundError
from app.services.template_version_read_service import get_template_config_status
from tests.integration.conftest import SEED, set_config_draft_marker


@pytest.mark.asyncio
async def test_status_flips_with_edit_and_publish(db_session: AsyncSession) -> None:
    from app.services.template_version_service import TemplateVersionService

    await set_config_draft_marker(db_session, SEED.primary_template, None)
    clean = await get_template_config_status(
        db_session,
        project_id=SEED.primary_project,
        template_id=SEED.primary_template,
    )
    assert clean.has_pending_changes is False
    assert clean.project_template_id == SEED.primary_template

    # A live config edit stamps the marker (DB trigger).
    await db_session.execute(
        text("UPDATE public.extraction_fields SET label = label || ' (b4)' WHERE id = :fid"),
        {"fid": str(SEED.primary_field)},
    )
    await db_session.flush()
    pending = await get_template_config_status(
        db_session,
        project_id=SEED.primary_project,
        template_id=SEED.primary_template,
    )
    assert pending.has_pending_changes is True

    published = await TemplateVersionService(db_session).republish(
        project_id=SEED.primary_project,
        project_template_id=SEED.primary_template,
        user_id=SEED.primary_profile,
    )
    after = await get_template_config_status(
        db_session,
        project_id=SEED.primary_project,
        template_id=SEED.primary_template,
    )
    assert after.has_pending_changes is False
    assert after.active_version == published.version


@pytest.mark.asyncio
async def test_status_is_bola_guarded(db_session: AsyncSession) -> None:
    with pytest.raises(ProjectTemplateNotFoundError):
        await get_template_config_status(
            db_session,
            project_id=SEED.secondary_project,
            template_id=SEED.primary_template,
        )
