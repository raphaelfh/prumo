"""build_run_view composes get_run_with_workflow_history (the single blind
filter) and adds entity_types + current_values. It must NOT re-introduce a
blind leak, and current_values must be empty in proposal stage."""

from __future__ import annotations

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.extraction_run_read_service import build_run_view
from tests.integration.test_blind_review_isolation import (
    _build_two_reviewer_review_run,
)
from tests.integration.test_run_proposals_latest_wins import _proposal_stage_coord


@pytest.mark.asyncio
async def test_build_run_view_blinds_peer_in_review(db_session: AsyncSession) -> None:
    built = await _build_two_reviewer_review_run(db_session)
    if built is None:
        pytest.skip("Seed graph incomplete")
    run_id, reviewer_a, reviewer_b = built

    view = await build_run_view(db_session, run_id, caller_id=reviewer_b, can_see_peers=False)
    reviewer_ids = {d.reviewer_id for d in view.decisions}
    assert reviewer_b in reviewer_ids
    assert reviewer_a not in reviewer_ids, "build_run_view leaked a peer decision"
    assert view.entity_types, "entity_types tree must be populated"
    assert isinstance(view.current_values, list)


@pytest.mark.asyncio
async def test_build_run_view_current_values_empty_in_proposal(
    db_session: AsyncSession,
) -> None:
    fx = await _proposal_stage_coord(db_session)
    if fx is None:
        pytest.skip("Seed graph incomplete")
    run_id, _instance_id, _field_id, user_id = fx

    view = await build_run_view(db_session, run_id, caller_id=user_id, can_see_peers=False)
    assert view.run.stage == "proposal"
    assert view.current_values == [], (
        "proposal stage must use proposals[] on the client, not server current_values"
    )
