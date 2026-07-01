"""Integration tests for the ADR-0016 ``absent_reason`` marker on the
finalize-gate / publish round-trip (Phase 1).

These pin the load-bearing Phase-1 invariants against the REAL schema (JSONB
verbatim persistence, the gate's ``is_value_filled`` delegation):

A. **Round-trip + gate satisfaction.** An AI ``no_information`` marker proposal,
   once a reviewer accepts it and consensus publishes it, persists *verbatim*
   into ``ExtractionPublishedState.value`` and counts as a *filled* coord — so a
   required field the source is silent on can finalize (closing the
   numeric/date "not reported" gap). The marker must NOT collapse to ``null`` in
   the published column (or two different disposition codes would hash equal in
   the consensus key).
B. **Bare-null still blocks.** A bare ``{"value": null}`` decision (no marker)
   stays unresolved — the gate must distinguish it from a resolved marker.
C. **An unaccepted marker proposal does not self-satisfy the gate.** A raw AI /
   system marker proposal with no reviewer decision is an orphan the gate never
   counts (the fabrication-safety property; also the reopen-carried-marker case,
   where a published marker re-seeds as a ``source='system'`` proposal that must
   be re-accepted before it re-finalizes).
"""

from __future__ import annotations

from uuid import UUID, uuid4

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.extraction import ExtractionRun, ExtractionRunStage, TemplateKind
from app.models.extraction_workflow import (
    ExtractionConsensusMode,
    ExtractionProposalSource,
    ExtractionReviewerDecisionType,
)
from app.services.extraction_consensus_service import ExtractionConsensusService
from app.services.extraction_proposal_service import ExtractionProposalService
from app.services.extraction_review_service import ExtractionReviewService
from app.services.hitl_session_service import HITLSessionService
from app.services.run_lifecycle_service import RunLifecycleService

_MARKER = {"value": None, "absent_reason": "no_information"}


