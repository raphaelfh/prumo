"""Integration tests for ExtractionReviewService."""

from uuid import UUID

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.extraction import ExtractionRunStage
from app.models.extraction_workflow import (
    ExtractionProposalSource,
    ExtractionReviewerDecisionType,
)
from app.services.extraction_proposal_service import ExtractionProposalService
from app.services.extraction_review_service import (
    ExtractionReviewService,
    InvalidDecisionError,
)
from app.services.run_lifecycle_service import RunLifecycleService


async def _setup_review_run(
    db: AsyncSession,
) -> tuple[UUID, UUID, UUID, UUID, UUID, UUID] | None:
    """Build run, advance to review, return (run_id, instance_id, field_id, profile_id, proposal_id, alt_profile_id)."""
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
    proposal = await ExtractionProposalService(db).record_proposal(
        run_id=run.id,
        instance_id=instance_id,
        field_id=field_id,
        source=ExtractionProposalSource.AI,
        proposed_value={"text": "candidate"},
    )
    await lifecycle.advance_stage(
        run_id=run.id,
        target_stage=ExtractionRunStage.REVIEW,
        user_id=profile_id,
    )
    return run.id, instance_id, field_id, profile_id, proposal.id, profile_id


@pytest.mark.asyncio
async def test_record_accept_proposal_decision(db_session: AsyncSession) -> None:
    fx = await _setup_review_run(db_session)
    if fx is None:
        pytest.skip("Missing fixtures.")
    run_id, instance_id, field_id, profile_id, proposal_id, _ = fx

    service = ExtractionReviewService(db_session)
    decision = await service.record_decision(
        run_id=run_id,
        instance_id=instance_id,
        field_id=field_id,
        reviewer_id=profile_id,
        decision=ExtractionReviewerDecisionType.ACCEPT_PROPOSAL,
        proposal_record_id=proposal_id,
    )
    assert decision.decision == "accept_proposal"
    assert decision.proposal_record_id == proposal_id

    # ReviewerState was upserted
    state = await service.get_reviewer_state(
        run_id=run_id,
        reviewer_id=profile_id,
        instance_id=instance_id,
        field_id=field_id,
    )
    assert state is not None
    assert state.current_decision_id == decision.id
    await db_session.rollback()


@pytest.mark.asyncio
async def test_accept_proposal_requires_proposal_record_id(
    db_session: AsyncSession,
) -> None:
    fx = await _setup_review_run(db_session)
    if fx is None:
        pytest.skip("Missing fixtures.")
    run_id, instance_id, field_id, profile_id, _, _ = fx

    service = ExtractionReviewService(db_session)
    with pytest.raises(InvalidDecisionError):
        await service.record_decision(
            run_id=run_id,
            instance_id=instance_id,
            field_id=field_id,
            reviewer_id=profile_id,
            decision=ExtractionReviewerDecisionType.ACCEPT_PROPOSAL,
            proposal_record_id=None,
        )
    await db_session.rollback()


@pytest.mark.asyncio
async def test_edit_decision_requires_value(db_session: AsyncSession) -> None:
    fx = await _setup_review_run(db_session)
    if fx is None:
        pytest.skip("Missing fixtures.")
    run_id, instance_id, field_id, profile_id, _, _ = fx

    service = ExtractionReviewService(db_session)
    with pytest.raises(InvalidDecisionError):
        await service.record_decision(
            run_id=run_id,
            instance_id=instance_id,
            field_id=field_id,
            reviewer_id=profile_id,
            decision=ExtractionReviewerDecisionType.EDIT,
            value=None,
        )
    await db_session.rollback()


@pytest.mark.asyncio
async def test_record_decision_rejects_incoherent_coordinates(
    db_session: AsyncSession,
) -> None:
    fx = await _setup_review_run(db_session)
    if fx is None:
        pytest.skip("Missing fixtures.")
    run_id, instance_id, _, profile_id, _, _ = fx
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

    service = ExtractionReviewService(db_session)
    with pytest.raises(CoordinateMismatchError):
        await service.record_decision(
            run_id=run_id,
            instance_id=instance_id,
            field_id=other_field_id,
            reviewer_id=profile_id,
            decision=ExtractionReviewerDecisionType.EDIT,
            value={"v": "x"},
        )
    await db_session.rollback()


