"""Integration tests for ExtractionProposalService."""

from uuid import UUID

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.extraction import ExtractionRunStage
from app.models.extraction_workflow import ExtractionProposalSource
from app.services.extraction_proposal_service import (
    ExtractionProposalService,
    InvalidProposalError,
)
from app.services.run_lifecycle_service import RunLifecycleService


async def _setup_run_with_instance_field(
    db: AsyncSession,
) -> tuple[UUID, UUID, UUID, UUID] | None:
    """Build a run + advance to proposal + return (run_id, instance_id, field_id, profile_id)."""
    project_id = (await db.execute(text("SELECT id FROM public.projects LIMIT 1"))).scalar()
    article_id = (await db.execute(text("SELECT id FROM public.articles LIMIT 1"))).scalar()
    template_id = (
        await db.execute(text("SELECT id FROM public.project_extraction_templates LIMIT 1"))
    ).scalar()
    profile_id = (await db.execute(text("SELECT id FROM public.profiles LIMIT 1"))).scalar()
    if not all((project_id, article_id, template_id, profile_id)):
        return None
    # Pick instance and field that match the same template and entity_type.
    row = await db.execute(
        text(
            """
            SELECT i.id, f.id
            FROM public.extraction_instances i
            JOIN public.extraction_entity_types et ON et.id = i.entity_type_id
            JOIN public.extraction_fields f ON f.entity_type_id = et.id
            WHERE i.template_id = :tid
            LIMIT 1
            """
        ),
        {"tid": template_id},
    )
    pair = row.first()
    if pair is None:
        return None
    instance_id, field_id = pair
    lifecycle = RunLifecycleService(db)
    run = await lifecycle.create_run(
        project_id=project_id,
        article_id=article_id,
        project_template_id=template_id,
        user_id=profile_id,
    )
    await lifecycle.advance_stage(
        run_id=run.id,
        target_stage=ExtractionRunStage.PROPOSAL,
        user_id=profile_id,
    )
    return run.id, instance_id, field_id, profile_id


@pytest.mark.asyncio
async def test_record_ai_proposal(db_session: AsyncSession) -> None:
    fx = await _setup_run_with_instance_field(db_session)
    if fx is None:
        pytest.skip("Missing fixtures.")
    run_id, instance_id, field_id, _ = fx
    service = ExtractionProposalService(db_session)
    record = await service.record_proposal(
        run_id=run_id,
        instance_id=instance_id,
        field_id=field_id,
        source=ExtractionProposalSource.AI,
        proposed_value={"text": "from LLM"},
        confidence_score=0.92,
        rationale="page 4",
    )
    assert record.id is not None
    assert record.source == "ai"
    assert record.confidence_score == 0.92
    await db_session.rollback()


@pytest.mark.asyncio
async def test_record_human_proposal_requires_user_id(
    db_session: AsyncSession,
) -> None:
    fx = await _setup_run_with_instance_field(db_session)
    if fx is None:
        pytest.skip("Missing fixtures.")
    run_id, instance_id, field_id, _ = fx
    service = ExtractionProposalService(db_session)
    with pytest.raises(InvalidProposalError):
        await service.record_proposal(
            run_id=run_id,
            instance_id=instance_id,
            field_id=field_id,
            source=ExtractionProposalSource.HUMAN,
            proposed_value={"text": "manual"},
            source_user_id=None,
        )
    await db_session.rollback()


@pytest.mark.asyncio
async def test_record_proposal_blocked_outside_proposal_stage(
    db_session: AsyncSession,
) -> None:
    fx = await _setup_run_with_instance_field(db_session)
    if fx is None:
        pytest.skip("Missing fixtures.")
    run_id, instance_id, field_id, profile_id = fx
    # Move run forward past proposal stage
    lifecycle = RunLifecycleService(db_session)
    await lifecycle.advance_stage(
        run_id=run_id,
        target_stage=ExtractionRunStage.REVIEW,
        user_id=profile_id,
    )
    service = ExtractionProposalService(db_session)
    with pytest.raises(InvalidProposalError):
        await service.record_proposal(
            run_id=run_id,
            instance_id=instance_id,
            field_id=field_id,
            source=ExtractionProposalSource.AI,
            proposed_value={"text": "too late"},
        )
    await db_session.rollback()


@pytest.mark.asyncio
async def test_record_human_proposal_accepted_at_review_stage(
    db_session: AsyncSession,
) -> None:
    """Quality-Assessment / human flows must keep working when the run has
    already advanced to REVIEW (e.g. after an interrupted publish that
    succeeded the ``proposal -> review`` step but failed downstream).
    Only AI proposals are gated to PROPOSAL; human/system are allowed at
    PROPOSAL or REVIEW."""
    fx = await _setup_run_with_instance_field(db_session)
    if fx is None:
        pytest.skip("Missing fixtures.")
    run_id, instance_id, field_id, profile_id = fx
    lifecycle = RunLifecycleService(db_session)
    await lifecycle.advance_stage(
        run_id=run_id,
        target_stage=ExtractionRunStage.REVIEW,
        user_id=profile_id,
    )
    service = ExtractionProposalService(db_session)
    record = await service.record_proposal(
        run_id=run_id,
        instance_id=instance_id,
        field_id=field_id,
        source=ExtractionProposalSource.HUMAN,
        proposed_value={"value": "Y"},
        source_user_id=profile_id,
    )
    assert record.id is not None
    assert record.source == "human"
    await db_session.rollback()


@pytest.mark.asyncio
async def test_record_proposal_rejects_incoherent_coordinates(
    db_session: AsyncSession,
) -> None:
    fx = await _setup_run_with_instance_field(db_session)
    if fx is None:
        pytest.skip("Missing fixtures.")
    run_id, instance_id, _, _ = fx
    # Pick a field from a different entity_type
    other_field_row = await db_session.execute(
        text(
            """
            SELECT f.id FROM public.extraction_fields f
            WHERE f.entity_type_id <> (
                SELECT entity_type_id FROM public.extraction_instances WHERE id = :iid
            )
            LIMIT 1
            """
        ),
        {"iid": instance_id},
    )
    other_field_id = other_field_row.scalar()
    if other_field_id is None:
        pytest.skip("Need >=2 entity_types with fields.")

    from app.services.coordinate_coherence import CoordinateMismatchError

    service = ExtractionProposalService(db_session)
    with pytest.raises(CoordinateMismatchError):
        await service.record_proposal(
            run_id=run_id,
            instance_id=instance_id,
            field_id=other_field_id,
            source=ExtractionProposalSource.AI,
            proposed_value={"v": "x"},
        )
    await db_session.rollback()


@pytest.mark.asyncio
async def test_list_by_item_returns_chronological(
    db_session: AsyncSession,
) -> None:
    fx = await _setup_run_with_instance_field(db_session)
    if fx is None:
        pytest.skip("Missing fixtures.")
    run_id, instance_id, field_id, _ = fx
    service = ExtractionProposalService(db_session)
    p1 = await service.record_proposal(
        run_id=run_id,
        instance_id=instance_id,
        field_id=field_id,
        source=ExtractionProposalSource.AI,
        proposed_value={"v": "1"},
    )
    p2 = await service.record_proposal(
        run_id=run_id,
        instance_id=instance_id,
        field_id=field_id,
        source=ExtractionProposalSource.AI,
        proposed_value={"v": "2"},
    )
    rows = await service.list_by_item(run_id, instance_id, field_id)
    ids = [r.id for r in rows]
    assert p1.id in ids and p2.id in ids
    assert ids.index(p1.id) < ids.index(p2.id)
    await db_session.rollback()
