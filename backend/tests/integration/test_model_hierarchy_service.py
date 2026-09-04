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

from functools import partial
from uuid import UUID, uuid4

import pytest
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.extraction import (
    ExtractionCardinality,
    ExtractionEntityRole,
    ExtractionEntityType,
    ExtractionField,
    ExtractionInstance,
)
from app.models.extraction_workflow import ExtractionReviewerDecision
from app.repositories.extraction_repository import ExtractionEntityTypeRepository
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


async def _clone_with_open_session(db: AsyncSession):
    """CHARMS clone + fresh article + open extract-stage session.

    The secondary project is the clean clone playground (the primary
    project's template is pinned by the SEED instance's RESTRICT FK).
    """
    await clean_project_clones(db, SEED.secondary_project)
    clone = await clone_charms(db, SEED.secondary_project, SEED.primary_profile)
    article_id = await _fresh_article(db, SEED.secondary_project)
    session = await open_session(
        db,
        project_id=SEED.secondary_project,
        article_id=article_id,
        template_id=clone.project_template_id,
        user_id=SEED.primary_profile,
    )
    return clone, article_id, session


async def _container_field_ids_by_name(
    db: AsyncSession, project_template_id: UUID
) -> dict[str, UUID]:
    # The exact production lookup this suite guards (the miswired-repository
    # regression): resolve the container by role via the repository.
    container = await ExtractionEntityTypeRepository(db).get_by_role(
        role=ExtractionEntityRole.MODEL_CONTAINER.value,
        template_id=project_template_id,
        is_project_template=True,
    )
    assert container is not None
    rows = (
        (
            await db.execute(
                select(ExtractionField).where(ExtractionField.entity_type_id == container.id)
            )
        )
        .scalars()
        .all()
    )
    return {f.name: f.id for f in rows}


