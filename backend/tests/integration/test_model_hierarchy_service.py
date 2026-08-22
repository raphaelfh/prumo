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
from tests.integration.conftest import (
    SEED,
    clean_project_clones,
    clone_charms,
    open_session,
)


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

    # No HITL run is open in this test, so nothing was recorded.
    assert result.proposal_run_id is None


async def _container_field_ids_by_name(
    db: AsyncSession, project_template_id: UUID
) -> dict[str, UUID]:
    from app.models.extraction import ExtractionField

    container_id = (
        await db.execute(
            select(ExtractionEntityType.id).where(
                ExtractionEntityType.project_template_id == project_template_id,
                ExtractionEntityType.role == ExtractionEntityRole.MODEL_CONTAINER.value,
            )
        )
    ).scalar_one()
    rows = (
        (
            await db.execute(
                select(ExtractionField).where(ExtractionField.entity_type_id == container_id)
            )
        )
        .scalars()
        .all()
    )
    return {f.name: f.id for f in rows}


@pytest.mark.asyncio
async def test_create_model_hierarchy_records_name_and_method_decisions(
    db_session: AsyncSession,
) -> None:
    from app.models.extraction_workflow import ExtractionReviewerDecision

    await clean_project_clones(db_session, SEED.secondary_project)
    clone = await clone_charms(db_session, SEED.secondary_project, SEED.primary_profile)
    article_id = await _fresh_article(db_session, SEED.secondary_project)

    session = await open_session(
        db_session,
        project_id=SEED.secondary_project,
        article_id=article_id,
        template_id=clone.project_template_id,
        user_id=SEED.primary_profile,
    )

    result = await ModelHierarchyService(db_session).create_model_hierarchy(
        project_id=SEED.secondary_project,
        article_id=article_id,
        template_id=clone.project_template_id,
        user_id=SEED.primary_profile,
        model_name="Cox Model",
        modelling_method="logistic regression",
    )

    assert result.proposal_run_id == session.run_id

    fields = await _container_field_ids_by_name(db_session, clone.project_template_id)
    decisions = {
        row.field_id: row.value
        for row in (
            await db_session.execute(
                select(ExtractionReviewerDecision).where(
                    ExtractionReviewerDecision.run_id == session.run_id,
                    ExtractionReviewerDecision.instance_id == result.model_id,
                )
            )
        )
        .scalars()
        .all()
    }
    assert decisions[fields["model_name"]] == {"value": "Cox Model"}
    assert decisions[fields["modelling_method"]] == {"value": "logistic regression"}


@pytest.mark.asyncio
async def test_recorded_model_name_matches_the_deduplicated_label(
    db_session: AsyncSession,
) -> None:
    """The decision value must match every visible surface: when the label
    gets uniquified ("Cox Model (2)"), that is what lands in the trail."""
    from app.models.extraction_workflow import ExtractionReviewerDecision

    await clean_project_clones(db_session, SEED.secondary_project)
    clone = await clone_charms(db_session, SEED.secondary_project, SEED.primary_profile)
    article_id = await _fresh_article(db_session, SEED.secondary_project)

    session = await open_session(
        db_session,
        project_id=SEED.secondary_project,
        article_id=article_id,
        template_id=clone.project_template_id,
        user_id=SEED.primary_profile,
    )

    service = ModelHierarchyService(db_session)
    kwargs: dict = {
        "project_id": SEED.secondary_project,
        "article_id": article_id,
        "template_id": clone.project_template_id,
        "user_id": SEED.primary_profile,
        "model_name": "Cox Model",
        "modelling_method": None,
    }
    await service.create_model_hierarchy(**kwargs)
    second = await service.create_model_hierarchy(**kwargs)

    assert second.model_label == "Cox Model (2)"

    fields = await _container_field_ids_by_name(db_session, clone.project_template_id)
    recorded = (
        await db_session.execute(
            select(ExtractionReviewerDecision.value).where(
                ExtractionReviewerDecision.run_id == session.run_id,
                ExtractionReviewerDecision.instance_id == second.model_id,
                ExtractionReviewerDecision.field_id == fields["model_name"],
            )
        )
    ).scalar_one()
    assert recorded == {"value": "Cox Model (2)"}
