"""Integration tests for ExtractionConsensusService."""

from uuid import UUID

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.extraction import ExtractionRunStage
from app.models.extraction_workflow import (
    ExtractionConsensusMode,
    ExtractionProposalSource,
    ExtractionReviewerDecisionType,
)
from app.services.extraction_consensus_service import (
    ExtractionConsensusService,
    InvalidConsensusError,
    OptimisticConcurrencyError,
)
from app.services.extraction_proposal_service import ExtractionProposalService
from app.services.extraction_review_service import ExtractionReviewService
from app.services.run_lifecycle_service import RunLifecycleService


async def _setup_consensus_run(
    db: AsyncSession,
) -> tuple[UUID, UUID, UUID, UUID, UUID] | None:
    """Build run, advance to consensus stage, return (run_id, instance_id, field_id, profile_id, decision_id)."""
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
        proposed_value={"v": "candidate"},
    )
    await lifecycle.advance_stage(
        run_id=run.id,
        target_stage=ExtractionRunStage.REVIEW,
        user_id=profile_id,
    )
    decision = await ExtractionReviewService(db).record_decision(
        run_id=run.id,
        instance_id=instance_id,
        field_id=field_id,
        reviewer_id=profile_id,
        decision=ExtractionReviewerDecisionType.ACCEPT_PROPOSAL,
        proposal_record_id=proposal.id,
    )
    await lifecycle.advance_stage(
        run_id=run.id,
        target_stage=ExtractionRunStage.CONSENSUS,
        user_id=profile_id,
    )
    return run.id, instance_id, field_id, profile_id, decision.id


@pytest.mark.asyncio
async def test_record_select_existing_consensus_publishes_state(
    db_session: AsyncSession,
) -> None:
    fx = await _setup_consensus_run(db_session)
    if fx is None:
        pytest.skip("Missing fixtures.")
    run_id, instance_id, field_id, profile_id, decision_id = fx

    service = ExtractionConsensusService(db_session)
    consensus, published = await service.record_consensus(
        run_id=run_id,
        instance_id=instance_id,
        field_id=field_id,
        consensus_user_id=profile_id,
        mode=ExtractionConsensusMode.SELECT_EXISTING,
        selected_decision_id=decision_id,
    )
    assert consensus.mode == "select_existing"
    assert published.version == 1
    await db_session.rollback()


@pytest.mark.asyncio
async def test_select_existing_requires_decision_id(
    db_session: AsyncSession,
) -> None:
    fx = await _setup_consensus_run(db_session)
    if fx is None:
        pytest.skip("Missing fixtures.")
    run_id, instance_id, field_id, profile_id, _ = fx

    service = ExtractionConsensusService(db_session)
    with pytest.raises(InvalidConsensusError):
        await service.record_consensus(
            run_id=run_id,
            instance_id=instance_id,
            field_id=field_id,
            consensus_user_id=profile_id,
            mode=ExtractionConsensusMode.SELECT_EXISTING,
            selected_decision_id=None,
        )
    await db_session.rollback()


@pytest.mark.asyncio
async def test_manual_override_requires_value_and_rationale(
    db_session: AsyncSession,
) -> None:
    fx = await _setup_consensus_run(db_session)
    if fx is None:
        pytest.skip("Missing fixtures.")
    run_id, instance_id, field_id, profile_id, _ = fx

    service = ExtractionConsensusService(db_session)
    with pytest.raises(InvalidConsensusError):
        await service.record_consensus(
            run_id=run_id,
            instance_id=instance_id,
            field_id=field_id,
            consensus_user_id=profile_id,
            mode=ExtractionConsensusMode.MANUAL_OVERRIDE,
            value=None,
            rationale=None,
        )
    await db_session.rollback()


@pytest.mark.asyncio
async def test_record_consensus_rejects_incoherent_coordinates(
    db_session: AsyncSession,
) -> None:
    fx = await _setup_consensus_run(db_session)
    if fx is None:
        pytest.skip("Missing fixtures.")
    run_id, instance_id, _, profile_id, _ = fx
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

    service = ExtractionConsensusService(db_session)
    with pytest.raises(CoordinateMismatchError):
        await service.record_consensus(
            run_id=run_id,
            instance_id=instance_id,
            field_id=other_field_id,
            consensus_user_id=profile_id,
            mode=ExtractionConsensusMode.MANUAL_OVERRIDE,
            value={"v": "x"},
            rationale="test",
        )
    await db_session.rollback()


