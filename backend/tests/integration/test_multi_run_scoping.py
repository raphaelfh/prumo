"""Integration tests for multi-run scoping invariants.

Mirrors the production scenario that triggered the recent bug: a single
(project × article × template) tuple can carry many non-terminal Runs
(batch extraction, reopens, contract-test pollution). Decisions /
proposals must always be evaluated against the *specific* Run id passed
in by the caller — never re-resolved against "the latest non-terminal
run", which is the trap the frontend ``findActiveRun`` fallback used to
fall into.

The invariants we lock down here are:

* Recording a decision on a PENDING run fails — decisions only land in
  REVIEW. The autosave that triggered this rule wrote ``human``
  proposals (not decisions) on PROPOSAL after the unification, so
  PENDING runs aren't expected to receive decision writes anymore.
* Recording a decision on a REVIEW-stage run that lives next to other
  PENDING / REVIEW runs succeeds and the ReviewerState row is scoped
  exclusively to *that* run.
* The composite FK on ``extraction_reviewer_states.current_decision_id``
  forbids a state row pointing at a decision in a different Run (db-level
  guarantee added by migration 0005).
"""

from __future__ import annotations

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
from app.services.extraction_review_service import (
    ExtractionReviewService,
    InvalidDecisionError,
)
from app.services.run_lifecycle_service import RunLifecycleService


async def _coords(
    db: AsyncSession,
) -> tuple[UUID, UUID, UUID, UUID, UUID, UUID] | None:
    """Resolve (project_id, article_id, template_id, profile_id, instance_id, field_id)
    for an extraction-kind template that has at least one matching instance and field.
    Returns None if the dev DB hasn't been seeded — caller should ``pytest.skip``."""
    project_id = (
        await db.execute(text("SELECT id FROM public.projects LIMIT 1"))
    ).scalar()
    article_id = (
        await db.execute(text("SELECT id FROM public.articles LIMIT 1"))
    ).scalar()
    template_id = (
        await db.execute(
            text(
                "SELECT id FROM public.project_extraction_templates "
                "WHERE kind = 'extraction' LIMIT 1"
            )
        )
    ).scalar()
    profile_id = (
        await db.execute(text("SELECT id FROM public.profiles LIMIT 1"))
    ).scalar()
    if not all((project_id, article_id, template_id, profile_id)):
        return None
    pair = (
        await db.execute(
            text(
                """
                SELECT i.id, f.id
                FROM public.extraction_instances i
                JOIN public.extraction_entity_types et ON et.id = i.entity_type_id
                JOIN public.extraction_fields f ON f.entity_type_id = et.id
                WHERE i.template_id = :tid
                LIMIT 1
                """
            ),
            {"tid": template_id},
        )
    ).first()
    if pair is None:
        return None
    return project_id, article_id, template_id, profile_id, pair[0], pair[1]


@pytest.mark.asyncio
async def test_decision_on_pending_run_is_rejected(db_session: AsyncSession) -> None:
    """The decisions endpoint requires REVIEW stage. Even if a PENDING
    run is the *latest* one on the article, a decision targeted at it
    must 400.

    With the QA-style autosave (every keystroke is a ``human`` proposal
    on PROPOSAL), this scenario is no longer reachable from the form,
    but the gate remains as a backend invariant."""
    fx = await _coords(db_session)
    if fx is None:
        pytest.skip("Missing fixtures.")
    project_id, article_id, template_id, profile_id, instance_id, field_id = fx

    lifecycle = RunLifecycleService(db_session)
    pending_run = await lifecycle.create_run(
        project_id=project_id,
        article_id=article_id,
        project_template_id=template_id,
        user_id=profile_id,
        parameters={"reason": "multi-run-scope test pending"},
    )
    assert pending_run.stage == ExtractionRunStage.PENDING.value

    service = ExtractionReviewService(db_session)
    with pytest.raises(InvalidDecisionError, match="not 'review'"):
        await service.record_decision(
            run_id=pending_run.id,
            instance_id=instance_id,
            field_id=field_id,
            reviewer_id=profile_id,
            decision=ExtractionReviewerDecisionType.EDIT,
            value={"value": "X"},
        )
    await db_session.rollback()


