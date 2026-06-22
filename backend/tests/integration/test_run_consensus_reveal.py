"""Auto-reveal a blind arbitrator (manager) on entering consensus (HITL Phase 2, Task 3).

Run-scoped: an arbitrator is unblinded once the run reaches CONSENSUS (mirroring the
FINALIZED auto-unblind); plain reviewers stay blind to peers even in consensus. No
persistent project-toggle is flipped. ``peers_revealed`` echoes the effective unblind.
"""

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.extraction import ExtractionRunStage
from app.services.extraction_review_service import ExtractionReviewService
from app.services.extraction_run_read_service import (
    build_run_view,
    get_run_with_workflow_history,
)
from app.services.run_lifecycle_service import RunLifecycleService
from tests.integration.conftest import SEED


async def _ctx(db: AsyncSession):
    if (
        await db.execute(
            text("SELECT 1 FROM public.profiles WHERE id = :id"),
            {"id": str(SEED.primary_profile)},
        )
    ).scalar() is None:
        return None
    return (
        SEED.primary_project,
        SEED.primary_article,
        SEED.primary_template,
        SEED.primary_profile,
    )


@pytest.mark.asyncio
async def test_arbitrator_auto_revealed_on_consensus_entry(db_session: AsyncSession) -> None:
    ctx = await _ctx(db_session)
    if ctx is None:
        pytest.skip("Missing fixtures.")
    project_id, article_id, template_id, manager_id = ctx
    reviewer_id = SEED.reviewer_profile
    instance_id, field_id = SEED.primary_instance, SEED.primary_field

    # Own the run state for this article/template (the suite leaks runs).
    await db_session.execute(
        text(
            "DELETE FROM public.extraction_runs WHERE project_id = :p "
            "AND article_id = :a AND template_id = :t"
        ),
        {"p": str(project_id), "a": str(article_id), "t": str(template_id)},
    )

    svc = RunLifecycleService(db_session)
    run = await svc.create_run(
        project_id=project_id,
        article_id=article_id,
        project_template_id=template_id,
        user_id=manager_id,
    )
    await svc.advance_stage(
        run_id=run.id, target_stage=ExtractionRunStage.EXTRACT, user_id=manager_id
    )

    # Both the manager and a reviewer record an extraction decision on one coord.
    review = ExtractionReviewService(db_session)
    await review.record_decision(
        run_id=run.id,
        instance_id=instance_id,
        field_id=field_id,
        reviewer_id=manager_id,
        decision="edit",
        value={"value": "M"},
    )
    await review.record_decision(
        run_id=run.id,
        instance_id=instance_id,
        field_id=field_id,
        reviewer_id=reviewer_id,
        decision="edit",
        value={"value": "R"},
    )

    # EXTRACT: a manager with the toggle OFF is blind even though arbitrator.
    detail = await get_run_with_workflow_history(
        db_session, run.id, caller_id=manager_id, can_see_peers=False, caller_is_arbitrator=True
    )
    assert detail.peers_revealed is False
    assert {d.reviewer_id for d in detail.decisions} == {manager_id}

    # Enter consensus.
    await svc.advance_stage(
        run_id=run.id, target_stage=ExtractionRunStage.CONSENSUS, user_id=manager_id
    )

    # CONSENSUS: the arbitrator is auto-revealed → sees BOTH reviewers' decisions.
    detail = await get_run_with_workflow_history(
        db_session, run.id, caller_id=manager_id, can_see_peers=False, caller_is_arbitrator=True
    )
    assert detail.peers_revealed is True
    assert {d.reviewer_id for d in detail.decisions} == {manager_id, reviewer_id}

    # CONSENSUS: a plain reviewer (not arbitrator) stays blind to peers.
    detail = await get_run_with_workflow_history(
        db_session, run.id, caller_id=reviewer_id, can_see_peers=False, caller_is_arbitrator=False
    )
    assert detail.peers_revealed is False
    assert {d.reviewer_id for d in detail.decisions} == {reviewer_id}

    # build_run_view echoes peers_revealed for each caller.
    mgr_view = await build_run_view(
        db_session, run.id, caller_id=manager_id, can_see_peers=False, caller_is_arbitrator=True
    )
    assert mgr_view.peers_revealed is True
    rev_view = await build_run_view(
        db_session, run.id, caller_id=reviewer_id, can_see_peers=False, caller_is_arbitrator=False
    )
    assert rev_view.peers_revealed is False

    await db_session.rollback()
