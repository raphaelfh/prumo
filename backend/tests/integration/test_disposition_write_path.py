"""ADR-0016 Phase 2 write-path normalization + consensus agreement on markers.

Two properties are load-bearing and pinned here:

1. ``ExtractionReviewService.record_decision`` normalizes a picked in-band
   disposition string into the coded ``absent_reason`` marker, scoped by the
   field's domain (a coincidental free-text match is left untouched).
2. The marker is persisted **verbatim** into ``ExtractionReviewerDecision.value``
   so the consensus agreement key distinguishes two different codes (same code
   agrees + publishes; different codes diverge) — the precondition the spec
   calls out for "distinct answers fall out for free".
"""

from __future__ import annotations

import json

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.extraction import ExtractionRunStage
from app.services.extraction_review_service import ExtractionReviewService
from app.services.run_lifecycle_service import (
    InvalidStageTransitionError,
    RunLifecycleService,
)
from tests.integration.conftest import SEED

_NO_INFO = {"value": None, "absent_reason": "no_information"}
_NOT_APPLICABLE = {"value": None, "absent_reason": "not_applicable"}


async def _seed_ok(db: AsyncSession) -> bool:
    return (
        await db.execute(
            text("SELECT 1 FROM public.profiles WHERE id = :id"),
            {"id": str(SEED.primary_profile)},
        )
    ).scalar() is not None


async def _fresh_run(db: AsyncSession) -> object:
    await db.execute(
        text(
            "DELETE FROM public.extraction_runs WHERE project_id = :p "
            "AND article_id = :a AND template_id = :t"
        ),
        {
            "p": str(SEED.primary_project),
            "a": str(SEED.primary_article),
            "t": str(SEED.primary_template),
        },
    )
    svc = RunLifecycleService(db)
    run = await svc.create_run(
        project_id=SEED.primary_project,
        article_id=SEED.primary_article,
        project_template_id=SEED.primary_template,
        user_id=SEED.primary_profile,
    )
    await svc.advance_stage(run_id=run.id, target_stage="extract", user_id=SEED.primary_profile)
    return run


async def _set_field_domain(db: AsyncSession, allowed: list[str] | None) -> None:
    await db.execute(
        text("UPDATE public.extraction_fields SET allowed_values = :v WHERE id = :id"),
        {"v": json.dumps(allowed) if allowed is not None else None, "id": str(SEED.primary_field)},
    )


async def _decision_value(db: AsyncSession, run_id) -> dict | None:
    return (
        await db.execute(
            text(
                "SELECT value FROM public.extraction_reviewer_decisions "
                "WHERE run_id = :r AND field_id = :f ORDER BY created_at DESC LIMIT 1"
            ),
            {"r": str(run_id), "f": str(SEED.primary_field)},
        )
    ).scalar()


@pytest.mark.asyncio
async def test_record_decision_normalizes_picked_disposition_to_marker(
    db_session: AsyncSession,
) -> None:
    if not await _seed_ok(db_session):
        pytest.skip("seed not present")
    run = await _fresh_run(db_session)
    # The field's domain offers "No information" (transitional dropdown option).
    await _set_field_domain(db_session, ["Yes", "No", "No information"])

    await ExtractionReviewService(db_session).record_decision(
        run_id=run.id,
        instance_id=SEED.primary_instance,
        field_id=SEED.primary_field,
        reviewer_id=SEED.primary_profile,
        decision="edit",
        value={"value": "No information"},
    )
    assert await _decision_value(db_session, run.id) == _NO_INFO
    await db_session.rollback()


@pytest.mark.asyncio
async def test_record_decision_leaves_free_text_disposition_untouched(
    db_session: AsyncSession,
) -> None:
    """A free-text field (no allowed_values) that legitimately holds "NA" must NOT
    be rewritten — the domain-scoped guard protects a coincidental match."""
    if not await _seed_ok(db_session):
        pytest.skip("seed not present")
    run = await _fresh_run(db_session)
    await _set_field_domain(db_session, None)

    await ExtractionReviewService(db_session).record_decision(
        run_id=run.id,
        instance_id=SEED.primary_instance,
        field_id=SEED.primary_field,
        reviewer_id=SEED.primary_profile,
        decision="edit",
        value={"value": "NA"},
    )
    assert await _decision_value(db_session, run.id) == {"value": "NA"}
    await db_session.rollback()


@pytest.mark.asyncio
async def test_two_reviewers_same_disposition_code_agree_and_publish(
    db_session: AsyncSession,
) -> None:
    if not await _seed_ok(db_session):
        pytest.skip("seed not present")
    run = await _fresh_run(db_session)
    review = ExtractionReviewService(db_session)
    for reviewer in (SEED.primary_profile, SEED.reviewer_profile):
        await review.record_decision(
            run_id=run.id,
            instance_id=SEED.primary_instance,
            field_id=SEED.primary_field,
            reviewer_id=reviewer,
            decision="edit",
            value=dict(_NO_INFO),
        )
    svc = RunLifecycleService(db_session)
    await svc.advance_stage(run_id=run.id, target_stage="consensus", user_id=SEED.primary_profile)

    finalized, published_count = await svc.approve_and_finalize(
        run_id=run.id, user_id=SEED.primary_profile
    )
    assert finalized.stage == ExtractionRunStage.FINALIZED.value
    assert published_count == 1
    published = (
        await db_session.execute(
            text("SELECT value FROM public.extraction_published_states WHERE run_id = :r"),
            {"r": str(run.id)},
        )
    ).scalar()
    assert published == _NO_INFO, "the agreed marker must publish verbatim (not collapsed to null)"
    await db_session.rollback()


@pytest.mark.asyncio
async def test_two_reviewers_different_disposition_codes_diverge(
    db_session: AsyncSession,
) -> None:
    if not await _seed_ok(db_session):
        pytest.skip("seed not present")
    run = await _fresh_run(db_session)
    review = ExtractionReviewService(db_session)
    await review.record_decision(
        run_id=run.id,
        instance_id=SEED.primary_instance,
        field_id=SEED.primary_field,
        reviewer_id=SEED.primary_profile,
        decision="edit",
        value=dict(_NO_INFO),
    )
    await review.record_decision(
        run_id=run.id,
        instance_id=SEED.primary_instance,
        field_id=SEED.primary_field,
        reviewer_id=SEED.reviewer_profile,
        decision="edit",
        value=dict(_NOT_APPLICABLE),
    )
    svc = RunLifecycleService(db_session)
    await svc.advance_stage(run_id=run.id, target_stage="consensus", user_id=SEED.primary_profile)

    with pytest.raises(InvalidStageTransitionError, match="diverge"):
        await svc.approve_and_finalize(run_id=run.id, user_id=SEED.primary_profile)
    await db_session.rollback()
