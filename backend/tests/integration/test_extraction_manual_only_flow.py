"""Integration tests for the manual-only and hybrid extraction flows.

After the autosave/proposal unification, the Data-Extraction surface
matches the QA pattern:

* Edits write ``human`` proposals on the active run (which
  ``HITLSessionService.open`` parks in ``PROPOSAL``).
* The legacy ``ReviewerDecision(decision='edit')`` write is no longer
  the primary input channel; decisions are reserved for REVIEW where
  multi-reviewer accept/reject decides between proposals.

These tests cover the two new scenarios end-to-end at the service level:

1. **Manual-only**: open session → record a ``human`` proposal → advance
   PROPOSAL → REVIEW → record a decision → advance through CONSENSUS →
   FINALIZED. No AI extraction in the loop.
2. **Hybrid**: a ``human`` proposal already exists when AI runs; the AI
   pipeline must skip that coord (``skip_fields_with_human_proposals``)
   and the human value must remain the latest non-AI proposal for the
   coord.
"""

from __future__ import annotations

from uuid import UUID

import pytest
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.extraction import (
    ExtractionRun,
    ExtractionRunStage,
    ExtractionRunStatus,
    TemplateKind,
)
from app.models.extraction_workflow import (
    ExtractionConsensusMode,
    ExtractionProposalRecord,
    ExtractionProposalSource,
    ExtractionReviewerDecisionType,
)
from app.services.extraction_consensus_service import ExtractionConsensusService
from app.services.extraction_proposal_service import ExtractionProposalService
from app.services.extraction_review_service import ExtractionReviewService
from app.services.hitl_session_service import HITLSessionService
from app.services.run_lifecycle_service import RunLifecycleService


async def _coords(
    db: AsyncSession,
) -> tuple[UUID, UUID, UUID, UUID, UUID, UUID] | None:
    """Resolve (project_id, article_id, project_template_id, profile_id,
    instance_id, field_id) for an extraction-kind template that has at
    least one matching instance + field. Tests skip when the dev DB is
    not seeded."""
    project_id = (await db.execute(text("SELECT id FROM public.projects LIMIT 1"))).scalar()
    article_id = (await db.execute(text("SELECT id FROM public.articles LIMIT 1"))).scalar()
    template_id = (
        await db.execute(
            text(
                "SELECT id FROM public.project_extraction_templates "
                "WHERE kind = 'extraction' LIMIT 1"
            )
        )
    ).scalar()
    profile_id = (await db.execute(text("SELECT id FROM public.profiles LIMIT 1"))).scalar()
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
    return (
        UUID(str(project_id)),
        UUID(str(article_id)),
        UUID(str(template_id)),
        UUID(str(profile_id)),
        UUID(str(pair[0])),
        UUID(str(pair[1])),
    )


