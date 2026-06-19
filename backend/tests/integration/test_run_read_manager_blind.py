"""Per-kind manager blind-review enforcement (caller_can_see_peers + build_run_view).

Managers are blind to peers by default; revealed only when the live, per-kind
project setting ``managers_see_reviewers[kind]`` is true. Consensus members
always see peers (pure adjudicators); plain reviewers never do. The extraction
and quality-assessment toggles are independent (the rule keys on ``run.kind``).

This is the API/app-layer half of the deliberate manager-only split: the
reviewer<->reviewer boundary stays in RLS 0025 + resolve_caller_current_values
(unchanged); only the manager case is gated here by the live setting.
"""

from __future__ import annotations

from uuid import UUID, uuid4

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.extraction_run_read_service import build_run_view, caller_can_see_peers
from app.services.manager_review_visibility_service import ManagerReviewVisibilityService
from tests.integration.test_blind_review_isolation import _build_two_reviewer_review_run


async def _project_id(db: AsyncSession, run_id: UUID) -> UUID:
    pid = (
        await db.execute(
            text("SELECT project_id FROM public.extraction_runs WHERE id = :id"),
            {"id": str(run_id)},
        )
    ).scalar()
    return UUID(str(pid))


async def _manager_id(db: AsyncSession, project_id: UUID) -> UUID | None:
    m = (
        await db.execute(
            text(
                "SELECT user_id FROM public.project_members "
                "WHERE project_id = :pid AND role = 'manager' LIMIT 1"
            ),
            {"pid": str(project_id)},
        )
    ).scalar()
    return UUID(str(m)) if m else None


async def _add_consensus_member(db: AsyncSession, project_id: UUID) -> UUID:
    """Insert a fresh project member with role='consensus' (rolled back with the test)."""
    uid = uuid4()
    email = f"consensus-{uid}@integration-test.prumo.local"
    await db.execute(
        text(
            "INSERT INTO auth.users (id, email, instance_id, aud, role) "
            "VALUES (:id, :email, '00000000-0000-0000-0000-000000000000', "
            "'authenticated', 'authenticated') ON CONFLICT (id) DO NOTHING"
        ),
        {"id": str(uid), "email": email},
    )
    await db.execute(
        text(
            "INSERT INTO public.profiles (id, email, full_name) "
            "VALUES (:id, :email, 'Integration Consensus') "
            "ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email"
        ),
        {"id": str(uid), "email": email},
    )
    await db.execute(
        text(
            "INSERT INTO public.project_members (id, project_id, user_id, role) "
            "VALUES (gen_random_uuid(), :pid, :uid, 'consensus') "
            "ON CONFLICT (project_id, user_id) DO NOTHING"
        ),
        {"pid": str(project_id), "uid": str(uid)},
    )
    await db.flush()
    return uid


@pytest.mark.asyncio
async def test_manager_blind_by_default_then_revealed(db_session: AsyncSession) -> None:
    built = await _build_two_reviewer_review_run(db_session)
    if built is None:
        pytest.skip("Seed graph incomplete")
    run_id, reviewer_a, reviewer_b = built
    project_id = await _project_id(db_session, run_id)
    manager = await _manager_id(db_session, project_id)
    assert manager is not None, "seed project must have a manager"

    # Default (no setting) -> manager is blind to peers; end-to-end via build_run_view.
    can = await caller_can_see_peers(
        db_session, project_id=project_id, user_id=manager, kind="extraction"
    )
    assert can is False
    blind = await build_run_view(db_session, run_id, caller_id=manager, can_see_peers=can)
    blind_ids = {d.reviewer_id for d in blind.decisions}
    assert reviewer_a not in blind_ids and reviewer_b not in blind_ids

    # Reveal extraction -> manager now sees both reviewers' decisions.
    await ManagerReviewVisibilityService(db_session).set_for_project(
        project_id=project_id, kind="extraction", value=True
    )
    can2 = await caller_can_see_peers(
        db_session, project_id=project_id, user_id=manager, kind="extraction"
    )
    assert can2 is True
    revealed = await build_run_view(db_session, run_id, caller_id=manager, can_see_peers=can2)
    assert {reviewer_a, reviewer_b} <= {d.reviewer_id for d in revealed.decisions}


@pytest.mark.asyncio
async def test_per_kind_independence(db_session: AsyncSession) -> None:
    built = await _build_two_reviewer_review_run(db_session)
    if built is None:
        pytest.skip("Seed graph incomplete")
    run_id, _a, _b = built
    project_id = await _project_id(db_session, run_id)
    manager = await _manager_id(db_session, project_id)
    assert manager is not None

    await ManagerReviewVisibilityService(db_session).set_for_project(
        project_id=project_id, kind="extraction", value=True
    )
    # Extraction revealed, QA still blind — fully independent toggles.
    assert (
        await caller_can_see_peers(
            db_session, project_id=project_id, user_id=manager, kind="extraction"
        )
        is True
    )
    assert (
        await caller_can_see_peers(
            db_session, project_id=project_id, user_id=manager, kind="quality_assessment"
        )
        is False
    )


@pytest.mark.asyncio
async def test_reviewer_always_blind_consensus_always_sees(db_session: AsyncSession) -> None:
    built = await _build_two_reviewer_review_run(db_session)
    if built is None:
        pytest.skip("Seed graph incomplete")
    run_id, reviewer_a, _b = built
    project_id = await _project_id(db_session, run_id)

    # Reveal managers — a plain reviewer is STILL blind regardless of the setting.
    await ManagerReviewVisibilityService(db_session).set_for_project(
        project_id=project_id, kind="extraction", value=True
    )
    assert (
        await caller_can_see_peers(
            db_session, project_id=project_id, user_id=reviewer_a, kind="extraction"
        )
        is False
    )

    # A consensus member always sees peers, even with the manager toggle OFF.
    consensus = await _add_consensus_member(db_session, project_id)
    await ManagerReviewVisibilityService(db_session).set_for_project(
        project_id=project_id, kind="extraction", value=False
    )
    assert (
        await caller_can_see_peers(
            db_session, project_id=project_id, user_id=consensus, kind="extraction"
        )
        is True
    )
