"""Phase 0 reproduction — blind-review isolation is NOT enforced.

Reproduces the multi-user blind-leak found on production: during the
REVIEW stage every reviewer's in-flight decision is readable by any
*other* project member, because the RLS ``SELECT`` policy on
``extraction_reviewer_decisions`` filters by ``is_project_member`` only
— never by the row's ``reviewer_id``. Blinding is therefore enforced
only in frontend JavaScript; a reviewer who hits PostgREST directly (or
just opens devtools) sees their peers' values before consensus.

These tests are RED on the current schema and become GREEN once the
reviewer-scoped RLS migration (consolidation plan, Phase 2) lands:

    A reviewer may read only their OWN reviewer_decisions while the run
    is pre-finalize; managers / consensus may read all; after FINALIZE
    everyone may read all.

They use the real service path (create_run -> advance -> record_decision)
so the reproduction matches production, not a synthetic insert.
"""

from __future__ import annotations

import json
from uuid import UUID

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.extraction import ExtractionRunStage
from app.models.extraction_workflow import (
    ExtractionProposalSource,
    ExtractionReviewerDecisionType,
)
from app.services.extraction_proposal_service import ExtractionProposalService
from app.services.extraction_review_service import ExtractionReviewService
from app.services.run_lifecycle_service import RunLifecycleService

# Sentinel id for an in-test second reviewer (rolled back with the SAVEPOINT).
SECOND_REVIEWER_ID = UUID("ffffffff-9999-0000-0000-0000000000aa")


async def _build_two_reviewer_review_run(
    db: AsyncSession,
) -> tuple[UUID, UUID, UUID] | None:
    """Build a run in REVIEW with a decision from two distinct reviewers.

    Returns ``(run_id, reviewer_a, reviewer_b)`` or ``None`` if the seed
    graph is missing. ``reviewer_a`` is the seeded reviewer; ``reviewer_b``
    is an in-test second reviewer added to the same project.
    """
    project_id = (
        await db.execute(
            text("SELECT project_id FROM public.project_members WHERE role = 'reviewer' LIMIT 1")
        )
    ).scalar()
    if project_id is None:
        return None
    reviewer_a = (
        await db.execute(
            text(
                "SELECT user_id FROM public.project_members "
                "WHERE project_id = :pid AND role = 'reviewer' LIMIT 1"
            ),
            {"pid": str(project_id)},
        )
    ).scalar()
    manager = (
        await db.execute(
            text(
                "SELECT user_id FROM public.project_members "
                "WHERE project_id = :pid AND role = 'manager' LIMIT 1"
            ),
            {"pid": str(project_id)},
        )
    ).scalar()
    article_id = (
        await db.execute(
            text("SELECT id FROM public.articles WHERE project_id = :pid LIMIT 1"),
            {"pid": str(project_id)},
        )
    ).scalar()
    template_id = (
        await db.execute(
            text(
                "SELECT id FROM public.project_extraction_templates "
                "WHERE project_id = :pid AND kind = 'extraction' LIMIT 1"
            ),
            {"pid": str(project_id)},
        )
    ).scalar()
    if not all((reviewer_a, manager, article_id, template_id)):
        return None
    coord = (
        await db.execute(
            text(
                """
                SELECT i.id, f.id
                FROM public.extraction_instances i
                JOIN public.extraction_entity_types et ON et.id = i.entity_type_id
                JOIN public.extraction_fields f ON f.entity_type_id = et.id
                WHERE i.template_id = :tid AND i.article_id = :aid
                LIMIT 1
                """
            ),
            {"tid": str(template_id), "aid": str(article_id)},
        )
    ).first()
    if coord is None:
        return None
    instance_id, field_id = coord

    # Add a second reviewer to the same project (rolled back with the test).
    await db.execute(
        text(
            "INSERT INTO auth.users (id, email, instance_id, aud, role) "
            "VALUES (:id, :email, '00000000-0000-0000-0000-000000000000', "
            "'authenticated', 'authenticated') ON CONFLICT (id) DO NOTHING"
        ),
        {"id": str(SECOND_REVIEWER_ID), "email": "reviewer-b@integration-test.prumo.local"},
    )
    await db.execute(
        text(
            "INSERT INTO public.profiles (id, email, full_name) "
            "VALUES (:id, :email, 'Integration Reviewer B') "
            "ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email"
        ),
        {"id": str(SECOND_REVIEWER_ID), "email": "reviewer-b@integration-test.prumo.local"},
    )
    await db.execute(
        text(
            "INSERT INTO public.project_members (id, project_id, user_id, role) "
            "VALUES (gen_random_uuid(), :pid, :uid, 'reviewer') "
            "ON CONFLICT (project_id, user_id) DO NOTHING"
        ),
        {"pid": str(project_id), "uid": str(SECOND_REVIEWER_ID)},
    )

    lifecycle = RunLifecycleService(db)
    run = await lifecycle.create_run(
        project_id=project_id,
        article_id=article_id,
        project_template_id=template_id,
        user_id=manager,
    )
    await lifecycle.advance_stage(
        run_id=run.id, target_stage=ExtractionRunStage.EXTRACT, user_id=manager
    )
    await ExtractionProposalService(db).record_proposal(
        run_id=run.id,
        instance_id=instance_id,
        field_id=field_id,
        source=ExtractionProposalSource.AI,
        proposed_value={"v": "candidate"},
    )

    review = ExtractionReviewService(db)
    await review.record_decision(
        run_id=run.id,
        instance_id=instance_id,
        field_id=field_id,
        reviewer_id=reviewer_a,
        decision=ExtractionReviewerDecisionType.EDIT,
        value={"value": "REVIEWER-A-SECRET"},
    )
    await review.record_decision(
        run_id=run.id,
        instance_id=instance_id,
        field_id=field_id,
        reviewer_id=SECOND_REVIEWER_ID,
        decision=ExtractionReviewerDecisionType.EDIT,
        value={"value": "REVIEWER-B-SECRET"},
    )
    await db.flush()
    return run.id, UUID(str(reviewer_a)), SECOND_REVIEWER_ID


