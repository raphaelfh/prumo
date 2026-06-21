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


async def _coord(db: AsyncSession):
    user_id = (await db.execute(text("SELECT id FROM public.profiles LIMIT 1"))).scalar()
    if user_id is None:
        return None
    # Derive a coherent (project, article, template, instance, field) tuple
    # from a real extraction instance with a field chain. Scoping off the
    # instance (rather than picking projects LIMIT 1, which on the shared dev
    # DB can land on a project that has no extraction template) keeps the
    # graph coherent so create_run / record_proposal don't fail.
    row = (
        await db.execute(
            text(
                "SELECT i.project_id, i.article_id, i.template_id, i.id, f.id "
                "FROM public.extraction_instances i "
                "JOIN public.extraction_entity_types et ON et.id=i.entity_type_id "
                "JOIN public.extraction_fields f ON f.entity_type_id=et.id "
                "JOIN public.project_extraction_templates t ON t.id=i.template_id "
                "WHERE t.kind='extraction' LIMIT 1"
            )
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
