"""resolve_caller_current_values must mirror the frontend loadValuesForUser it
replaces: human proposals are the base layer, the caller's current reviewer
decision (via the materialized reviewer_states pointer) overrides, and another
reviewer's rows are never returned (caller-scoped blind boundary)."""

from __future__ import annotations

import json
from uuid import uuid4

import pytest
from sqlalchemy import text
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

    values = await resolve_caller_current_values(db_session, uuid4(), caller_id=uuid4())
    assert values == [], "no matching rows must resolve to an empty list"


@pytest.mark.asyncio
async def test_current_values_include_system_seeded_proposals(
    db_session: AsyncSession,
) -> None:
    """Reopen support (D8): a reopened QA run is seeded with ``source='system'``
    proposals carrying the finalized parent's values. With
    ``include_system_seeds`` (build_run_view passes it for QA runs — the QA
    publish path flows from the form, so hydrated seeds survive) Layer 1
    surfaces them to EVERY caller (system rows are not reviewer-attributable,
    so there is no blind concern), while a caller's own decision still
    overrides (Layer 2). Without the flag — extraction runs, whose
    post-extract stages read decisions only — system rows stay hidden, so a
    seed can never render as a value that silently vanishes at consensus."""
    built = await _build_two_reviewer_review_run(db_session)
    if built is None:
        pytest.skip("Seed graph incomplete")
    run_id, reviewer_a, _reviewer_b = built

    coord = (
        await db_session.execute(
            text(
                "SELECT instance_id, field_id FROM public.extraction_reviewer_decisions "
                "WHERE run_id = :rid LIMIT 1"
            ),
            {"rid": str(run_id)},
        )
    ).first()
    assert coord is not None
    instance_id, field_id = coord

    await db_session.execute(
        text(
            "INSERT INTO public.extraction_proposal_records "
            "(id, run_id, instance_id, field_id, source, proposed_value) "
            "VALUES (gen_random_uuid(), :rid, :iid, :fid, 'system', CAST(:val AS jsonb))"
        ),
        {
            "rid": str(run_id),
            "iid": str(instance_id),
            "fid": str(field_id),
            "val": json.dumps({"value": "SYSTEM-SEEDED"}),
        },
    )

    # A fresh caller (no decisions, no human proposals) sees the seed when
    # the QA flag is on.
    values = await resolve_caller_current_values(
        db_session, run_id, caller_id=uuid4(), include_system_seeds=True
    )
    seeded = [v for v in values if (v.instance_id, v.field_id) == (instance_id, field_id)]
    assert len(seeded) == 1, "system-seeded proposal must hydrate for a fresh caller"
    assert seeded[0].value == {"value": "SYSTEM-SEEDED"}
    assert seeded[0].decision == "system_proposal"

    # Reviewer A's own edit decision still overrides the seed on that coord.
    a_values = await resolve_caller_current_values(
        db_session, run_id, caller_id=reviewer_a, include_system_seeds=True
    )
    a_rows = [v for v in a_values if (v.instance_id, v.field_id) == (instance_id, field_id)]
    assert len(a_rows) == 1
    assert a_rows[0].value == {"value": "REVIEWER-A-SECRET"}

    # Default (extraction runs): system rows stay hidden.
    default_values = await resolve_caller_current_values(db_session, run_id, caller_id=uuid4())
    assert default_values == [], "system seeds must not hydrate without the QA flag"


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
