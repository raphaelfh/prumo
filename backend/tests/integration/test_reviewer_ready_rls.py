"""RLS probes for ``extraction_reviewer_ready`` (blind participation metadata).

The 2026-07-02 security review (finding 2) reversed 0029's "knowing someone is
'done' leaks no values" rationale: WHO marked ready is peer-attributable
participation metadata under the blind contract (ADR-0012). The API path is
scrubbed in ``ExtractionReviewerReadyService.ready_summary_from``; these
probes pin the PostgREST/devtools path — the SELECT policy must self-scope by
``reviewer_id`` with the 0025 arbitrator/finalized carve-outs, so both read
paths encode the identical predicate (architecture doc §3).

Probes run as the ``authenticated`` role with a real JWT sub, mirroring
``test_blind_review_isolation.py``.
"""

from __future__ import annotations

import json
from uuid import UUID

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.extraction_reviewer_ready_service import ExtractionReviewerReadyService
from tests.integration.test_blind_review_isolation import (
    _build_two_reviewer_review_run,
)


async def _ready_two_reviewer_run(
    db: AsyncSession,
) -> tuple[UUID, UUID, UUID] | None:
    """The two-reviewer EXTRACT-stage run with BOTH reviewers marked ready."""
    built = await _build_two_reviewer_review_run(db)
    if built is None:
        return None
    run_id, reviewer_a, reviewer_b = built
    service = ExtractionReviewerReadyService(db)
    await service.mark_ready(run_id=run_id, reviewer_id=reviewer_a, is_ready=True)
    await service.mark_ready(run_id=run_id, reviewer_id=reviewer_b, is_ready=True)
    await db.flush()
    return run_id, reviewer_a, reviewer_b


async def _visible_ready_rows(
    db: AsyncSession, *, as_user: UUID, run_id: UUID, reviewer_id: UUID
) -> int:
    """Count ready rows for ``reviewer_id`` visible to ``as_user`` under RLS."""
    try:
        await db.execute(
            text("SELECT set_config('request.jwt.claims', :claims, true)"),
            {"claims": json.dumps({"sub": str(as_user), "role": "authenticated"})},
        )
        await db.execute(text("SET LOCAL ROLE authenticated"))
        return (
            await db.execute(
                text(
                    "SELECT count(*) FROM public.extraction_reviewer_ready "
                    "WHERE run_id = :rid AND reviewer_id = :reviewer"
                ),
                {"rid": str(run_id), "reviewer": str(reviewer_id)},
            )
        ).scalar_one()
    finally:
        await db.execute(text("RESET ROLE"))


@pytest.mark.asyncio
async def test_blind_reviewer_cannot_read_peer_ready_rows(
    db_session: AsyncSession,
) -> None:
    built = await _ready_two_reviewer_run(db_session)
    if built is None:
        pytest.skip("Seed graph incomplete")
    run_id, reviewer_a, reviewer_b = built

    own = await _visible_ready_rows(
        db_session, as_user=reviewer_b, run_id=run_id, reviewer_id=reviewer_b
    )
    assert own == 1, "a reviewer must keep reading their OWN ready row"

    peer = await _visible_ready_rows(
        db_session, as_user=reviewer_b, run_id=run_id, reviewer_id=reviewer_a
    )
    assert peer == 0, (
        "blind leak via PostgREST: a plain reviewer can read a peer's ready "
        f"row ({peer} row(s) visible). The SELECT policy must self-scope by reviewer_id."
    )


@pytest.mark.asyncio
async def test_arbitrator_reads_all_ready_rows(db_session: AsyncSession) -> None:
    """A manager/consensus arbitrator keeps full visibility (0025 carve-out) —
    RLS deliberately stays looser than the API's manager-toggle policy
    (ADR-0012: manager blindness is a UX policy, not a security boundary)."""
    built = await _ready_two_reviewer_run(db_session)
    if built is None:
        pytest.skip("Seed graph incomplete")
    run_id, reviewer_a, _reviewer_b = built

    manager = (
        await db_session.execute(
            text(
                "SELECT pm.user_id FROM public.project_members pm "
                "JOIN public.extraction_runs r ON r.project_id = pm.project_id "
                "WHERE r.id = :rid AND pm.role = 'manager' LIMIT 1"
            ),
            {"rid": str(run_id)},
        )
    ).scalar()
    if manager is None:
        pytest.skip("Seed graph incomplete")

    peer = await _visible_ready_rows(
        db_session, as_user=UUID(str(manager)), run_id=run_id, reviewer_id=reviewer_a
    )
    assert peer == 1, "an arbitrator must see every reviewer's ready row"


@pytest.mark.asyncio
async def test_finalized_run_reveals_ready_rows(db_session: AsyncSession) -> None:
    built = await _ready_two_reviewer_run(db_session)
    if built is None:
        pytest.skip("Seed graph incomplete")
    run_id, reviewer_a, reviewer_b = built

    await db_session.execute(
        text("UPDATE public.extraction_runs SET stage = 'finalized' WHERE id = :id"),
        {"id": str(run_id)},
    )
    await db_session.flush()

    peer = await _visible_ready_rows(
        db_session, as_user=reviewer_b, run_id=run_id, reviewer_id=reviewer_a
    )
    assert peer == 1, (
        "finalized runs must reveal ready rows (the policy gates on stage, not blanket-hide peers)"
    )


@pytest.mark.asyncio
async def test_reviewer_ready_select_policy_is_reviewer_scoped(
    db_session: AsyncSession,
) -> None:
    """Structural guard: the SELECT policy must reference the row's
    reviewer_id (self-scoping), mirroring the 0025 pattern on
    extraction_reviewer_decisions."""
    expr = (
        await db_session.execute(
            text(
                "SELECT pg_get_expr(p.polqual, p.polrelid) "
                "FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid "
                "WHERE c.relname = 'extraction_reviewer_ready' "
                "AND p.polname = 'extraction_reviewer_ready_select'"
            )
        )
    ).scalar()
    assert expr is not None, "SELECT policy missing"
    assert "reviewer_id" in expr, (
        "Blind leak: extraction_reviewer_ready_select does not self-scope "
        f"by reviewer_id. Current policy: {expr}"
    )
