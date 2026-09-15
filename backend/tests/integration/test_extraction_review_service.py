"""Integration tests for ExtractionReviewService."""

from uuid import UUID

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.extraction import ExtractionRunStage
from app.models.extraction_workflow import (
    ExtractionProposalSource,
    ExtractionReviewerDecision,
    ExtractionReviewerDecisionType,
    ExtractionReviewerState,
)
from app.repositories.extraction_reviewer_state_repository import (
    ExtractionReviewerStateRepository,
)
from app.services.extraction_proposal_service import ExtractionProposalService
from app.services.extraction_review_service import (
    ExtractionReviewService,
    InvalidDecisionError,
)
from app.services.run_lifecycle_service import RunLifecycleService
from tests.integration.conftest import SEED


async def _reviewer_state(
    db: AsyncSession,
    *,
    run_id: UUID,
    reviewer_id: UUID,
    instance_id: UUID,
    field_id: UUID,
) -> ExtractionReviewerState | None:
    """Read the materialized reviewer state for one (run, reviewer, item)."""
    return await ExtractionReviewerStateRepository(db).get(
        run_id=run_id,
        reviewer_id=reviewer_id,
        instance_id=instance_id,
        field_id=field_id,
    )


async def _setup_review_run(
    db: AsyncSession,
) -> tuple[UUID, UUID, UUID, UUID, UUID, UUID] | None:
    """Build run, advance to extract, return (run_id, instance_id, field_id, profile_id, proposal_id, alt_profile_id)."""
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
                "SELECT id FROM public.project_extraction_templates WHERE project_id = :pid LIMIT 1"
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
    # Pick instance and field that match the same template and entity_type.
    row = await db.execute(
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
    pair = row.first()
    if pair is None:
        return None
    instance_id, field_id = pair

    lifecycle = RunLifecycleService(db)
    run = await lifecycle.create_run(
        project_id=project_id,
        article_id=article_id,
        project_template_id=template_id,
        user_id=profile_id,
    )
    await lifecycle.advance_stage(
        run_id=run.id,
        target_stage=ExtractionRunStage.EXTRACT,
        user_id=profile_id,
    )
    proposal = await ExtractionProposalService(db).record_proposal(
        run_id=run.id,
        instance_id=instance_id,
        field_id=field_id,
        source=ExtractionProposalSource.AI,
        proposed_value={"text": "candidate"},
    )
    return run.id, instance_id, field_id, profile_id, proposal.id, profile_id


@pytest.mark.asyncio
async def test_record_accept_proposal_decision(db_session: AsyncSession) -> None:
    fx = await _setup_review_run(db_session)
    if fx is None:
        pytest.skip("Missing fixtures.")
    run_id, instance_id, field_id, profile_id, proposal_id, _ = fx

    service = ExtractionReviewService(db_session)
    decision = await service.record_decision(
        run_id=run_id,
        instance_id=instance_id,
        field_id=field_id,
        reviewer_id=profile_id,
        decision=ExtractionReviewerDecisionType.ACCEPT_PROPOSAL,
        proposal_record_id=proposal_id,
    )
    assert decision.decision == "accept_proposal"
    assert decision.proposal_record_id == proposal_id

    # ReviewerState was upserted
    state = await _reviewer_state(
        db_session,
        run_id=run_id,
        reviewer_id=profile_id,
        instance_id=instance_id,
        field_id=field_id,
    )
    assert state is not None
    assert state.current_decision_id == decision.id
    await db_session.rollback()


@pytest.mark.asyncio
async def test_accept_proposal_requires_proposal_record_id(
    db_session: AsyncSession,
) -> None:
    fx = await _setup_review_run(db_session)
    if fx is None:
        pytest.skip("Missing fixtures.")
    run_id, instance_id, field_id, profile_id, _, _ = fx

    service = ExtractionReviewService(db_session)
    with pytest.raises(InvalidDecisionError):
        await service.record_decision(
            run_id=run_id,
            instance_id=instance_id,
            field_id=field_id,
            reviewer_id=profile_id,
            decision=ExtractionReviewerDecisionType.ACCEPT_PROPOSAL,
            proposal_record_id=None,
        )
    await db_session.rollback()


@pytest.mark.asyncio
async def test_edit_decision_requires_value(db_session: AsyncSession) -> None:
    fx = await _setup_review_run(db_session)
    if fx is None:
        pytest.skip("Missing fixtures.")
    run_id, instance_id, field_id, profile_id, _, _ = fx

    service = ExtractionReviewService(db_session)
    with pytest.raises(InvalidDecisionError):
        await service.record_decision(
            run_id=run_id,
            instance_id=instance_id,
            field_id=field_id,
            reviewer_id=profile_id,
            decision=ExtractionReviewerDecisionType.EDIT,
            value=None,
        )
    await db_session.rollback()


@pytest.mark.asyncio
async def test_record_decision_rejects_incoherent_coordinates(
    db_session: AsyncSession,
) -> None:
    fx = await _setup_review_run(db_session)
    if fx is None:
        pytest.skip("Missing fixtures.")
    run_id, instance_id, _, profile_id, _, _ = fx
    # Pick a field from a different entity_type
    other_field_row = await db_session.execute(
        text(
            """
            SELECT f.id FROM public.extraction_fields f
            WHERE f.entity_type_id <> (
                SELECT entity_type_id FROM public.extraction_instances WHERE id = :iid
            )
            LIMIT 1
            """
        ),
        {"iid": instance_id},
    )
    other_field_id = other_field_row.scalar()
    if other_field_id is None:
        pytest.skip("Need >=2 entity_types with fields.")

    from app.services.coordinate_coherence import CoordinateMismatchError

    service = ExtractionReviewService(db_session)
    with pytest.raises(CoordinateMismatchError):
        await service.record_decision(
            run_id=run_id,
            instance_id=instance_id,
            field_id=other_field_id,
            reviewer_id=profile_id,
            decision=ExtractionReviewerDecisionType.EDIT,
            value={"v": "x"},
        )
    await db_session.rollback()


@pytest.mark.asyncio
async def test_accept_proposal_rejects_cross_coordinate_proposal(
    db_session: AsyncSession,
) -> None:
    """Issue #46: accept_proposal must reject proposals from a different (run, instance, field)."""
    fx = await _setup_review_run(db_session)
    if fx is None:
        pytest.skip("Missing fixtures.")
    run_id, instance_id, field_id, profile_id, _, _ = fx

    # Self-provision a SECOND coordinate in the same template. The seed
    # ships exactly one entity_type + one field (one coordinate), so add a
    # distinct field on the SAME entity_type as the existing instance: the
    # existing instance paired with this new field is a second valid
    # (instance, field) coordinate in the same template. Rolled back with
    # db_session, so there is no leak.
    other_field_id = (
        await db_session.execute(
            text(
                "INSERT INTO public.extraction_fields "
                "(id, entity_type_id, name, label, field_type, is_required) "
                "SELECT gen_random_uuid(), et.id, 'second_coordinate_field', "
                " 'Second Coordinate Field', 'text', false "
                "FROM public.extraction_entity_types et "
                "WHERE et.id = (SELECT entity_type_id FROM public.extraction_instances "
                "               WHERE id = :iid) "
                "RETURNING id"
            ),
            {"iid": instance_id},
        )
    ).scalar_one()
    await db_session.flush()

    # Build a second proposal targeting a DIFFERENT (instance, field) in the same run.
    other_row = await db_session.execute(
        text(
            """
            SELECT i.id, f.id
            FROM public.extraction_instances i
            JOIN public.extraction_entity_types et ON et.id = i.entity_type_id
            JOIN public.extraction_fields f ON f.entity_type_id = et.id
            WHERE (i.id <> :iid OR f.id <> :fid)
              AND f.id = :other_fid
              AND i.template_id = (
                  SELECT template_id FROM public.extraction_instances WHERE id = :iid
              )
            LIMIT 1
            """
        ),
        {"iid": instance_id, "fid": field_id, "other_fid": other_field_id},
    )
    other = other_row.first()
    assert other is not None, "self-provisioned second coordinate must be discoverable"
    other_instance_id, other_field_id = other

    # Insert the cross-coord proposal directly via the model — the value and
    # coordinate are what we're testing here, not the proposal write path.
    from app.models.extraction_workflow import ExtractionProposalRecord

    cross_proposal = ExtractionProposalRecord(
        run_id=run_id,
        instance_id=other_instance_id,
        field_id=other_field_id,
        source=ExtractionProposalSource.AI.value,
        proposed_value={"v": "from other field"},
    )
    db_session.add(cross_proposal)
    await db_session.flush()

    service = ExtractionReviewService(db_session)
    with pytest.raises(InvalidDecisionError, match="does not belong"):
        await service.record_decision(
            run_id=run_id,
            instance_id=instance_id,
            field_id=field_id,
            reviewer_id=profile_id,
            decision=ExtractionReviewerDecisionType.ACCEPT_PROPOSAL,
            proposal_record_id=cross_proposal.id,
        )
    await db_session.rollback()


@pytest.mark.asyncio
async def test_accept_proposal_rejects_unknown_proposal_id(
    db_session: AsyncSession,
) -> None:
    """Issue #46: accept_proposal must reject an unknown proposal_record_id."""
    import uuid as _uuid

    fx = await _setup_review_run(db_session)
    if fx is None:
        pytest.skip("Missing fixtures.")
    run_id, instance_id, field_id, profile_id, _, _ = fx

    service = ExtractionReviewService(db_session)
    with pytest.raises(InvalidDecisionError, match="does not belong"):
        await service.record_decision(
            run_id=run_id,
            instance_id=instance_id,
            field_id=field_id,
            reviewer_id=profile_id,
            decision=ExtractionReviewerDecisionType.ACCEPT_PROPOSAL,
            proposal_record_id=_uuid.uuid4(),
        )
    await db_session.rollback()


@pytest.mark.asyncio
async def test_second_decision_replaces_reviewer_state(
    db_session: AsyncSession,
) -> None:
    fx = await _setup_review_run(db_session)
    if fx is None:
        pytest.skip("Missing fixtures.")
    run_id, instance_id, field_id, profile_id, proposal_id, _ = fx

    service = ExtractionReviewService(db_session)
    first = await service.record_decision(
        run_id=run_id,
        instance_id=instance_id,
        field_id=field_id,
        reviewer_id=profile_id,
        decision=ExtractionReviewerDecisionType.ACCEPT_PROPOSAL,
        proposal_record_id=proposal_id,
    )
    second = await service.record_decision(
        run_id=run_id,
        instance_id=instance_id,
        field_id=field_id,
        reviewer_id=profile_id,
        decision=ExtractionReviewerDecisionType.EDIT,
        value={"text": "edited"},
        rationale="changed my mind",
    )
    state = await _reviewer_state(
        db_session,
        run_id=run_id,
        reviewer_id=profile_id,
        instance_id=instance_id,
        field_id=field_id,
    )
    assert state is not None
    assert state.current_decision_id == second.id
    assert state.current_decision_id != first.id
    await db_session.rollback()


@pytest.mark.asyncio
async def test_reversal_appends_without_rewriting_earlier_decisions(_engine) -> None:
    """Accept, edit, then restore: three audit rows, and no earlier row changes.

    Each decision commits on its own, as each HTTP request does. Inside one
    transaction ``now()`` ties every ``created_at``, so the latest decision
    would fall to the random id tiebreak.
    """
    from sqlalchemy.ext.asyncio import async_sessionmaker

    sessions = async_sessionmaker(_engine, expire_on_commit=False)
    run_id = None

    async def stored() -> dict[UUID, tuple[object, ...]]:
        async with sessions() as read:
            rows = await read.execute(
                text(
                    "SELECT id, decision, proposal_record_id, value, rationale, created_at "
                    "FROM public.extraction_reviewer_decisions WHERE run_id = :run"
                ),
                {"run": run_id},
            )
            return {row[0]: tuple(row[1:]) for row in rows}

    try:
        async with sessions() as setup:
            fx = await _setup_review_run(setup)
            assert fx is not None, (
                "Required integration seed is missing; run backend integration seed"
            )
            await setup.commit()
        run_id, instance_id, field_id, profile_id, proposal_id, _ = fx
        coordinate = {
            "run_id": run_id,
            "instance_id": instance_id,
            "field_id": field_id,
            "reviewer_id": profile_id,
        }

        async def decide(**kwargs: object) -> ExtractionReviewerDecision:
            async with sessions() as request:
                decision = await ExtractionReviewService(request).record_decision(
                    **coordinate, **kwargs
                )
                await request.commit()
                return decision

        accepted = await decide(
            decision=ExtractionReviewerDecisionType.ACCEPT_PROPOSAL,
            proposal_record_id=proposal_id,
        )
        after_accept = await stored()
        edited = await decide(
            decision=ExtractionReviewerDecisionType.EDIT,
            value={"text": "edited"},
            rationale="changed my mind",
            expected_current_decision_id=accepted.id,
        )
        after_edit = await stored()
        restored = await decide(
            decision=ExtractionReviewerDecisionType.ACCEPT_PROPOSAL,
            proposal_record_id=proposal_id,
            expected_current_decision_id=edited.id,
        )
        history = await stored()

        # Precondition: the committed read sees each append.
        assert list(after_accept) == [accepted.id]
        assert set(after_edit) == {accepted.id, edited.id}
        assert set(history) == {accepted.id, edited.id, restored.id}
        assert history[accepted.id] == after_accept[accepted.id]
        assert history[edited.id] == after_edit[edited.id]
        assert history[restored.id][:2] == ("accept_proposal", proposal_id)
        async with sessions() as verify:
            state = await _reviewer_state(
                verify,
                run_id=run_id,
                reviewer_id=profile_id,
                instance_id=instance_id,
                field_id=field_id,
            )
        assert state is not None
        assert state.current_decision_id == restored.id
    finally:
        if run_id is not None:
            async with sessions() as cleanup:
                await cleanup.execute(
                    text("DELETE FROM public.extraction_runs WHERE id = :rid"), {"rid": run_id}
                )
                await cleanup.commit()


@pytest.mark.asyncio
async def test_reviewer_state_is_none_for_unknown_coordinates(
    db_session: AsyncSession,
) -> None:
    """A coordinates tuple (run, reviewer, instance, field) with no recorded
    decision must return None — not a partial ReviewerState, not a default."""
    fx = await _setup_review_run(db_session)
    if fx is None:
        pytest.skip("Missing fixtures.")
    run_id, instance_id, field_id, profile_id, _proposal_id, _ = fx

    # Use a UUID that is not bound to any reviewer in the system.
    unknown_reviewer = UUID("00000000-0000-0000-0000-000000000000")
    state = await _reviewer_state(
        db_session,
        run_id=run_id,
        reviewer_id=unknown_reviewer,
        instance_id=instance_id,
        field_id=field_id,
    )
    assert state is None, "expected None for coordinates without a recorded decision"

    # The real reviewer also has no state YET (no record_decision called).
    state2 = await _reviewer_state(
        db_session,
        run_id=run_id,
        reviewer_id=profile_id,
        instance_id=instance_id,
        field_id=field_id,
    )
    assert state2 is None, "expected None before any record_decision call"
    await db_session.rollback()


@pytest.mark.asyncio
async def test_reviewer_state_points_at_the_decision_after_record_decision(
    db_session: AsyncSession,
) -> None:
    """Explicit positive retrieval (companion to the None-case test).

    The other tests only observe the state as a side effect of record_decision;
    this one reads it back explicitly and asserts the round-trip matches the
    recorded decision id.
    """
    fx = await _setup_review_run(db_session)
    if fx is None:
        pytest.skip("Missing fixtures.")
    run_id, instance_id, field_id, profile_id, proposal_id, _ = fx
    service = ExtractionReviewService(db_session)
    decision = await service.record_decision(
        run_id=run_id,
        instance_id=instance_id,
        field_id=field_id,
        reviewer_id=profile_id,
        decision=ExtractionReviewerDecisionType.ACCEPT_PROPOSAL,
        proposal_record_id=proposal_id,
    )
    state = await _reviewer_state(
        db_session,
        run_id=run_id,
        reviewer_id=profile_id,
        instance_id=instance_id,
        field_id=field_id,
    )
    assert state is not None
    assert state.current_decision_id == decision.id
    assert state.run_id == run_id
    assert state.reviewer_id == profile_id
    assert state.instance_id == instance_id
    assert state.field_id == field_id
    await db_session.rollback()


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "condition",
    ["matching", "missing", "stale", "identical_stale", "omitted", "null", "foreign_reviewer"],
)
async def test_decision_current_head_condition(db_session: AsyncSession, condition: str) -> None:
    from uuid import uuid4

    from app.core.error_handler import AppError

    fx = await _setup_review_run(db_session)
    assert fx is not None, (
        "Required integration seed must include project, article, template and coordinate"
    )
    run_id, instance_id, field_id, reviewer_id, _, _ = fx
    service = ExtractionReviewService(db_session)
    params = {
        "run_id": run_id,
        "instance_id": instance_id,
        "field_id": field_id,
        "reviewer_id": reviewer_id,
        "decision": "edit",
    }
    first = None
    if condition != "missing":
        first = await service.record_decision(**params, value={"value": "first"})
    if condition == "foreign_reviewer":
        await service.record_decision(
            **{**params, "reviewer_id": SEED.reviewer_profile}, value={"value": "foreign"}
        )
    expected = first.id if condition in ("matching", "foreign_reviewer") else uuid4()
    kwargs = (
        {}
        if condition == "omitted"
        else {"expected_current_decision_id": None if condition == "null" else expected}
    )
    value = {"value": "first" if condition == "identical_stale" else "second"}
    if condition in ("missing", "stale", "identical_stale"):
        with pytest.raises(AppError) as exc:
            await service.record_decision(**params, value=value, **kwargs)
        assert (exc.value.status_code, exc.value.code) == (409, "DECISION_CONFLICT")
        state = await _reviewer_state(
            db_session,
            run_id=run_id,
            reviewer_id=reviewer_id,
            instance_id=instance_id,
            field_id=field_id,
        )
        assert (state.current_decision_id if state else None) == (first.id if first else None)
    else:
        result = await service.record_decision(**params, value=value, **kwargs)
        assert result.value == value
        assert result.id != first.id


