"""Shared setup for the extraction export suites (rows written in the test SAVEPOINT)."""

from __future__ import annotations

from uuid import UUID, uuid4

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.extraction import ExtractionRun, TemplateKind
from app.models.extraction_workflow import (
    ExtractionReviewerDecision,
    ExtractionReviewerDecisionType,
    ExtractionReviewerState,
)
from app.services.extraction_export_service import ExtractionExportService
from app.services.hitl_session_service import HITLSessionService


async def make_run(
    db: AsyncSession, *, project_id: UUID, article_id: UUID, template_id: UUID, profile_id: UUID
) -> ExtractionRun:
    """Create a fresh PROPOSAL run for the coord (clearing leaked runs
    first; the test's rolled-back session undoes both)."""
    await db.execute(
        text(
            "DELETE FROM public.extraction_runs WHERE project_id = :pid "
            "AND article_id = :aid AND template_id = :tid"
        ),
        {"pid": str(project_id), "aid": str(article_id), "tid": str(template_id)},
    )
    session = await HITLSessionService(db).open_or_resume(
        kind=TemplateKind.EXTRACTION,
        project_id=project_id,
        article_id=article_id,
        user_id=profile_id,
        project_template_id=template_id,
    )
    run = await db.get(ExtractionRun, session.run_id)
    assert run is not None
    return run


async def record_decision(
    db: AsyncSession,
    *,
    run_id: UUID,
    instance_id: UUID,
    field_id: UUID,
    reviewer_id: UUID,
    decision: ExtractionReviewerDecisionType,
    proposal_record_id: UUID | None = None,
    value: dict[str, object] | None = None,
) -> ExtractionReviewerDecision:
    """Insert a reviewer decision + the matching ``current_decision_id``
    state pointer for one reviewer on one (run, instance, field) coord.

    The composite FK ``(run_id, current_decision_id)`` requires the
    decision and state to agree on ``run_id``; we flush the decision
    first so its id is available for the state pointer.
    """
    dec = ExtractionReviewerDecision(
        id=uuid4(),
        run_id=run_id,
        instance_id=instance_id,
        field_id=field_id,
        reviewer_id=reviewer_id,
        decision=decision.value,
        proposal_record_id=proposal_record_id,
        value=value,
    )
    db.add(dec)
    await db.flush()
    db.add(
        ExtractionReviewerState(
            id=uuid4(),
            run_id=run_id,
            reviewer_id=reviewer_id,
            instance_id=instance_id,
            field_id=field_id,
            current_decision_id=dec.id,
        )
    )
    await db.flush()
    return dec


def export_service(db: AsyncSession, *, profile_id: UUID) -> ExtractionExportService:
    return ExtractionExportService(db=db, user_id=str(profile_id), trace_id="t")
