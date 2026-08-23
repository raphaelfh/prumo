# backend/tests/integration/test_template_delete_service.py
"""Guards and cascade for the project-template delete (spec §5.7)."""

from __future__ import annotations

from uuid import uuid4

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.project_template_active_service import (
    ProjectTemplateNotFoundError,
    set_template_active,
)
from app.services.template_delete_service import (
    TemplateActiveError,
    TemplateInUseError,
    delete_template,
)
from tests.integration.conftest import SEED, clean_project_clones, clone_charms
from tests.integration.test_project_template_active_service import (
    _insert_inactive_extraction_template,
)


async def _count(db: AsyncSession, sql: str, **params) -> int:
    return (await db.execute(text(sql), params)).scalar_one()


async def _template_count(db: AsyncSession, project_id) -> int:
    return await _count(
        db,
        "SELECT COUNT(*) FROM public.project_extraction_templates WHERE project_id = :pid",
        pid=str(project_id),
    )


async def _insert_article(db: AsyncSession, project_id) -> str:
    aid = uuid4()
    await db.execute(
        text(
            "INSERT INTO public.articles (id, project_id, title, row_version) "
            "VALUES (:id, :pid, 'delete-guard article', 1)"
        ),
        {"id": str(aid), "pid": str(project_id)},
    )
    await db.flush()
    return str(aid)


@pytest.mark.asyncio
async def test_delete_refuses_active_template_and_writes_nothing(
    db_session: AsyncSession,
) -> None:
    project_id = SEED.secondary_project
    await clean_project_clones(db_session, project_id)
    active = await clone_charms(db_session, project_id, SEED.primary_profile)
    with pytest.raises(TemplateActiveError) as exc:
        await delete_template(
            db_session, project_id=project_id, template_id=active.project_template_id
        )
    assert exc.value.code == "TEMPLATE_ACTIVE" and exc.value.status_code == 409
    assert await _template_count(db_session, project_id) == 1


@pytest.mark.asyncio
async def test_delete_refuses_cross_project(db_session: AsyncSession) -> None:
    await clean_project_clones(db_session, SEED.secondary_project)
    clone = await clone_charms(db_session, SEED.secondary_project, SEED.primary_profile)
    with pytest.raises(ProjectTemplateNotFoundError):
        await delete_template(
            db_session, project_id=SEED.primary_project, template_id=clone.project_template_id
        )


@pytest.mark.asyncio
async def test_delete_refuses_template_with_a_run_and_writes_nothing(
    db_session: AsyncSession,
) -> None:
    from app.services.run_lifecycle_service import RunLifecycleService

    project_id = SEED.secondary_project
    await clean_project_clones(db_session, project_id)
    used = await clone_charms(db_session, project_id, SEED.primary_profile)
    article_id = await _insert_article(db_session, project_id)
    await RunLifecycleService(db_session).create_run(
        project_id=project_id,
        article_id=article_id,
        project_template_id=used.project_template_id,
        user_id=SEED.primary_profile,
    )
    # Make it inactive so the ACTIVE guard is not the one firing.
    extra = await _insert_inactive_extraction_template(
        db_session, project_id=project_id, created_by=SEED.primary_profile
    )
    await set_template_active(db_session, project_id=project_id, template_id=extra, is_active=True)

    with pytest.raises(TemplateInUseError) as exc:
        await delete_template(
            db_session, project_id=project_id, template_id=used.project_template_id
        )
    assert exc.value.code == "TEMPLATE_IN_USE" and exc.value.status_code == 409
    assert exc.value.details["runs"] >= 1
    assert await _template_count(db_session, project_id) == 2


@pytest.mark.asyncio
async def test_delete_cascades_structure_versions_and_hitl_config(
    db_session: AsyncSession,
) -> None:
    project_id = SEED.secondary_project
    await clean_project_clones(db_session, project_id)
    doomed = await clone_charms(db_session, project_id, SEED.primary_profile)
    extra = await _insert_inactive_extraction_template(
        db_session, project_id=project_id, created_by=SEED.primary_profile
    )
    await set_template_active(db_session, project_id=project_id, template_id=extra, is_active=True)
    tid = str(doomed.project_template_id)
    await db_session.execute(
        text(
            "INSERT INTO public.extraction_hitl_configs "
            "(id, scope_kind, scope_id, reviewer_count, consensus_rule) "
            "VALUES (gen_random_uuid(), 'template', :tid, 1, 'unanimous')"
        ),
        {"tid": tid},
    )

    result = await delete_template(
        db_session, project_id=project_id, template_id=doomed.project_template_id
    )
    assert result.deleted is True

    for sql in (
        "SELECT COUNT(*) FROM public.project_extraction_templates WHERE id = :tid",
        "SELECT COUNT(*) FROM public.extraction_entity_types WHERE project_template_id = :tid",
        "SELECT COUNT(*) FROM public.extraction_template_versions WHERE project_template_id = :tid",
        "SELECT COUNT(*) FROM public.extraction_hitl_configs "
        "WHERE scope_kind = 'template' AND scope_id = :tid",
        "SELECT COUNT(*) FROM public.extraction_fields f "
        "JOIN public.extraction_entity_types et ON et.id = f.entity_type_id "
        "WHERE et.project_template_id = :tid",
    ):
        assert await _count(db_session, sql, tid=tid) == 0
    assert await _template_count(db_session, project_id) == 1