@pytest.mark.asyncio
async def test_accept_proposal_rejects_cross_coordinate_proposal(
    db_session: AsyncSession,
) -> None:
    """Issue #46: accept_proposal must reject proposals from a different (run, instance, field)."""
    fx = await _setup_review_run(db_session)
    if fx is None:
        pytest.skip("Missing fixtures.")
    run_id, instance_id, field_id, profile_id, _, _ = fx

    # Build a second proposal targeting a DIFFERENT (instance, field) in the same run.
    other_row = await db_session.execute(
        text(
            """
            SELECT i.id, f.id
            FROM public.extraction_instances i
            JOIN public.extraction_entity_types et ON et.id = i.entity_type_id
            JOIN public.extraction_fields f ON f.entity_type_id = et.id
            WHERE (i.id <> :iid OR f.id <> :fid)
              AND i.template_id = (
                  SELECT template_id FROM public.extraction_instances WHERE id = :iid
              )
            LIMIT 1
            """
        ),
        {"iid": instance_id, "fid": field_id},
    )
    other = other_row.first()
    if other is None:
        pytest.skip("Need a second coordinate in the same template.")
    other_instance_id, other_field_id = other

    # The setup left the run in REVIEW; record_proposal requires PROPOSAL.
    # Insert the cross-coord proposal directly via the model to bypass stage checks.
    from app.models.extraction_workflow import ExtractionProposalRecord

    cross_proposal = ExtractionProposalRecord(
        run_id=run_id,
        instance_id=other_instance_id,
        field_id=other_field_id,
        source=ExtractionProposalSource.AI.value,
        proposed_value={"v": "from other field"},
    )
    db_session.add(cross_proposal)
    await db_session.flush()

    service = ExtractionReviewService(db_session)
    with pytest.raises(InvalidDecisionError, match="does not belong"):
        await service.record_decision(
            run_id=run_id,
            instance_id=instance_id,
            field_id=field_id,
            reviewer_id=profile_id,
            decision=ExtractionReviewerDecisionType.ACCEPT_PROPOSAL,
            proposal_record_id=cross_proposal.id,
        )
    await db_session.rollback()


@pytest.mark.asyncio
async def test_accept_proposal_rejects_unknown_proposal_id(
    db_session: AsyncSession,
) -> None:
    """Issue #46: accept_proposal must reject an unknown proposal_record_id."""
    import uuid as _uuid

    fx = await _setup_review_run(db_session)
    if fx is None:
        pytest.skip("Missing fixtures.")
    run_id, instance_id, field_id, profile_id, _, _ = fx

    service = ExtractionReviewService(db_session)
    with pytest.raises(InvalidDecisionError, match="does not belong"):
        await service.record_decision(
            run_id=run_id,
            instance_id=instance_id,
            field_id=field_id,
            reviewer_id=profile_id,
            decision=ExtractionReviewerDecisionType.ACCEPT_PROPOSAL,
            proposal_record_id=_uuid.uuid4(),
        )
    await db_session.rollback()


@pytest.mark.asyncio
async def test_second_decision_replaces_reviewer_state(
    db_session: AsyncSession,
) -> None:
    fx = await _setup_review_run(db_session)
    if fx is None:
        pytest.skip("Missing fixtures.")
    run_id, instance_id, field_id, profile_id, proposal_id, _ = fx

    service = ExtractionReviewService(db_session)
    first = await service.record_decision(
        run_id=run_id,
        instance_id=instance_id,
        field_id=field_id,
        reviewer_id=profile_id,
        decision=ExtractionReviewerDecisionType.ACCEPT_PROPOSAL,
        proposal_record_id=proposal_id,
    )
    second = await service.record_decision(
        run_id=run_id,
        instance_id=instance_id,
        field_id=field_id,
        reviewer_id=profile_id,
        decision=ExtractionReviewerDecisionType.EDIT,
        value={"text": "edited"},
        rationale="changed my mind",
    )
    state = await service.get_reviewer_state(
        run_id=run_id,
        reviewer_id=profile_id,
        instance_id=instance_id,
        field_id=field_id,
    )
    assert state is not None
    assert state.current_decision_id == second.id
    assert state.current_decision_id != first.id
    await db_session.rollback()
