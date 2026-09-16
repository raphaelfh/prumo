"""Entries of root repeating groups only — never singletons, never nested rows."""

from __future__ import annotations

from types import SimpleNamespace
from uuid import UUID, uuid4

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.section_extraction_service import SectionExtractionService
from tests.integration.conftest import SEED
from tests.integration.helpers.template_fixtures import fresh_charms


async def _entity_type(db: AsyncSession, template_id: UUID, *, cardinality: str) -> UUID:
    return (
        await db.execute(
            text(
                "SELECT id FROM public.extraction_entity_types "
                "WHERE project_template_id = :tid AND parent_entity_type_id IS NULL "
                "AND cardinality = :card ORDER BY sort_order LIMIT 1"
            ),
            {"tid": str(template_id), "card": cardinality},
        )
    ).scalar_one()


async def _instance(
    db: AsyncSession,
    *,
    project_id: UUID,
    article_id: UUID,
    template_id: UUID,
    entity_type_id: UUID,
    parent: UUID | None = None,
    sort_order: int = 0,
) -> UUID:
    instance_id = uuid4()
    await db.execute(
        text(
            "INSERT INTO public.extraction_instances (id, project_id, article_id, template_id, "
            "entity_type_id, parent_instance_id, label, sort_order, metadata, created_by) "
            "VALUES (:id, :pid, :aid, :tid, :et, :parent, 'entry', :so, '{}'::jsonb, :by)"
        ),
        {
            "id": str(instance_id),
            "pid": str(project_id),
            "aid": str(article_id),
            "tid": str(template_id),
            "et": str(entity_type_id),
            "parent": str(parent) if parent else None,
            "so": sort_order,
            "by": str(SEED.primary_profile),
        },
    )
    return instance_id


@pytest.mark.asyncio
async def test_root_entry_instance_ids(db_session: AsyncSession) -> None:
    project_id, template_id, _ = await fresh_charms(db_session)
    article_id = uuid4()
    await db_session.execute(
        text(
            "INSERT INTO public.articles (id, project_id, title, row_version) VALUES (:id, :pid, 'entries', 1)"
        ),
        {"id": str(article_id), "pid": str(project_id)},
    )
    group = await _entity_type(db_session, template_id, cardinality="many")
    singleton = await _entity_type(db_session, template_id, cardinality="one")
    first = await _instance(
        db_session,
        project_id=project_id,
        article_id=article_id,
        template_id=template_id,
        entity_type_id=group,
        sort_order=0,
    )
    second = await _instance(
        db_session,
        project_id=project_id,
        article_id=article_id,
        template_id=template_id,
        entity_type_id=group,
        sort_order=1,
    )
    await _instance(
        db_session,
        project_id=project_id,
        article_id=article_id,
        template_id=template_id,
        entity_type_id=singleton,
    )

    service = SectionExtractionService.__new__(SectionExtractionService)
    service.db = db_session
    got = await service._root_entry_instance_ids(
        SimpleNamespace(article_id=article_id, template_id=template_id)
    )

    assert got == [first, second]
