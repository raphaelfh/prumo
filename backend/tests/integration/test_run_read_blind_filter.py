"""Service/API-path blind-review enforcement (RLS-independent).

The backend reads run history as ``service_role`` (RLS bypassed), so the
reviewer-scoped RLS migration alone does NOT stop ``GET /runs/{id}`` from
returning every reviewer's decisions. ``get_run_with_workflow_history``
applies the same predicate in Python — these tests pin it.

The two-reviewer REVIEW-stage builder is reused from the RLS reproduction so
the setup matches production exactly.
"""

from __future__ import annotations

import json

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.extraction_run_read_service import get_run_with_workflow_history
from tests.integration.test_blind_review_isolation import (
    _build_two_reviewer_review_run,
)


def _decisions_json(detail) -> str:
    return json.dumps([d.model_dump(mode="json") for d in detail.decisions])


@pytest.mark.asyncio
async def test_plain_reviewer_get_run_hides_peer_decision_pre_finalize(
    db_session: AsyncSession,
) -> None:
    built = await _build_two_reviewer_review_run(db_session)
    if built is None:
        pytest.skip("Seed graph incomplete")
    run_id, reviewer_a, reviewer_b = built

    detail = await get_run_with_workflow_history(
        db_session, run_id, caller_id=reviewer_b, can_see_peers=False
    )
    reviewer_ids = {d.reviewer_id for d in detail.decisions}
    assert reviewer_b in reviewer_ids, "a reviewer must see their own decision"
    assert reviewer_a not in reviewer_ids, (
        "blind leak via API: a plain reviewer received a peer's REVIEW decision"
    )
    assert "REVIEWER-A-SECRET" not in _decisions_json(detail)


@pytest.mark.asyncio
async def test_arbitrator_get_run_sees_all_decisions_pre_finalize(
    db_session: AsyncSession,
) -> None:
    built = await _build_two_reviewer_review_run(db_session)
    if built is None:
        pytest.skip("Seed graph incomplete")
    run_id, reviewer_a, reviewer_b = built

    detail = await get_run_with_workflow_history(
        db_session, run_id, caller_id=reviewer_a, can_see_peers=True
    )
    reviewer_ids = {d.reviewer_id for d in detail.decisions}
    assert {reviewer_a, reviewer_b} <= reviewer_ids, (
        "an arbitrator must see every reviewer's decision to resolve consensus"
    )
    blob = _decisions_json(detail)
    assert "REVIEWER-A-SECRET" in blob and "REVIEWER-B-SECRET" in blob


@pytest.mark.asyncio
async def test_finalized_run_reveals_all_decisions_to_reviewer(
    db_session: AsyncSession,
) -> None:
    built = await _build_two_reviewer_review_run(db_session)
    if built is None:
        pytest.skip("Seed graph incomplete")
    run_id, reviewer_a, _reviewer_b = built

    # Force finalize so the carve-out (history is public once finalized) applies.
    await db_session.execute(
        text("UPDATE public.extraction_runs SET stage = 'finalized' WHERE id = :id"),
        {"id": str(run_id)},
    )
    # Raw UPDATE bypasses the ORM identity map; expire so db.get re-reads stage.
    db_session.expire_all()

    detail = await get_run_with_workflow_history(
        db_session, run_id, caller_id=_reviewer_b, can_see_peers=False
    )
    reviewer_ids = {d.reviewer_id for d in detail.decisions}
    assert reviewer_a in reviewer_ids, (
        "finalized runs must reveal full history (filter must gate on stage, "
        "not blanket-hide peers)"
    )
