"""Integration tests for RunLifecycleService.reopen_to_extract.

The arbitrator-only backward transition consensus -> extract that discards the
run's consensus work (ConsensusDecision + PublishedState; consensus-attached
evidence cascades) while preserving reviewer decisions. See ADR-0017 and
docs/superpowers/specs/2026-07-08-manager-reopen-consensus-to-extract-design.md.
"""

from __future__ import annotations

from uuid import uuid4

import pytest
from httpx import AsyncClient
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.extraction import ExtractionEvidence, ExtractionRun, ExtractionRunStage
from app.models.extraction_workflow import (
    ExtractionConsensusDecision,
    ExtractionPublishedState,
    ExtractionReviewerDecision,
)
from app.services.run_lifecycle_service import (
    InvalidStageTransitionError,
    RunLifecycleService,
)
from tests.integration.conftest import SEED
from tests.integration.test_extraction_runs_endpoints import (
    API_PREFIX,
    _auth_as,
    _setup_consensus_run,
    _setup_review_run,
)

pytestmark = pytest.mark.asyncio


async def _resolve_one(db_client: AsyncClient, run_id, instance_id, field_id, decision_id) -> None:
    """Publish one coord via select_existing -> 1 ConsensusDecision + 1 PublishedState."""
    r = await db_client.post(
        f"{API_PREFIX}/{run_id}/consensus",
        json={
            "instance_id": str(instance_id),
            "field_id": str(field_id),
            "mode": "select_existing",
            "selected_decision_id": str(decision_id),
        },
    )
    assert r.status_code == 201, r.text


async def _insert_evidence(
    db: AsyncSession, run_id, *, consensus_decision_id=None, reviewer_decision_id=None
):
    run = await db.get(ExtractionRun, run_id)
    assert run is not None
    ev = ExtractionEvidence(
        project_id=run.project_id,
        article_id=run.article_id,
        run_id=run.id,
        consensus_decision_id=consensus_decision_id,
        reviewer_decision_id=reviewer_decision_id,
        text_content="evidence",
        created_by=SEED.primary_profile,
    )
    db.add(ev)
    await db.flush()
    return ev.id


async def _count(db: AsyncSession, model, run_id) -> int:
    return (
        await db.execute(select(func.count()).select_from(model).where(model.run_id == run_id))
    ).scalar_one()


async def test_reopen_to_extract_clears_consensus_preserves_reviewer_work(
    db_client: AsyncClient, db_session: AsyncSession
) -> None:
    _auth_as(SEED.primary_profile)  # manager / arbitrator
    run_id, instance_id, field_id, decision_id = await _setup_consensus_run(db_client, db_session)
    await _resolve_one(db_client, run_id, instance_id, field_id, decision_id)

    reopened, dc, dp = await RunLifecycleService(db_session).reopen_to_extract(
        run_id=run_id, user_id=SEED.primary_profile
    )

    assert reopened.stage == ExtractionRunStage.EXTRACT.value
    assert (dc, dp) == (1, 1)
    assert await _count(db_session, ExtractionConsensusDecision, run_id) == 0
    assert await _count(db_session, ExtractionPublishedState, run_id) == 0
    # Reviewer work is preserved.
    assert await _count(db_session, ExtractionReviewerDecision, run_id) >= 1


async def test_reopen_to_extract_no_resolution_is_noop_delete(
    db_client: AsyncClient, db_session: AsyncSession
) -> None:
    _auth_as(SEED.primary_profile)
    run_id, *_ = await _setup_consensus_run(db_client, db_session)  # consensus, unresolved

    reopened, dc, dp = await RunLifecycleService(db_session).reopen_to_extract(
        run_id=run_id, user_id=SEED.primary_profile
    )

    assert reopened.stage == ExtractionRunStage.EXTRACT.value
    assert (dc, dp) == (0, 0)


async def test_reopen_to_extract_from_extract_stage_rejected(
    db_client: AsyncClient, db_session: AsyncSession
) -> None:
    _auth_as(SEED.primary_profile)
    run_id, *_ = await _setup_review_run(db_client, db_session)  # pre-consensus

    with pytest.raises(InvalidStageTransitionError):
        await RunLifecycleService(db_session).reopen_to_extract(
            run_id=run_id, user_id=SEED.primary_profile
        )


async def test_reopen_to_extract_missing_run_raises_valueerror(
    db_session: AsyncSession,
) -> None:
    with pytest.raises(ValueError):
        await RunLifecycleService(db_session).reopen_to_extract(
            run_id=uuid4(), user_id=SEED.primary_profile
        )


async def test_reopen_to_extract_cascades_consensus_evidence(
    db_client: AsyncClient, db_session: AsyncSession
) -> None:
    _auth_as(SEED.primary_profile)
    run_id, instance_id, field_id, decision_id = await _setup_consensus_run(db_client, db_session)
    await _resolve_one(db_client, run_id, instance_id, field_id, decision_id)
    consensus_id = (
        await db_session.execute(
            select(ExtractionConsensusDecision.id).where(
                ExtractionConsensusDecision.run_id == run_id
            )
        )
    ).scalar_one()

    await _insert_evidence(db_session, run_id, consensus_decision_id=consensus_id)
    await _insert_evidence(db_session, run_id, reviewer_decision_id=decision_id)

    await RunLifecycleService(db_session).reopen_to_extract(
        run_id=run_id, user_id=SEED.primary_profile
    )

    # Evidence on the consensus decision cascaded away; reviewer evidence survives.
    ev_consensus = (
        await db_session.execute(
            select(func.count())
            .select_from(ExtractionEvidence)
            .where(ExtractionEvidence.consensus_decision_id == consensus_id)
        )
    ).scalar_one()
    ev_reviewer = (
        await db_session.execute(
            select(func.count())
            .select_from(ExtractionEvidence)
            .where(ExtractionEvidence.reviewer_decision_id == decision_id)
        )
    ).scalar_one()
    assert ev_consensus == 0
    assert ev_reviewer == 1
