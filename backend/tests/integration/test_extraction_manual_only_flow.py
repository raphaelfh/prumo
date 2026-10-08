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

from uuid import UUID

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.extraction import (
    ExtractionField,
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
from app.services.ai_extraction import InvalidProposalError
from app.services.extraction_consensus_service import ExtractionConsensusService
from app.services.extraction_review_service import ExtractionReviewService
from app.services.hitl_session_service import HITLSessionService
from app.services.run_lifecycle_service import RunLifecycleService
from tests.fakes.recorded_llm import RecordedLlm
from tests.integration.conftest import SEED, land_ai_proposal
from tests.integration.helpers.ai_extraction import extraction, request, seed_article_text


async def _asked_on_rerun(
    db: AsyncSession, run: ExtractionRun, field_id: UUID, user_id: UUID
) -> bool:
    """Whether an AI re-run with the skip flag asks the model for ``field_id``
    — the full-run sweep a reviewer's "Run AI" fires."""
    field = await db.get(ExtractionField, field_id)
    assert field is not None
    fake = RecordedLlm()
    await extraction(db, fake, user_id=user_id).run_from_request(
        request(
            project_id=run.project_id,
            article_id=run.article_id,
            template_id=run.template_id,
            run_id=run.id,
            skip_fields_with_human_proposals=True,
        )
    )
    return any(field.name in call.field_names for call in fake.field_calls())


async def _coords(
    db: AsyncSession,
) -> tuple[UUID, UUID, UUID, UUID, UUID, UUID] | None:
    """Resolve (project_id, article_id, project_template_id, profile_id,
    instance_id, field_id) for an extraction-kind template that has at
    least one matching instance + field. Tests skip when the dev DB is
    not seeded."""
    project_id = (
        await db.execute(
            text("SELECT id FROM public.projects WHERE id = :pid"),
            {"pid": str(SEED.primary_project)},
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
                "SELECT user_id FROM public.project_members "
                "WHERE project_id = :pid AND role = 'manager' LIMIT 1"
            ),
            {"pid": str(project_id)},
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

    The hybrid re-run safety of the full-run sweep
    (``skip_fields_with_human_proposals``) must still protect a field the
    human has already settled. In the collapsed ``extract`` lifecycle the
    human's extraction value is a per-reviewer ``ReviewerDecision`` (the
    blind-review write gate rejects ``human`` proposals for
    ``kind='extraction'``), not a ``human`` proposal — so the skip set is
    computed off the decision track. This pins that invariant against the
    real schema: after a human ``edit`` decision lands,

    * a ``human`` proposal on the same coord is rejected (gate), so the
      proposal track can never hold the value, and
    * the decision track protects the field, so the AI re-run never asks it.
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
        await land_ai_proposal(
            db_session,
            run_id=run.id,
            instance_id=instance_id,
            field_id=field_id,
            source=ExtractionProposalSource.HUMAN,
            proposed_value={"value": "should-be-rejected"},
        )

    await seed_article_text(db_session, project_id=project_id, article_id=article_id)
    assert not await _asked_on_rerun(db_session, run, field_id, profile_id)

    await db_session.rollback()


@pytest.mark.asyncio
async def test_human_decision_skip_probe_scoping_and_types(
    db_session: AsyncSession,
) -> None:
    """Pin the real-SQL invariants of the decision track of the skip set that
    the single ``edit`` happy-path leaves unverified (adversarial-review
    hardening), observed through what the AI re-run asks the model:

    * ``reject`` is excluded, ``edit`` / ``accept_proposal`` are included — all
      asserted against the REAL join (the unit tests only feed mocked rows).
    * Reviewer-id-agnostic: ANY reviewer who settles the shared coord protects
      it. A manager ``reject`` does NOT veto a second reviewer's ``edit`` — so a
      future ``reviewer_id == …`` predicate on the probe would flip this red.
    * End-to-end: with the only field settled, the section is skipped and the
      model is never called.

    The run / instance / field predicates are pinned by
    ``test_ai_extraction_flows`` (run, field) and
    ``test_entry_group_extraction`` (instance).
    """
    fx = await _coords(db_session)
    if fx is None:
        pytest.skip("Missing fixtures.")
    project_id, article_id, template_id, manager_id, instance_id, field_id = fx

    reviewer_b = (
        await db_session.execute(
            text(
                "SELECT user_id FROM public.project_members "
                "WHERE project_id = :pid AND role = 'reviewer' AND user_id <> :mgr "
                "LIMIT 1"
            ),
            {"pid": str(project_id), "mgr": str(manager_id)},
        )
    ).scalar()
    if reviewer_b is None:
        pytest.skip("Needs a second (reviewer-role) project member.")
    reviewer_b = UUID(str(reviewer_b))

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
        user_id=manager_id,
        project_template_id=template_id,
    )
    run = await db_session.get(ExtractionRun, session.run_id)
    assert run is not None
    assert run.stage == ExtractionRunStage.EXTRACT.value

    review = ExtractionReviewService(db_session)
    await seed_article_text(db_session, project_id=project_id, article_id=article_id)

    async def settled() -> bool:
        return not await _asked_on_rerun(db_session, run, field_id, manager_id)

    # reject only (manager) → unresolved, excluded from the skip set.
    await review.record_decision(
        run_id=run.id,
        instance_id=instance_id,
        field_id=field_id,
        reviewer_id=manager_id,
        decision=ExtractionReviewerDecisionType.REJECT,
    )
    assert not await settled()

    # A SECOND reviewer's edit protects the shared coord even though the
    # manager's current decision is reject — the reviewer-id-agnostic "any
    # settles" semantic. A ``reviewer_id``-scoped probe would report empty
    # here, so this is the load-bearing cross-reviewer assertion.
    await review.record_decision(
        run_id=run.id,
        instance_id=instance_id,
        field_id=field_id,
        reviewer_id=reviewer_b,
        decision=ExtractionReviewerDecisionType.EDIT,
        value={"value": "second-reviewer-typed"},
    )
    assert await settled()

    # When that reviewer also steps back to reject, nothing is settled — both
    # reviewers now hold a (non-settling) reject. Pins reject-exclusion on the
    # real join for BOTH reviewers, not just the manager. (Each reviewer makes
    # only DISTINCT transitions — reject→… for the manager, edit→reject for the
    # second — so no duplicate same-type decision collides on the shared
    # transaction timestamp inside ``get_latest_for_coord``.)
    await review.record_decision(
        run_id=run.id,
        instance_id=instance_id,
        field_id=field_id,
        reviewer_id=reviewer_b,
        decision=ExtractionReviewerDecisionType.REJECT,
    )
    assert not await settled()

    # accept_proposal (manager) over an AI proposal settles the coord again,
    # isolated to the manager (the second reviewer's current decision is
    # reject) — so ``accept_proposal`` is exercised through the REAL join, and a
    # reviewer-scoped probe would wrongly report empty.
    proposal = await land_ai_proposal(
        db_session,
        run_id=run.id,
        instance_id=instance_id,
        field_id=field_id,
        source=ExtractionProposalSource.AI,
        proposed_value={"value": "ai-guess"},
    )
    await review.record_decision(
        run_id=run.id,
        instance_id=instance_id,
        field_id=field_id,
        reviewer_id=manager_id,
        decision=ExtractionReviewerDecisionType.ACCEPT_PROPOSAL,
        proposal_record_id=proposal.id,
    )
    assert await settled()

    # End-to-end: with the only field settled, the re-run skips the section
    # before the model is ever called.
    fake = RecordedLlm()
    result = await extraction(db_session, fake, user_id=manager_id).run_from_request(
        request(
            project_id=project_id,
            article_id=article_id,
            template_id=template_id,
            run_id=run.id,
            skip_fields_with_human_proposals=True,
        )
    )
    assert fake.calls == []
    assert [s["skipped"] for s in result.sections] == [True]
