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
    project_id = (
        await db.execute(text("SELECT id FROM public.projects LIMIT 1"))
    ).scalar()
    article_id = (
        await db.execute(text("SELECT id FROM public.articles LIMIT 1"))
    ).scalar()
    template_id = (
        await db.execute(
            text("SELECT id FROM public.project_extraction_templates LIMIT 1")
        )
    ).scalar()
    profile_id = (
        await db.execute(text("SELECT id FROM public.profiles LIMIT 1"))
    ).scalar()
    instance_id = (
        await db.execute(text("SELECT id FROM public.extraction_instances LIMIT 1"))
    ).scalar()
    field_id = (
        await db.execute(text("SELECT id FROM public.extraction_fields LIMIT 1"))
    ).scalar()
    if not all((project_id, article_id, template_id, profile_id, instance_id, field_id)):
        return None

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