@pytest.mark.asyncio
async def test_publish_optimistic_concurrency_conflict(
    db_session: AsyncSession,
) -> None:
    fx = await _setup_consensus_run(db_session)
    if fx is None:
        pytest.skip("Missing fixtures.")
    run_id, instance_id, field_id, profile_id, decision_id = fx

    service = ExtractionConsensusService(db_session)
    _, published = await service.record_consensus(
        run_id=run_id,
        instance_id=instance_id,
        field_id=field_id,
        consensus_user_id=profile_id,
        mode=ExtractionConsensusMode.SELECT_EXISTING,
        selected_decision_id=decision_id,
    )
    # Second consensus with stale expected_version should raise.
    with pytest.raises(OptimisticConcurrencyError):
        await service.publish(
            run_id=run_id,
            instance_id=instance_id,
            field_id=field_id,
            value={"v": "stale"},
            published_by=profile_id,
            expected_version=99,  # stale
        )
    await db_session.rollback()


# ---- Bug-fix regression tests ----


@pytest.mark.asyncio
async def test_select_existing_rejects_reject_decision(
    db_session: AsyncSession,
) -> None:
    """Issue #53: selecting a reject decision must raise, not publish {}."""
    # Build a run where the existing decision is a REJECT (not accept_proposal).
    project_id = (await db_session.execute(text("SELECT id FROM public.projects LIMIT 1"))).scalar()
    article_id = (await db_session.execute(text("SELECT id FROM public.articles LIMIT 1"))).scalar()
    template_id = (
        await db_session.execute(text("SELECT id FROM public.project_extraction_templates LIMIT 1"))
    ).scalar()
    profile_id = (await db_session.execute(text("SELECT id FROM public.profiles LIMIT 1"))).scalar()
    if not all((project_id, article_id, template_id, profile_id)):
        pytest.skip("Missing fixtures.")
    row = await db_session.execute(
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
        pytest.skip("Missing instance/field.")
    instance_id, field_id = pair

    lifecycle = RunLifecycleService(db_session)
    run = await lifecycle.create_run(
        project_id=project_id,
        article_id=article_id,
        project_template_id=template_id,
        user_id=profile_id,
    )
    await lifecycle.advance_stage(
        run_id=run.id, target_stage=ExtractionRunStage.PROPOSAL, user_id=profile_id
    )
    await ExtractionProposalService(db_session).record_proposal(
        run_id=run.id,
        instance_id=instance_id,
        field_id=field_id,
        source=ExtractionProposalSource.AI,
        proposed_value={"v": "x"},
    )
    await lifecycle.advance_stage(
        run_id=run.id, target_stage=ExtractionRunStage.REVIEW, user_id=profile_id
    )
    reject = await ExtractionReviewService(db_session).record_decision(
        run_id=run.id,
        instance_id=instance_id,
        field_id=field_id,
        reviewer_id=profile_id,
        decision=ExtractionReviewerDecisionType.REJECT,
    )
    await lifecycle.advance_stage(
        run_id=run.id, target_stage=ExtractionRunStage.CONSENSUS, user_id=profile_id
    )
    service = ExtractionConsensusService(db_session)
    with pytest.raises(InvalidConsensusError, match="reject"):
        await service.record_consensus(
            run_id=run.id,
            instance_id=instance_id,
            field_id=field_id,
            consensus_user_id=profile_id,
            mode=ExtractionConsensusMode.SELECT_EXISTING,
            selected_decision_id=reject.id,
        )
    await db_session.rollback()


@pytest.mark.asyncio
async def test_select_existing_rejects_cross_coordinate_decision(
    db_session: AsyncSession,
) -> None:
    """Issue #42: selected_decision_id from a different (instance,field) must fail."""
    fx = await _setup_consensus_run(db_session)
    if fx is None:
        pytest.skip("Missing fixtures.")
    run_id, instance_id, field_id, profile_id, decision_id = fx

    # Find a different (instance, field) coordinate in the same template.
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

    service = ExtractionConsensusService(db_session)
    # decision_id is for (instance_id, field_id); call consensus on the OTHER coord.
    with pytest.raises(InvalidConsensusError, match="belongs to"):
        await service.record_consensus(
            run_id=run_id,
            instance_id=other_instance_id,
            field_id=other_field_id,
            consensus_user_id=profile_id,
            mode=ExtractionConsensusMode.SELECT_EXISTING,
            selected_decision_id=decision_id,
        )
    await db_session.rollback()


@pytest.mark.asyncio
async def test_publish_requires_consensus_stage(
    db_session: AsyncSession,
) -> None:
    """Issue #43: publish() must reject runs that are not in CONSENSUS stage."""
    project_id = (await db_session.execute(text("SELECT id FROM public.projects LIMIT 1"))).scalar()
    article_id = (await db_session.execute(text("SELECT id FROM public.articles LIMIT 1"))).scalar()
    template_id = (
        await db_session.execute(text("SELECT id FROM public.project_extraction_templates LIMIT 1"))
    ).scalar()
    profile_id = (await db_session.execute(text("SELECT id FROM public.profiles LIMIT 1"))).scalar()
    if not all((project_id, article_id, template_id, profile_id)):
        pytest.skip("Missing fixtures.")
    row = await db_session.execute(
        text(
            """
            SELECT i.id, f.id FROM public.extraction_instances i
            JOIN public.extraction_entity_types et ON et.id = i.entity_type_id
            JOIN public.extraction_fields f ON f.entity_type_id = et.id
            WHERE i.template_id = :tid LIMIT 1
            """
        ),
        {"tid": template_id},
    )
    pair = row.first()
    if pair is None:
        pytest.skip("Missing instance/field.")
    instance_id, field_id = pair

    lifecycle = RunLifecycleService(db_session)
    run = await lifecycle.create_run(
        project_id=project_id,
        article_id=article_id,
        project_template_id=template_id,
        user_id=profile_id,
    )
    # Leave the run in PROPOSAL — not CONSENSUS.
    service = ExtractionConsensusService(db_session)
    with pytest.raises(InvalidConsensusError, match="not 'consensus'"):
        await service.publish(
            run_id=run.id,
            instance_id=instance_id,
            field_id=field_id,
            value={"v": "x"},
            published_by=profile_id,
            expected_version=1,
        )
    await db_session.rollback()


@pytest.mark.asyncio
async def test_publish_unknown_run_raises(db_session: AsyncSession) -> None:
    """Issue #43: publish() must reject unknown run_id."""
    import uuid as _uuid

    profile_id = (await db_session.execute(text("SELECT id FROM public.profiles LIMIT 1"))).scalar()
    if profile_id is None:
        pytest.skip("Missing profile.")
    service = ExtractionConsensusService(db_session)
    with pytest.raises(InvalidConsensusError, match="not found"):
        await service.publish(
            run_id=_uuid.uuid4(),
            instance_id=_uuid.uuid4(),
            field_id=_uuid.uuid4(),
            value={"v": "x"},
            published_by=profile_id,
            expected_version=1,
        )
    await db_session.rollback()


@pytest.mark.asyncio
async def test_republish_updates_published_at_timestamp(
    db_session: AsyncSession,
) -> None:
    """Issue #45: published_at must advance on each consensus re-publish."""
    fx = await _setup_consensus_run(db_session)
    if fx is None:
        pytest.skip("Missing fixtures.")
    run_id, instance_id, field_id, profile_id, decision_id = fx

    service = ExtractionConsensusService(db_session)
    _, first = await service.record_consensus(
        run_id=run_id,
        instance_id=instance_id,
        field_id=field_id,
        consensus_user_id=profile_id,
        mode=ExtractionConsensusMode.SELECT_EXISTING,
        selected_decision_id=decision_id,
    )
    # Snapshot the values now: the ORM instance may be mutated by the second call
    # because expire_on_commit=False keeps the row attached to the session.
    first_version = first.version
    # Force the row's published_at into the past so we can prove the UPDATE
    # refreshes it (func.now() returns transaction_timestamp(), so two writes
    # in the same txn would otherwise share the same value).
    await db_session.execute(
        text(
            "UPDATE public.extraction_published_states "
            "SET published_at = TIMESTAMPTZ '2000-01-01 00:00:00+00' "
            "WHERE run_id = :rid AND instance_id = :iid AND field_id = :fid"
        ),
        {"rid": run_id, "iid": instance_id, "fid": field_id},
    )
    await db_session.flush()
    # Re-publish via manual_override (independent value).
    _, second = await service.record_consensus(
        run_id=run_id,
        instance_id=instance_id,
        field_id=field_id,
        consensus_user_id=profile_id,
        mode=ExtractionConsensusMode.MANUAL_OVERRIDE,
        value={"v": "edited"},
        rationale="re-publish",
    )
    assert second.version == first_version + 1
    # The UPDATE must have refreshed published_at past the stamped-past value.
    assert second.published_at.year > 2000
    await db_session.rollback()