async def _coords(
    db: AsyncSession,
) -> tuple[UUID, UUID, UUID, UUID, UUID, UUID] | None:
    """Resolve (project, article, extraction-template, manager, instance, field)
    for a seeded extraction template that has at least one instance + field.
    Mirrors ``test_extraction_manual_only_flow._coords``; tests skip when the
    dev DB is not seeded."""
    project_id = (
        await db.execute(
            text(
                "SELECT p.id FROM public.projects p WHERE EXISTS (SELECT 1 FROM "
                "public.project_extraction_templates t JOIN public.extraction_entity_types et "
                "ON et.project_template_id = t.id JOIN public.extraction_fields f "
                "ON f.entity_type_id = et.id JOIN public.extraction_instances i "
                "ON i.template_id = t.id WHERE t.project_id = p.id) ORDER BY p.id LIMIT 1"
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
                "SELECT pm.user_id FROM public.project_members pm WHERE pm.role = 'manager' "
                "AND pm.project_id = :pid LIMIT 1"
            ),
            {"pid": project_id},
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


async def _fresh_extract_run(db: AsyncSession, fx: tuple[UUID, ...]) -> ExtractionRun:
    """Clear leaked runs for the coord and open a fresh EXTRACT-stage run."""
    project_id, article_id, template_id, profile_id = fx[0], fx[1], fx[2], fx[3]
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
    assert run.stage == ExtractionRunStage.EXTRACT.value
    return run


@pytest.mark.asyncio
async def test_accepted_marker_round_trips_to_published_and_fills_gate(
    db_session: AsyncSession,
) -> None:
    fx = await _coords(db_session)
    if fx is None:
        pytest.skip("Missing fixtures.")
    _project, _article, _template, profile_id, instance_id, field_id = fx

    run = await _fresh_extract_run(db_session, fx)
    lifecycle = RunLifecycleService(db_session)

    # AI records a no_information marker proposal (the Phase-1 recording split).
    proposal = await ExtractionProposalService(db_session).record_proposal(
        run_id=run.id,
        instance_id=instance_id,
        field_id=field_id,
        source=ExtractionProposalSource.AI,
        proposed_value=_MARKER,
        rationale="not stated in the article",
    )
    assert proposal.proposed_value == _MARKER

    # A reviewer accepts it in one click (the decision carries no value of its
    # own — the meaning rides the proposal).
    decision = await ExtractionReviewService(db_session).record_decision(
        run_id=run.id,
        instance_id=instance_id,
        field_id=field_id,
        reviewer_id=profile_id,
        decision=ExtractionReviewerDecisionType.ACCEPT_PROPOSAL,
        proposal_record_id=proposal.id,
    )

    # Gate resolver sees the accepted marker as a resolved (filled) value,
    # inherited verbatim from the proposal — so the coord satisfies the gate.
    resolved = await lifecycle._resolved_reviewer_values(run.id)
    by_coord = {(i, f): v for i, f, v in resolved}
    assert by_coord.get((instance_id, field_id)) == _MARKER
    assert (instance_id, field_id) in await lifecycle._filled_coords(run.id)

    # Publish via consensus (select the accepting decision) and assert the
    # marker survives VERBATIM into ExtractionPublishedState.value.
    await lifecycle.advance_stage(
        run_id=run.id,
        target_stage=ExtractionRunStage.CONSENSUS,
        user_id=profile_id,
    )
    _consensus, published = await ExtractionConsensusService(db_session).record_consensus(
        run_id=run.id,
        instance_id=instance_id,
        field_id=field_id,
        consensus_user_id=profile_id,
        mode=ExtractionConsensusMode.SELECT_EXISTING,
        selected_decision_id=decision.id,
    )
    assert published.value == _MARKER
    # The published marker keeps the coord filled for the finalize gate.
    assert (instance_id, field_id) in await lifecycle._filled_coords(run.id)

    await db_session.rollback()


@pytest.mark.asyncio
async def test_bare_null_decision_stays_unfilled(db_session: AsyncSession) -> None:
    fx = await _coords(db_session)
    if fx is None:
        pytest.skip("Missing fixtures.")
    _project, _article, _template, profile_id, instance_id, field_id = fx

    run = await _fresh_extract_run(db_session, fx)
    lifecycle = RunLifecycleService(db_session)

    # A bare-null edit (no marker) is unresolved — it must NOT count as filled,
    # the exact contrast to the accepted marker above.
    await ExtractionReviewService(db_session).record_decision(
        run_id=run.id,
        instance_id=instance_id,
        field_id=field_id,
        reviewer_id=profile_id,
        decision=ExtractionReviewerDecisionType.EDIT,
        value={"value": None},
    )
    resolved = {(i, f) for i, f, _ in await lifecycle._resolved_reviewer_values(run.id)}
    assert (instance_id, field_id) not in resolved
    assert (instance_id, field_id) not in await lifecycle._filled_coords(run.id)

    await db_session.rollback()


@pytest.mark.asyncio
async def test_unaccepted_marker_proposal_does_not_fill_gate(
    db_session: AsyncSession,
) -> None:
    fx = await _coords(db_session)
    if fx is None:
        pytest.skip("Missing fixtures.")
    _project, _article, _template, _profile, instance_id, field_id = fx

    run = await _fresh_extract_run(db_session, fx)
    lifecycle = RunLifecycleService(db_session)

    # A raw AI marker proposal with NO reviewer decision is an orphan: the gate
    # counts only published values and current reviewer decisions, never a bare
    # proposal. This is the fabrication-safety property (a parser dropping a
    # section → many "not reported" markers cannot self-finalize a run) and the
    # reopen case (a carried marker re-seeds as a source='system' proposal that
    # must be re-accepted before it re-finalizes).
    await ExtractionProposalService(db_session).record_proposal(
        run_id=run.id,
        instance_id=instance_id,
        field_id=field_id,
        source=ExtractionProposalSource.AI,
        proposed_value=_MARKER,
    )
    assert (instance_id, field_id) not in await lifecycle._filled_coords(run.id)

    # And a foreign coord never leaks in either.
    assert (uuid4(), field_id) not in await lifecycle._filled_coords(run.id)

    await db_session.rollback()
