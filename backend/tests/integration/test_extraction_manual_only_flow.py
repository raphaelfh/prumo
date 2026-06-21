"""Integration tests for the manual-only + hybrid extraction flows.

In the collapsed lifecycle (pending → extract → consensus → finalized) the
Data-Extraction surface writes human values straight to per-user
``ReviewerDecision`` rows: the blind-review write defense rejects ``human``
proposals on extraction runs, so the form autosaves through ``/decisions``.

Two scenarios are covered end-to-end at the service level:

1. **Manual-only**: open session (parks the run in EXTRACT) → record a human
   ``edit`` decision → advance EXTRACT → CONSENSUS → publish via
   manual_override → FINALIZED. No AI extraction in the loop.
2. **Hybrid re-run safety**: a human ``edit`` decision already exists when AI
   re-runs. The skip flag (``skip_fields_with_human_proposals``) must protect
   that field. Post-collapse the human value is a ``ReviewerDecision`` (not a
   ``human`` proposal), so the skip set is computed off the decision track —
   the porting of the deleted ``test_human_proposal_blocks_ai_skip_flag``.

The old ``proposal → review`` boundary materialization that used to convert
human proposals into decisions was removed with the stage collapse (humans
write decisions directly), so the tests that exercised it are gone.
"""

from __future__ import annotations

from unittest.mock import MagicMock
from uuid import UUID

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.extraction import (
    ExtractionRun,
    ExtractionRunStage,
    ExtractionRunStatus,
    TemplateKind,
)
from app.models.extraction_workflow import (
    ExtractionConsensusMode,
    ExtractionProposalSource,
    ExtractionReviewerDecisionType,
)
from app.services.extraction_consensus_service import ExtractionConsensusService
from app.services.extraction_proposal_service import (
    ExtractionProposalService,
    InvalidProposalError,
)
from app.services.extraction_review_service import ExtractionReviewService
from app.services.hitl_session_service import HITLSessionService
from app.services.run_lifecycle_service import RunLifecycleService
from app.services.section_extraction_service import SectionExtractionService


