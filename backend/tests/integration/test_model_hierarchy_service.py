"""model_hierarchy_service: manual model creation against the real schema.

Regression suite for the manual "Add model" path
(``POST /api/v1/extraction/models/manual``). The endpoint-level success
test mocks the whole ``ModelHierarchyService``, so a broken repository
wiring inside ``_prediction_models_entity_type`` shipped as a
deterministic 500 on every click for three months (merge ``12f878bc``
pointed the role lookup at ``ExtractionTemplateRepository``, which does
not define ``get_by_role``). This suite runs the service unmocked over a
real CHARMS clone so the lookup path — and the parent + singleton-child
materialisation — execute for real.
"""

from __future__ import annotations

from uuid import UUID, uuid4

import pytest
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.extraction import (
    ExtractionCardinality,
    ExtractionEntityRole,
    ExtractionEntityType,
    ExtractionInstance,
)
from app.services.model_hierarchy_service import ModelHierarchyService
from tests.integration.conftest import SEED, clean_project_clones, clone_charms


async def _fresh_article(db: AsyncSession, project_id: UUID) -> UUID:
    article_id = uuid4()
    await db.execute(
        text(
            "INSERT INTO public.articles (id, project_id, title, row_version) "
            "VALUES (:id, :pid, 'Model hierarchy article', 1)"
        ),
        {"id": str(article_id), "pid": str(project_id)},
    )
    await db.flush()
    return article_id


@pytest.mark.asyncio
async def test_create_model_hierarchy_creates_parent_and_singleton_children(
    db_session: AsyncSession,
) -> None:
    # The secondary project is the clean clone playground (the primary
    # project's template is pinned by the SEED instance's RESTRICT FK).
    await clean_project_clones(db_session, SEED.secondary_project)
    clone = await clone_charms(db_session, SEED.secondary_project, SEED.primary_profile)
    article_id = await _fresh_article(db_session, SEED.secondary_project)

    result = await ModelHierarchyService(db_session).create_model_hierarchy(
        project_id=SEED.secondary_project,
        article_id=article_id,
        template_id=clone.project_template_id,
        user_id=SEED.primary_profile,
        model_name="Cox Model",
        modelling_method=None,
    )

    assert result.model_label == "Cox Model"

    container_id = (
        await db_session.execute(
            select(ExtractionEntityType.id).where(
                ExtractionEntityType.project_template_id == clone.project_template_id,
                ExtractionEntityType.role == ExtractionEntityRole.MODEL_CONTAINER.value,
            )
        )
    ).scalar_one()
    singleton_child_type_ids = set(
        (
            await db_session.execute(
                select(ExtractionEntityType.id).where(
                    ExtractionEntityType.parent_entity_type_id == container_id,
                    ExtractionEntityType.cardinality == ExtractionCardinality.ONE.value,
                )
            )
        )
        .scalars()
        .all()
    )

    # CHARMS ships several singleton sections under prediction_models; the
    # exact count is the template's business, but zero would make this test
    # vacuous.
    assert singleton_child_type_ids

    assert {c.entity_type_id for c in result.child_instances} == singleton_child_type_ids

    persisted = (
        (
            await db_session.execute(
                select(ExtractionInstance).where(
                    ExtractionInstance.parent_instance_id == result.model_id
                )
            )
        )
        .scalars()
        .all()
    )
    assert {row.entity_type_id for row in persisted} == singleton_child_type_ids
    assert all(row.article_id == article_id for row in persisted)