@pytest.mark.asyncio
async def test_decision_targets_specific_run_even_with_siblings(
    db_session: AsyncSession,
) -> None:
    """Article carries (PENDING, PROPOSAL, REVIEW) at the same time. A
    decision on the REVIEW run succeeds and leaves the others untouched —
    the ReviewerState row is scoped to that run only."""
    fx = await _coords(db_session)
    if fx is None:
        pytest.skip("Missing fixtures.")
    project_id, article_id, template_id, profile_id, instance_id, field_id = fx

    lifecycle = RunLifecycleService(db_session)

    # Sibling PENDING run on the same article — never advances. This is
    # exactly the situation that tricked the frontend ``findActiveRun``
    # fallback into picking the wrong run.
    pending_sibling = await lifecycle.create_run(
        project_id=project_id,
        article_id=article_id,
        project_template_id=template_id,
        user_id=profile_id,
        parameters={"reason": "multi-run-scope sibling pending"},
    )

    # Sibling PROPOSAL run — also non-terminal, but no proposals on it.
    proposal_sibling = await lifecycle.create_run(
        project_id=project_id,
        article_id=article_id,
        project_template_id=template_id,
        user_id=profile_id,
        parameters={"reason": "multi-run-scope sibling proposal"},
    )
    await lifecycle.advance_stage(
        run_id=proposal_sibling.id,
        target_stage=ExtractionRunStage.PROPOSAL,
        user_id=profile_id,
    )

    # Active REVIEW-stage run that the user is editing.
    target_run = await lifecycle.create_run(
        project_id=project_id,
        article_id=article_id,
        project_template_id=template_id,
        user_id=profile_id,
        parameters={"reason": "multi-run-scope target review"},
    )
    await lifecycle.advance_stage(
        run_id=target_run.id,
        target_stage=ExtractionRunStage.PROPOSAL,
        user_id=profile_id,
    )
    proposal = await ExtractionProposalService(db_session).record_proposal(
        run_id=target_run.id,
        instance_id=instance_id,
        field_id=field_id,
        source=ExtractionProposalSource.AI,
        proposed_value={"value": "ai-suggestion"},
    )
    await lifecycle.advance_stage(
        run_id=target_run.id,
        target_stage=ExtractionRunStage.REVIEW,
        user_id=profile_id,
    )

    # Stage sanity for the runs we just built. We deliberately do NOT
    # assert anything about the absolute "latest non-terminal sibling" here
    # — the dev DB carries unrelated runs from other tests / contract suites,
    # and the bug we're guarding against is specifically that the latest
    # (whatever its stage) gets resolved as the target. The decision MUST
    # respect the run id the caller passes in, regardless of what's around.
    assert target_run.stage == ExtractionRunStage.REVIEW.value
    pending_after = (
        await db_session.execute(
            text("SELECT stage FROM public.extraction_runs WHERE id = :id"),
            {"id": str(pending_sibling.id)},
        )
    ).scalar()
    assert pending_after == ExtractionRunStage.PENDING.value
    proposal_after = (
        await db_session.execute(
            text("SELECT stage FROM public.extraction_runs WHERE id = :id"),
            {"id": str(proposal_sibling.id)},
        )
    ).scalar()
    assert proposal_after == ExtractionRunStage.PROPOSAL.value

    service = ExtractionReviewService(db_session)
    decision = await service.record_decision(
        run_id=target_run.id,
        instance_id=instance_id,
        field_id=field_id,
        reviewer_id=profile_id,
        decision=ExtractionReviewerDecisionType.ACCEPT_PROPOSAL,
        proposal_record_id=proposal.id,
    )

    # Reviewer state for THIS run carries the decision.
    state_for_target = await service.get_reviewer_state(
        run_id=target_run.id,
        reviewer_id=profile_id,
        instance_id=instance_id,
        field_id=field_id,
    )
    assert state_for_target is not None
    assert state_for_target.current_decision_id == decision.id

    # No reviewer state was created for the sibling runs.
    state_for_pending = await service.get_reviewer_state(
        run_id=pending_sibling.id,
        reviewer_id=profile_id,
        instance_id=instance_id,
        field_id=field_id,
    )
    assert state_for_pending is None
    state_for_proposal = await service.get_reviewer_state(
        run_id=proposal_sibling.id,
        reviewer_id=profile_id,
        instance_id=instance_id,
        field_id=field_id,
    )
    assert state_for_proposal is None
    await db_session.rollback()


@pytest.mark.asyncio
async def test_reviewer_state_cannot_point_at_decision_in_other_run(
    db_session: AsyncSession,
) -> None:
    """Migration 0005 replaces the simple FK on ``current_decision_id``
    with a composite ``(run_id, current_decision_id)`` FK so a state row
    can never point at a decision in a different run. This test exercises
    that invariant directly."""
    fx = await _coords(db_session)
    if fx is None:
        pytest.skip("Missing fixtures.")
    project_id, article_id, template_id, profile_id, instance_id, field_id = fx

    lifecycle = RunLifecycleService(db_session)
    review_service = ExtractionReviewService(db_session)
    proposals = ExtractionProposalService(db_session)

    # Build two REVIEW-stage runs, each with one decision on the same coordinate.
    async def _build_review_run() -> tuple[UUID, UUID]:
        run = await lifecycle.create_run(
            project_id=project_id,
            article_id=article_id,
            project_template_id=template_id,
            user_id=profile_id,
            parameters={"reason": "composite-FK guard"},
        )
        await lifecycle.advance_stage(
            run_id=run.id,
            target_stage=ExtractionRunStage.PROPOSAL,
            user_id=profile_id,
        )
        proposal = await proposals.record_proposal(
            run_id=run.id,
            instance_id=instance_id,
            field_id=field_id,
            source=ExtractionProposalSource.AI,
            proposed_value={"value": "v"},
        )
        await lifecycle.advance_stage(
            run_id=run.id,
            target_stage=ExtractionRunStage.REVIEW,
            user_id=profile_id,
        )
        decision = await review_service.record_decision(
            run_id=run.id,
            instance_id=instance_id,
            field_id=field_id,
            reviewer_id=profile_id,
            decision=ExtractionReviewerDecisionType.ACCEPT_PROPOSAL,
            proposal_record_id=proposal.id,
        )
        return run.id, decision.id

    run_a, _decision_a = await _build_review_run()
    _run_b, decision_b = await _build_review_run()

    # Try to point run_a's reviewer_state at decision_b (which belongs to
    # run_b). The composite FK should reject it.
    with pytest.raises(Exception) as exc_info:
        await db_session.execute(
            text(
                """
                UPDATE public.extraction_reviewer_states
                SET current_decision_id = :did
                WHERE run_id = :rid
                  AND reviewer_id = :uid
                  AND instance_id = :iid
                  AND field_id = :fid
                """
            ),
            {
                "did": str(decision_b),
                "rid": str(run_a),
                "uid": str(profile_id),
                "iid": str(instance_id),
                "fid": str(field_id),
            },
        )
        await db_session.flush()

    msg = str(exc_info.value).lower()
    assert "foreign key" in msg or "violates" in msg, (
        f"Expected FK violation, got: {exc_info.value!r}"
    )
    await db_session.rollback()