@pytest.mark.asyncio
@pytest.mark.parametrize("overlap", [False, True])
async def test_conditional_undo_checks_committed_head_after_run_lock(
    _engine, overlap: bool
) -> None:
    import asyncio

    from sqlalchemy.ext.asyncio import async_sessionmaker

    from app.core.error_handler import AppError

    sessions = async_sessionmaker(_engine, expire_on_commit=False)
    run_id = None
    try:
        async with sessions() as setup:
            fx = await _setup_review_run(setup)
            assert fx is not None, (
                "Required integration seed is missing; run backend integration seed"
            )
            run_id, instance_id, field_id, reviewer_id, _, _ = fx
            params = {
                "run_id": run_id,
                "instance_id": instance_id,
                "field_id": field_id,
                "reviewer_id": reviewer_id,
                "decision": "edit",
            }
            d1 = await ExtractionReviewService(setup).record_decision(
                **params, value={"value": "d1"}
            )
            await setup.commit()
        async with sessions() as client_a, sessions() as client_b, sessions() as monitor:
            observed = await ExtractionReviewService(client_a)._decisions.get_latest_for_coord(
                run_id, reviewer_id, instance_id, field_id
            )
            assert observed.id == d1.id
            await client_a.commit()
            d2 = await ExtractionReviewService(client_b).record_decision(
                **params, value={"value": "d2"}
            )
            if not overlap:
                await client_b.commit()
            pid_a = (await client_a.execute(text("SELECT pg_backend_pid()"))).scalar_one()
            attempt = asyncio.create_task(
                ExtractionReviewService(client_a).record_decision(
                    **params,
                    value={"value": "d2"},
                    expected_current_decision_id=d1.id,
                )
            )
            try:
                if overlap:
                    # Observe a real PostgreSQL lock wait before releasing B;
                    # query awaits provide scheduling, with no timing sleeps.
                    async with asyncio.timeout(5):
                        while True:
                            blocked = (
                                await monitor.execute(
                                    text("SELECT cardinality(pg_blocking_pids(:pid)) > 0"),
                                    {"pid": pid_a},
                                )
                            ).scalar_one()
                            if blocked:
                                break
                            if attempt.done():
                                await attempt
                                pytest.fail(
                                    "Conditional undo completed before acquiring B's run lock"
                                )
                    await client_b.commit()
                with pytest.raises(AppError) as exc:
                    await attempt
                assert (exc.value.status_code, exc.value.code) == (409, "DECISION_CONFLICT")
            finally:
                if not attempt.done():
                    attempt.cancel()
                    await asyncio.gather(attempt, return_exceptions=True)
                await client_a.rollback()
                await client_b.rollback()
        async with sessions() as verify:
            rows = (
                await verify.execute(
                    text(
                        "SELECT id, value FROM public.extraction_reviewer_decisions WHERE run_id = :rid"
                    ),
                    {"rid": run_id},
                )
            ).all()
            assert len(rows) == 2
            assert dict(rows)[d2.id] == {"value": "d2"}
            state = await _reviewer_state(
                verify,
                run_id=run_id,
                reviewer_id=reviewer_id,
                instance_id=instance_id,
                field_id=field_id,
            )
            assert state.current_decision_id == d2.id
    finally:
        if run_id is not None:
            async with sessions() as cleanup:
                await cleanup.execute(
                    text("DELETE FROM public.extraction_runs WHERE id = :rid"), {"rid": run_id}
                )
                await cleanup.commit()
