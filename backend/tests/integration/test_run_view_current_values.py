"""resolve_caller_current_values must mirror the frontend loadValuesForUser it
replaces: human proposals are the base layer, the caller's current reviewer
decision (via the materialized reviewer_states pointer) overrides, and another
reviewer's rows are never returned (caller-scoped blind boundary)."""

from __future__ import annotations

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.extraction_run_read_service import resolve_caller_current_values
from tests.integration.test_blind_review_isolation import (
    _build_two_reviewer_review_run,
)


@pytest.mark.asyncio
async def test_current_values_are_caller_scoped(db_session: AsyncSession) -> None:
    built = await _build_two_reviewer_review_run(db_session)
    if built is None:
        pytest.skip("Seed graph incomplete")
    run_id, reviewer_a, reviewer_b = built

    a_values = await resolve_caller_current_values(db_session, run_id, caller_id=reviewer_a)
    b_values = await resolve_caller_current_values(db_session, run_id, caller_id=reviewer_b)
    assert a_values, "reviewer A should resolve at least one current value"
    a_blob = " ".join(str(v.value) for v in a_values)
    assert "REVIEWER-B-SECRET" not in a_blob
    b_blob = " ".join(str(v.value) for v in b_values)
    assert "REVIEWER-A-SECRET" not in b_blob


@pytest.mark.asyncio
async def test_current_values_empty_when_no_caller_rows(
    db_session: AsyncSession,
) -> None:
    # No reviewer_states and no human proposals for this (run, caller) — the
    # resolver returns an EMPTY list, not an error (the proposal stage path never
    # calls this). Use non-existent ids so emptiness is deterministic (a LIMIT 1
    # real run/user could already share rows and make `== []` flaky).
    from uuid import uuid4

    values = await resolve_caller_current_values(db_session, uuid4(), caller_id=uuid4())
    assert values == [], "no matching rows must resolve to an empty list"


@pytest.mark.asyncio
async def test_current_values_match_loadvaluesforuser_contract(
    db_session: AsyncSession,
) -> None:
    built = await _build_two_reviewer_review_run(db_session)
    if built is None:
        pytest.skip("Seed graph incomplete")
    run_id, reviewer_a, _reviewer_b = built

    values = await resolve_caller_current_values(db_session, run_id, caller_id=reviewer_a)
    assert values, "reviewer A must resolve at least their own current value"
    by_decision = {v.decision for v in values}
    assert by_decision <= {"human_proposal", "edit", "accept_proposal", "reject"}

    # TIGHTEN — pin against _build_two_reviewer_review_run's REAL output for
    # reviewer A. The builder records ONE reviewer decision for A: an ``edit``
    # with value ``{"value": "REVIEWER-A-SECRET"}``, and (via record_decision ->
    # _states.upsert) the materialized extraction_reviewer_states pointer that
    # Layer 2 joins on. The only proposal it records is an AI proposal
    # (source='ai'), so reviewer A has NO human-proposal base layer and NO
    # reject — the single resolved coord must come through Layer 2.
    edits = [v for v in values if v.decision == "edit"]
    assert len(edits) == 1, (
        "reviewer A's single edit decision must resolve to exactly one coord "
        "via the reviewer_states pointer (Layer 2 override)"
    )
    edit = edits[0]
    # loadValuesForUser semantics: the decision's OWN value is sourced (the raw
    # jsonb envelope), NOT an accepted proposal's value, NOT the AI candidate.
    assert edit.value == {"value": "REVIEWER-A-SECRET"}
    # The builder produces no human proposal and no reject for reviewer A, so
    # those decision kinds must be absent (a stray 'human_proposal' would mean
    # Layer 1 leaked the AI candidate; a 'reject' would be fabricated).
    assert "human_proposal" not in by_decision
    assert "reject" not in by_decision
    # No accept_proposal either — the lone decision is an edit.
    assert by_decision == {"edit"}