@pytest.mark.asyncio
async def test_reviewer_cannot_read_peer_decision_during_review(
    db_session: AsyncSession,
) -> None:
    """Under reviewer B's RLS identity, reviewer A's REVIEW decision must
    be invisible. RED today: the SELECT policy is project-scoped, so B
    reads A's secret value before consensus."""
    built = await _build_two_reviewer_review_run(db_session)
    if built is None:
        pytest.skip("Seed graph incomplete")
    run_id, reviewer_a, reviewer_b = built

    # Probe the table as reviewer B (authenticated role + JWT sub = B).
    try:
        await db_session.execute(
            text("SELECT set_config('request.jwt.claims', :claims, true)"),
            {"claims": json.dumps({"sub": str(reviewer_b), "role": "authenticated"})},
        )
        await db_session.execute(text("SET LOCAL ROLE authenticated"))
        visible_peer_rows = (
            await db_session.execute(
                text(
                    "SELECT count(*) FROM public.extraction_reviewer_decisions "
                    "WHERE run_id = :rid AND reviewer_id = :a"
                ),
                {"rid": str(run_id), "a": str(reviewer_a)},
            )
        ).scalar()
    finally:
        await db_session.execute(text("RESET ROLE"))

    assert visible_peer_rows == 0, (
        "Blind-review leak: reviewer B can read reviewer A's in-flight REVIEW "
        f"decision ({visible_peer_rows} row(s) visible). RLS must self-scope by reviewer_id."
    )


@pytest.mark.asyncio
async def test_reviewer_decisions_select_policy_is_reviewer_scoped(
    db_session: AsyncSession,
) -> None:
    """Structural guard for the Phase 2 target: the SELECT policy on
    extraction_reviewer_decisions must reference the row's reviewer_id
    (self-scoping). RED today — the policy only checks is_project_member."""
    expr = (
        await db_session.execute(
            text(
                "SELECT pg_get_expr(p.polqual, p.polrelid) "
                "FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid "
                "WHERE c.relname = 'extraction_reviewer_decisions' "
                "AND p.polname = 'extraction_reviewer_decisions_select'"
            )
        )
    ).scalar()
    assert expr is not None, "SELECT policy missing"
    assert "reviewer_id" in expr, (
        "Blind-review leak: extraction_reviewer_decisions_select does not self-scope "
        f"by reviewer_id. Current policy: {expr}"
    )
