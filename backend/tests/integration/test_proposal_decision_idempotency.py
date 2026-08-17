"""Identical re-records of a proposal/decision are no-ops.

Defense-in-depth for the re-record-on-mount duplication: even if a client
re-POSTs an unchanged value (the form remount replay, a retry, a curl loop),
the append-only tables must not grow a duplicate row. A genuinely *changed*
value still appends.
"""

from __future__ import annotations

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.extraction import ExtractionRunStage
from app.models.extraction_workflow import ExtractionProposalSource
from app.services.extraction_proposal_service import ExtractionProposalService
from app.services.extraction_review_service import ExtractionReviewService
from app.services.run_lifecycle_service import RunLifecycleService
from tests.integration.conftest import SEED


async def _coord(db: AsyncSession):
    user_id = (
        await db.execute(
            text(
                "SELECT user_id FROM public.project_members "
                "WHERE project_id = :pid AND role = 'manager' LIMIT 1"
            ),
            {"pid": str(SEED.primary_project)},
        )
    ).scalar()
    if user_id is None:
        return None
    # Derive a coherent (project, article, template, instance, field) tuple
    # from the seeded extraction instance's field chain, scoped to the seed
    # project so E2E fixture rows on a shared dev DB can never be picked.
    row = (
        await db.execute(
            text(
                "SELECT i.project_id, i.article_id, i.template_id, i.id, f.id "
                "FROM public.extraction_instances i "
                "JOIN public.extraction_entity_types et ON et.id=i.entity_type_id "
                "JOIN public.extraction_fields f ON f.entity_type_id=et.id "
                "JOIN public.project_extraction_templates t ON t.id=i.template_id "
                "WHERE t.kind='extraction' AND t.project_id = :pid LIMIT 1"
            ),
            {"pid": str(SEED.primary_project)},
        )
    ).first()
    if row is None:
        return None
    project_id, article_id, template_id, instance_id, field_id = row
    return project_id, article_id, template_id, user_id, instance_id, field_id


@pytest.mark.asyncio
async def test_identical_proposal_rerecord_is_a_noop(db_session: AsyncSession) -> None:
    fx = await _coord(db_session)
    if fx is None:
        pytest.skip("Seed graph incomplete")
    project_id, article_id, template_id, user_id, instance_id, field_id = fx

    lc = RunLifecycleService(db_session)
    run = await lc.create_run(
        project_id=project_id,
        article_id=article_id,
        project_template_id=template_id,
        user_id=user_id,
    )
    await lc.advance_stage(run_id=run.id, target_stage=ExtractionRunStage.EXTRACT, user_id=user_id)

    svc = ExtractionProposalService(db_session)
    # AI source: human extraction writes go through /decisions now, but the
    # idempotent re-record guard is source-agnostic, so we exercise it via an
    # AI proposal (allowed on extraction runs in extract).
    args = {
        "run_id": run.id,
        "instance_id": instance_id,
        "field_id": field_id,
        "source": ExtractionProposalSource.AI,
        "proposed_value": {"value": "v"},
    }
    first = await svc.record_proposal(**args)
    second = await svc.record_proposal(**args)  # identical re-record (mount replay)
    await db_session.flush()

    count = (
        await db_session.execute(
            text(
                "SELECT count(*) FROM public.extraction_proposal_records "
                "WHERE run_id=:r AND instance_id=:i AND field_id=:f"
            ),
            {"r": str(run.id), "i": str(instance_id), "f": str(field_id)},
        )
    ).scalar()
    assert count == 1, "identical re-record must not append a duplicate proposal"
    assert second.id == first.id

    changed = await svc.record_proposal(**{**args, "proposed_value": {"value": "v2"}})
    assert changed.id != first.id, "a changed value must still append"


@pytest.mark.asyncio
async def test_verification_sibling_is_ignored_by_the_replay_dedupe(
    db_session: AsyncSession,
) -> None:
    """The Verified-mode ``verification`` ANNOTATION never makes two equal
    values look different: a re-extract whose verify pass flaked (annotation
    absent the second time) must not append a duplicate audit row for an
    unchanged value. The compare is value + absent_reason only."""
    fx = await _coord(db_session)
    if fx is None:
        pytest.skip("Seed graph incomplete")
    project_id, article_id, template_id, user_id, instance_id, field_id = fx

    lc = RunLifecycleService(db_session)
    run = await lc.create_run(
        project_id=project_id,
        article_id=article_id,
        project_template_id=template_id,
        user_id=user_id,
    )
    await lc.advance_stage(run_id=run.id, target_stage=ExtractionRunStage.EXTRACT, user_id=user_id)

    svc = ExtractionProposalService(db_session)
    args = {
        "run_id": run.id,
        "instance_id": instance_id,
        "field_id": field_id,
        "source": ExtractionProposalSource.AI,
        "proposed_value": {"value": "v", "verification": {"verdict": "confirmed"}},
    }
    first = await svc.record_proposal(**args)
    # Re-extract, verify flaked: same value, no annotation. Must dedupe.
    second = await svc.record_proposal(**{**args, "proposed_value": {"value": "v"}})
    assert second.id == first.id, "a flaked verify must not create a duplicate row"

    # A genuinely changed value still appends, annotation or not.
    changed = await svc.record_proposal(
        **{**args, "proposed_value": {"value": "v2", "verification": {"verdict": "unsupported"}}}
    )
    assert changed.id != first.id


