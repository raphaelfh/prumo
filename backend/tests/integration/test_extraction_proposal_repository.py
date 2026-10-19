"""``ExtractionProposalRepository.list_by_run``: the run detail's proposal read."""

from __future__ import annotations

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.repositories.extraction_proposal_repository import ExtractionProposalRepository
from tests.integration.conftest import SEED, make_ai_proposal
from tests.integration.helpers.ai_extraction import run_in_extract

pytestmark = pytest.mark.asyncio


async def test_list_by_run_is_chronological_and_scoped_to_the_run(
    db_session: AsyncSession,
) -> None:
    """Every proposal of the run, oldest first — and none from a sibling run
    on the same coordinate."""
    coord = {"instance_id": SEED.primary_instance, "field_id": SEED.primary_field}
    run_a = await run_in_extract(db_session)
    a1 = await make_ai_proposal(db_session, run_id=run_a.id, **coord, proposed_value={"v": "a1"})
    a2 = await make_ai_proposal(db_session, run_id=run_a.id, **coord, proposed_value={"v": "a2"})
    # One live run per coordinate (0045): cancel A before opening B.
    await db_session.execute(
        text("UPDATE extraction_runs SET stage='cancelled', status='failed' WHERE id=:id"),
        {"id": run_a.id},
    )
    run_b = await run_in_extract(db_session)
    b1 = await make_ai_proposal(db_session, run_id=run_b.id, **coord, proposed_value={"v": "b1"})
    # Same-transaction inserts tie on created_at; force a distinct order.
    await db_session.execute(
        text(
            "UPDATE extraction_proposal_records "
            "SET created_at = created_at - interval '1 second' WHERE id = :id"
        ),
        {"id": a1},
    )

    ids = [r.id for r in await ExtractionProposalRepository(db_session).list_by_run(run_a.id)]

    assert ids == [a1, a2]
    assert b1 not in ids