async def _coords(
    db: AsyncSession,
) -> tuple[UUID, UUID, UUID, UUID, UUID, UUID] | None:
    """Resolve (project_id, article_id, project_template_id, profile_id,
    instance_id, field_id) for an extraction-kind template that has at
    least one matching instance + field. Tests skip when the dev DB is
    not seeded."""
    project_id = (
        await db.execute(
            text(
                "SELECT p.id FROM public.projects p WHERE EXISTS (SELECT 1 FROM public.project_extraction_templates t JOIN public.extraction_entity_types et ON et.project_template_id = t.id JOIN public.extraction_fields f ON f.entity_type_id = et.id JOIN public.extraction_instances i ON i.template_id = t.id WHERE t.project_id = p.id) ORDER BY p.id LIMIT 1"
            )
        )
    ).scalar()
    article_id = (
        await db.execute(
            text("SELECT id FROM public.articles WHERE project_id = :pid LIMIT 1"),
            {"pid": project_id},
        )
    ).scalar()
    template_id = (
        await db.execute(
            text(
                "SELECT id FROM public.project_extraction_templates "
                "WHERE kind = 'extraction' AND project_id = :pid LIMIT 1"
            ),
            {"pid": project_id},
        )
    ).scalar()
    profile_id = (
        await db.execute(
            text(
                "SELECT pm.user_id FROM public.project_members pm WHERE pm.role = 'manager' AND EXISTS (SELECT 1 FROM public.project_extraction_templates t JOIN public.extraction_entity_types et ON et.project_template_id = t.id JOIN public.extraction_fields f ON f.entity_type_id = et.id JOIN public.extraction_instances i ON i.template_id = t.id WHERE t.project_id = pm.project_id) ORDER BY pm.user_id LIMIT 1"
            )
        )
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
    """End-to-end: open extraction session → human ``edit`` decision →
    consensus → finalize. Asserts:

    * Session opens the run in EXTRACT (not PENDING).
    * A human value lands as a per-user ReviewerDecision in EXTRACT.
    * Consensus + finalize advance the lifecycle terminally.
    """
    fx = await _coords(db_session)
    if fx is None:
        pytest.skip("Missing fixtures.")
    project_id, article_id, template_id, profile_id, instance_id, field_id = fx

    # Clear ALL pre-existing runs for this coord so the session creates
    # a fresh EXTRACT run — the surrounding integration suite leaks
    # runs in CONSENSUS/FINALIZED via committed HTTP calls. The
    # transaction-scoped rollback at the end of this test will undo
    # the cleanup along with the rest of our writes.
    await db_session.execute(
        text(
            "DELETE FROM public.extraction_runs WHERE project_id = :pid "
            "AND article_id = :aid AND template_id = :tid"
        ),
        {"pid": str(project_id), "aid": str(article_id), "tid": str(template_id)},
    )

    # 1. Open session — backend creates / resumes a Run and parks it in EXTRACT.
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
    assert run.stage == ExtractionRunStage.EXTRACT.value

    # 2. Autosave write: a human value lands as a per-user ReviewerDecision
    #    (edit) in EXTRACT — humans write decisions directly now, not the
    #    shared ``human`` proposal track (rejected for extraction kinds).
    review_service = ExtractionReviewService(db_session)
    decision = await review_service.record_decision(
        run_id=run.id,
        instance_id=instance_id,
        field_id=field_id,
        reviewer_id=profile_id,
        decision=ExtractionReviewerDecisionType.EDIT,
        value={"value": "manual-edit"},
    )
    assert decision.run_id == run.id
    assert decision.decision == ExtractionReviewerDecisionType.EDIT.value

    # 3. Advance EXTRACT → CONSENSUS, materialize a manual_override
    # consensus that publishes the value, then FINALIZED.
    lifecycle = RunLifecycleService(db_session)
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
async def test_human_decision_blocks_ai_skip_flag(db_session: AsyncSession) -> None:
    """Post-collapse port of the deleted ``test_human_proposal_blocks_ai_skip_flag``.

    The hybrid re-run safety used by ``extract_for_run``
    (``skip_fields_with_human_proposals``) must still protect a field the
    human has already settled. In the collapsed ``extract`` lifecycle the
    human's extraction value is a per-reviewer ``ReviewerDecision`` (the
    blind-review write gate rejects ``human`` proposals for
    ``kind='extraction'``), not a ``human`` proposal — so the skip set is
    computed off the decision track. This pins that invariant against the
    real schema: after a human ``edit`` decision lands,

    * a ``human`` proposal on the same coord is rejected (gate), so the
      proposal probe can never see the value, and
    * the decision probe DOES include the field, so AI re-runs skip it.
    """
    fx = await _coords(db_session)
    if fx is None:
        pytest.skip("Missing fixtures.")
    project_id, article_id, template_id, profile_id, instance_id, field_id = fx

    await db_session.execute(
        text(
            "DELETE FROM public.extraction_runs WHERE project_id = :pid "
            "AND article_id = :aid AND template_id = :tid"
        ),
        {"pid": str(project_id), "aid": str(article_id), "tid": str(template_id)},
    )

    session = await HITLSessionService(db_session).open_or_resume(
        kind=TemplateKind.EXTRACTION,
        project_id=project_id,
        article_id=article_id,
        user_id=profile_id,
        project_template_id=template_id,
    )
    run = await db_session.get(ExtractionRun, session.run_id)
    assert run is not None
    assert run.stage == ExtractionRunStage.EXTRACT.value

    # The human value lands as a per-reviewer ``edit`` decision — the
    # extraction autosave path post-collapse.
    await ExtractionReviewService(db_session).record_decision(
        run_id=run.id,
        instance_id=instance_id,
        field_id=field_id,
        reviewer_id=profile_id,
        decision=ExtractionReviewerDecisionType.EDIT,
        value={"value": "user-typed-this-first"},
    )

    # The shared ``human`` proposal track is closed for extraction runs:
    # a frontend bypass (curl / agent client) cannot resurrect it. This is
    # why the skip set must read the decision track, not the proposal track.
    with pytest.raises(InvalidProposalError):
        await ExtractionProposalService(db_session).record_proposal(
            run_id=run.id,
            instance_id=instance_id,
            field_id=field_id,
            source=ExtractionProposalSource.HUMAN,
            source_user_id=profile_id,
            proposed_value={"value": "should-be-rejected"},
        )

    service = SectionExtractionService(
        db=db_session,
        user_id=str(profile_id),
        storage=MagicMock(),
        trace_id="test-trace",
    )

    via_proposal = await service._fields_with_recent_human_proposal(
        run_id=run.id,
        instance_id=instance_id,
        field_ids=[field_id],
    )
    via_decision = await service._fields_with_human_decision(
        run_id=run.id,
        instance_id=instance_id,
        field_ids=[field_id],
    )

    # No human proposal exists for extraction → proposal probe is blind to it.
    assert field_id not in via_proposal
    # The decision probe protects the field → the AI re-run excludes it.
    assert field_id in via_decision

    await db_session.rollback()