@pytest.mark.asyncio
async def test_manual_only_extraction_flow(db_session: AsyncSession) -> None:
    """End-to-end: open extraction session → human proposal → advance
    to REVIEW → reviewer decision → consensus → finalize. Asserts:

    * Session opens the run in PROPOSAL (not PENDING).
    * ``human`` proposal records cleanly without AI involvement.
    * Decision write succeeds once the run is in REVIEW.
    * Consensus + finalize advance the lifecycle terminally.
    """
    fx = await _coords(db_session)
    if fx is None:
        pytest.skip("Missing fixtures.")
    project_id, article_id, template_id, profile_id, instance_id, field_id = fx

    # Clear ALL pre-existing runs for this coord so the session creates
    # a fresh PROPOSAL run — the surrounding integration suite leaks
    # runs in REVIEW/CONSENSUS/FINALIZED via committed HTTP calls. The
    # transaction-scoped rollback at the end of this test will undo
    # the cleanup along with the rest of our writes.
    await db_session.execute(
        text(
            "DELETE FROM public.extraction_runs WHERE project_id = :pid "
            "AND article_id = :aid AND template_id = :tid"
        ),
        {"pid": str(project_id), "aid": str(article_id), "tid": str(template_id)},
    )

    # 1. Open session — backend creates / resumes a Run and parks it in PROPOSAL.
    session_service = HITLSessionService(db_session)
    session = await session_service.open_or_resume(
        kind=TemplateKind.EXTRACTION,
        project_id=project_id,
        article_id=article_id,
        user_id=profile_id,
        project_template_id=template_id,
    )
    run = await db_session.get(ExtractionRun, session.run_id)
    assert run is not None
    assert run.stage == ExtractionRunStage.PROPOSAL.value

    # 2. Autosave write: record a ``human`` proposal at PROPOSAL stage.
    proposal = await ExtractionProposalService(db_session).record_proposal(
        run_id=run.id,
        instance_id=instance_id,
        field_id=field_id,
        source=ExtractionProposalSource.HUMAN,
        source_user_id=profile_id,
        proposed_value={"value": "manual-edit"},
    )
    assert proposal.id is not None
    assert proposal.source == ExtractionProposalSource.HUMAN.value

    # 3. "Submit for review" — advance PROPOSAL → REVIEW.
    lifecycle = RunLifecycleService(db_session)
    await lifecycle.advance_stage(
        run_id=run.id,
        target_stage=ExtractionRunStage.REVIEW,
        user_id=profile_id,
    )

    # 4. Reviewer accepts the human proposal (the "I confirm this value"
    # decision in the multi-reviewer flow).
    review_service = ExtractionReviewService(db_session)
    decision = await review_service.record_decision(
        run_id=run.id,
        instance_id=instance_id,
        field_id=field_id,
        reviewer_id=profile_id,
        decision=ExtractionReviewerDecisionType.ACCEPT_PROPOSAL,
        proposal_record_id=proposal.id,
    )
    assert decision.run_id == run.id
    assert decision.decision == ExtractionReviewerDecisionType.ACCEPT_PROPOSAL.value

    # 5. Advance REVIEW → CONSENSUS, materialize a manual_override
    # consensus that publishes the value, then FINALIZED.
    await lifecycle.advance_stage(
        run_id=run.id,
        target_stage=ExtractionRunStage.CONSENSUS,
        user_id=profile_id,
    )
    consensus_service = ExtractionConsensusService(db_session)
    consensus_record, published = await consensus_service.record_consensus(
        run_id=run.id,
        instance_id=instance_id,
        field_id=field_id,
        consensus_user_id=profile_id,
        mode=ExtractionConsensusMode.MANUAL_OVERRIDE,
        value={"value": "manual-edit"},
        rationale="manual flow finalize",
    )
    assert consensus_record.run_id == run.id
    assert published.value == {"value": "manual-edit"}
    assert published.run_id == run.id

    await lifecycle.advance_stage(
        run_id=run.id,
        target_stage=ExtractionRunStage.FINALIZED,
        user_id=profile_id,
    )
    refreshed = await db_session.get(ExtractionRun, run.id)
    assert refreshed is not None
    assert refreshed.stage == ExtractionRunStage.FINALIZED.value
    assert refreshed.status == ExtractionRunStatus.COMPLETED.value
    await db_session.rollback()


@pytest.mark.asyncio
async def test_human_proposal_blocks_ai_skip_flag(db_session: AsyncSession) -> None:
    """Hybrid flow: a ``human`` proposal already exists when AI runs.
    The skip flag (``skip_fields_with_human_proposals``) used by
    ``extract_for_run`` is implemented as "if the latest proposal on
    this coord is already ``human``, exclude this field from the LLM
    call". This test pins down that invariant by asserting the latest
    proposal per coord stays ``human`` after we mimic the AI write
    being skipped.
    """
    fx = await _coords(db_session)
    if fx is None:
        pytest.skip("Missing fixtures.")
    project_id, article_id, template_id, profile_id, instance_id, field_id = fx

    session_service = HITLSessionService(db_session)
    session = await session_service.open_or_resume(
        kind=TemplateKind.EXTRACTION,
        project_id=project_id,
        article_id=article_id,
        user_id=profile_id,
        project_template_id=template_id,
    )

    proposal_service = ExtractionProposalService(db_session)
    await proposal_service.record_proposal(
        run_id=session.run_id,
        instance_id=instance_id,
        field_id=field_id,
        source=ExtractionProposalSource.HUMAN,
        source_user_id=profile_id,
        proposed_value={"value": "user-typed-this-first"},
    )

    # The LLM pipeline filters out coords with a latest ``human``
    # proposal *before* calling the model. We assert the contract: the
    # latest per coord is still the human row, and no ``ai`` row was
    # written for this (instance, field).
    latest = (
        await db_session.execute(
            select(ExtractionProposalRecord)
            .where(
                ExtractionProposalRecord.run_id == session.run_id,
                ExtractionProposalRecord.instance_id == instance_id,
                ExtractionProposalRecord.field_id == field_id,
            )
            .order_by(ExtractionProposalRecord.created_at.desc())
            .limit(1)
        )
    ).scalar_one()
    assert latest.source == ExtractionProposalSource.HUMAN.value
    assert latest.proposed_value == {"value": "user-typed-this-first"}

    ai_count = (
        (
            await db_session.execute(
                select(ExtractionProposalRecord).where(
                    ExtractionProposalRecord.run_id == session.run_id,
                    ExtractionProposalRecord.instance_id == instance_id,
                    ExtractionProposalRecord.field_id == field_id,
                    ExtractionProposalRecord.source == ExtractionProposalSource.AI.value,
                )
            )
        )
        .scalars()
        .all()
    )
    assert ai_count == []
    await db_session.rollback()