@pytest.mark.asyncio
async def test_verdict_change_updates_the_annotation_in_place(
    db_session: AsyncSession,
) -> None:
    """F2: a dedupe hit whose INCOMING verdict differs from the stored one
    refreshes the ``verification`` sibling on the EXISTING row — server-owned
    metadata on an unchanged value, no new audit row. Covers the heal
    (stored-absent -> incoming-present, a re-extract after a flaked verify)
    and the flip (confirmed -> unsupported). An incoming bag WITHOUT the
    sibling never clears a stored verdict."""
    fx = await _coord(db_session)
    if fx is None:
        pytest.skip("Seed graph incomplete")
    project_id, article_id, template_id, user_id, instance_id, field_id = fx

    lc = RunLifecycleService(db_session)
    run = await lc.create_run(
        project_id=project_id,
        article_id=article_id,
        project_template_id=template_id,
        user_id=user_id,
    )
    await lc.advance_stage(run_id=run.id, target_stage=ExtractionRunStage.EXTRACT, user_id=user_id)

    svc = ExtractionProposalService(db_session)
    args = {
        "run_id": run.id,
        "instance_id": instance_id,
        "field_id": field_id,
        "source": ExtractionProposalSource.AI,
        "proposed_value": {"value": "v"},
    }
    first = await svc.record_proposal(**args)  # verify flaked: no annotation

    # Heal: the re-extract's verify succeeded — annotate the EXISTING row.
    healed = await svc.record_proposal(
        **{**args, "proposed_value": {"value": "v", "verification": {"verdict": "confirmed"}}}
    )
    assert healed.id == first.id, "a heal must not append a duplicate row"
    assert healed.proposed_value.get("verification") == {"verdict": "confirmed"}

    # Flip: the verdict moved on the same value — the stored chip updates.
    flipped = await svc.record_proposal(
        **{**args, "proposed_value": {"value": "v", "verification": {"verdict": "unsupported"}}}
    )
    assert flipped.id == first.id
    assert flipped.proposed_value.get("verification") == {"verdict": "unsupported"}

    # A verdict-less replay (fast re-run / flaked verify) never clears.
    replay = await svc.record_proposal(**args)
    assert replay.id == first.id
    assert replay.proposed_value.get("verification") == {"verdict": "unsupported"}

    # The flip PERSISTED (flushed to the row, not just the identity map),
    # and the audit trail holds exactly one row for the coordinate.
    stored, count = (
        await db_session.execute(
            text(
                "SELECT proposed_value, count(*) OVER () "
                "FROM public.extraction_proposal_records "
                "WHERE run_id=:r AND instance_id=:i AND field_id=:f"
            ),
            {"r": str(run.id), "i": str(instance_id), "f": str(field_id)},
        )
    ).first()
    assert count == 1, "verdict updates must never append audit rows"
    assert stored == {"value": "v", "verification": {"verdict": "unsupported"}}


@pytest.mark.asyncio
async def test_identical_decision_rerecord_is_a_noop(db_session: AsyncSession) -> None:
    fx = await _coord(db_session)
    if fx is None:
        pytest.skip("Seed graph incomplete")
    project_id, article_id, template_id, user_id, instance_id, field_id = fx

    lc = RunLifecycleService(db_session)
    run = await lc.create_run(
        project_id=project_id,
        article_id=article_id,
        project_template_id=template_id,
        user_id=user_id,
    )
    await lc.advance_stage(run_id=run.id, target_stage=ExtractionRunStage.EXTRACT, user_id=user_id)

    svc = ExtractionReviewService(db_session)
    args = {
        "run_id": run.id,
        "instance_id": instance_id,
        "field_id": field_id,
        "reviewer_id": user_id,
        "decision": "edit",
        "value": {"value": "v"},
    }
    first = await svc.record_decision(**args)
    second = await svc.record_decision(**args)  # identical re-record
    await db_session.flush()

    count = (
        await db_session.execute(
            text(
                "SELECT count(*) FROM public.extraction_reviewer_decisions "
                "WHERE run_id=:r AND reviewer_id=:u AND instance_id=:i AND field_id=:f"
            ),
            {"r": str(run.id), "u": str(user_id), "i": str(instance_id), "f": str(field_id)},
        )
    ).scalar()
    assert count == 1, "identical re-record must not append a duplicate decision"
    assert second.id == first.id

    changed = await svc.record_decision(**{**args, "value": {"value": "v2"}})
    assert changed.id != first.id, "a changed value must still append"