@pytest.mark.asyncio
async def test_create_model_hierarchy_creates_parent_and_singleton_children(
    db_session: AsyncSession,
) -> None:
    # No open session here on purpose: creation must work run-less.
    await clean_project_clones(db_session, SEED.secondary_project)
    clone = await clone_charms(db_session, SEED.secondary_project, SEED.primary_profile)
    article_id = await _fresh_article(db_session, SEED.secondary_project)

    result = await ModelHierarchyService(db_session).create_model_hierarchy(
        project_id=SEED.secondary_project,
        article_id=article_id,
        template_id=clone.project_template_id,
        user_id=SEED.primary_profile,
        model_name="Cox Model",
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

    # The manual entry carries the same materialized identity an AI-created
    # one does (identity spec §5.1.1), so an AI re-run that finds this model
    # reuses the row instead of adding a second one beside it.
    parent = await db_session.get(ExtractionInstance, result.model_id)
    assert parent is not None and parent.metadata_["entity_key"] == "cox model"


@pytest.mark.asyncio
async def test_create_model_hierarchy_records_only_the_name_on_the_key(
    db_session: AsyncSession,
) -> None:
    """The dialog asks for the key only (follow-up train §6): exactly one
    decision lands, on the container's entry key, and no field is ever
    picked by name."""
    clone, article_id, session = await _clone_with_open_session(db_session)

    result = await ModelHierarchyService(db_session).create_model_hierarchy(
        project_id=SEED.secondary_project,
        article_id=article_id,
        template_id=clone.project_template_id,
        user_id=SEED.primary_profile,
        model_name="Cox Model",
    )

    assert result.proposal_run_id == session.run_id

    fields = await _container_field_ids_by_name(db_session, clone.project_template_id)
    decisions = await _decisions_for(db_session, session.run_id, result.model_id)
    assert decisions == {fields["model_name"]: {"value": "Cox Model"}}


@pytest.mark.asyncio
async def test_recorded_model_name_matches_the_deduplicated_label(
    db_session: AsyncSession,
) -> None:
    """The decision value must match every visible surface: when the label
    gets uniquified ("Cox Model (2)"), that is what lands in the trail."""
    clone, article_id, session = await _clone_with_open_session(db_session)

    create = partial(
        ModelHierarchyService(db_session).create_model_hierarchy,
        project_id=SEED.secondary_project,
        article_id=article_id,
        template_id=clone.project_template_id,
        user_id=SEED.primary_profile,
        model_name="Cox Model",
    )
    await create()
    second = await create()

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


async def _move_container_key(
    db: AsyncSession, project_template_id: UUID, *, to_field: str | None
) -> None:
    """Re-key the clone's container: clear ``model_name`` and, when
    ``to_field`` is given, add it as the new entry key — the Multimodal
    lineage's shape (``mdl_name``), or a keyless container when None."""
    fields = await _container_field_ids_by_name(db, project_template_id)
    await db.execute(
        text("UPDATE public.extraction_fields SET is_entity_key = false WHERE id = :id"),
        {"id": str(fields["model_name"])},
    )
    if to_field is not None:
        container = await ExtractionEntityTypeRepository(db).get_by_role(
            role=ExtractionEntityRole.MODEL_CONTAINER.value,
            template_id=project_template_id,
            is_project_template=True,
        )
        assert container is not None
        await db.execute(
            text(
                "INSERT INTO public.extraction_fields "
                "(id, entity_type_id, name, label, field_type, sort_order, is_entity_key) "
                "VALUES (:id, :et, :name, 'Model', 'text', 50, true)"
            ),
            {"id": str(uuid4()), "et": str(container.id), "name": to_field},
        )
    await db.flush()


async def _decisions_for(
    db: AsyncSession, run_id: UUID, instance_id: UUID
) -> dict[UUID, dict[str, object]]:
    rows = (
        (
            await db.execute(
                select(ExtractionReviewerDecision).where(
                    ExtractionReviewerDecision.run_id == run_id,
                    ExtractionReviewerDecision.instance_id == instance_id,
                )
            )
        )
        .scalars()
        .all()
    )
    return {row.field_id: row.value for row in rows}


@pytest.mark.asyncio
async def test_the_name_is_recorded_on_the_entry_key_not_on_a_field_named_model_name(
    db_session: AsyncSession,
) -> None:
    """CHARMS keys the container on ``model_name``; the Multimodal lineage on
    ``mdl_name``. The dialog labels its input with the key field, so the
    decision it records must land there — picking the field by the literal
    name recorded nothing for Multimodal."""
    clone, article_id, session = await _clone_with_open_session(db_session)
    await _move_container_key(db_session, clone.project_template_id, to_field="mdl_name")

    result = await ModelHierarchyService(db_session).create_model_hierarchy(
        project_id=SEED.secondary_project,
        article_id=article_id,
        template_id=clone.project_template_id,
        user_id=SEED.primary_profile,
        model_name="Cox Model",
    )

    fields = await _container_field_ids_by_name(db_session, clone.project_template_id)
    decisions = await _decisions_for(db_session, session.run_id, result.model_id)
    assert decisions == {fields["mdl_name"]: {"value": "Cox Model"}}


@pytest.mark.asyncio
async def test_a_keyless_container_still_creates_the_model_and_records_nothing(
    db_session: AsyncSession,
) -> None:
    """Without a key there is no field that holds the name: the instance label
    carries it, no decision is recorded, and creation does not refuse (the
    AI path is what refuses a keyless group, not the manual dialog)."""
    clone, article_id, session = await _clone_with_open_session(db_session)
    await _move_container_key(db_session, clone.project_template_id, to_field=None)

    result = await ModelHierarchyService(db_session).create_model_hierarchy(
        project_id=SEED.secondary_project,
        article_id=article_id,
        template_id=clone.project_template_id,
        user_id=SEED.primary_profile,
        model_name="Cox Model",
    )

    assert result.model_label == "Cox Model"
    assert result.proposal_run_id is None
    assert await _decisions_for(db_session, session.run_id, result.model_id) == {}
