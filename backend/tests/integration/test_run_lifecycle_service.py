"""Integration tests for RunLifecycleService."""

import json
from uuid import UUID, uuid4

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.extraction import ExtractionRunStage
from app.services.run_lifecycle_service import (
    EmptyFinalizeError,
    InvalidStageTransitionError,
    RunLifecycleService,
)
from tests.integration.conftest import SEED


async def _fixtures(db: AsyncSession) -> tuple[UUID, UUID, UUID, UUID] | None:
    """Return the seeded coherent (project, article, template, profile) tuple.

    Uses the sentinel rows seeded by ``seeded_integration_db`` instead of
    independent ``LIMIT 1`` picks. Independent picks happily returned
    project=A / article=A / template=B on a dev DB with mixed-origin rows,
    making ``RunLifecycleService.create_run`` raise ``TemplateNotFoundError``
    because the template's ``project_id`` did not match the request. The
    sentinel rows always form a coherent graph rooted at
    ``primary_profile → primary_project → primary_article + primary_template``.

    Returns ``None`` only if the seed has not run (e.g., a session that
    skipped the autouse fixture); tests fall back to ``pytest.skip(...)``.
    """
    if (
        await db.execute(
            text("SELECT 1 FROM public.profiles WHERE id = :id"),
            {"id": str(SEED.primary_profile)},
        )
    ).scalar() is None:
        return None
    return (
        SEED.primary_project,
        SEED.primary_article,
        SEED.primary_template,
        SEED.primary_profile,
    )


@pytest.mark.asyncio
async def test_create_run_snapshots_hitl_config_and_active_version(
    db_session: AsyncSession,
) -> None:
    fx = await _fixtures(db_session)
    if fx is None:
        pytest.skip("Missing fixtures.")
    project_id, article_id, template_id, profile_id = fx

    service = RunLifecycleService(db_session)
    run = await service.create_run(
        project_id=project_id,
        article_id=article_id,
        project_template_id=template_id,
        user_id=profile_id,
    )
    assert run.stage == ExtractionRunStage.PENDING.value
    assert run.kind == "extraction"
    assert run.version_id is not None
    assert run.hitl_config_snapshot is not None
    assert "reviewer_count" in run.hitl_config_snapshot
    await db_session.rollback()


@pytest.mark.asyncio
async def test_advance_pending_to_extract_succeeds(
    db_session: AsyncSession,
) -> None:
    fx = await _fixtures(db_session)
    if fx is None:
        pytest.skip("Missing fixtures.")
    project_id, article_id, template_id, profile_id = fx

    service = RunLifecycleService(db_session)
    run = await service.create_run(
        project_id=project_id,
        article_id=article_id,
        project_template_id=template_id,
        user_id=profile_id,
    )
    advanced = await service.advance_stage(
        run_id=run.id,
        target_stage=ExtractionRunStage.EXTRACT,
        user_id=profile_id,
    )
    assert advanced.stage == ExtractionRunStage.EXTRACT.value
    await db_session.rollback()


@pytest.mark.asyncio
async def test_advance_pending_to_consensus_fails(db_session: AsyncSession) -> None:
    fx = await _fixtures(db_session)
    if fx is None:
        pytest.skip("Missing fixtures.")
    project_id, article_id, template_id, profile_id = fx

    service = RunLifecycleService(db_session)
    run = await service.create_run(
        project_id=project_id,
        article_id=article_id,
        project_template_id=template_id,
        user_id=profile_id,
    )
    with pytest.raises(InvalidStageTransitionError):
        await service.advance_stage(
            run_id=run.id,
            target_stage=ExtractionRunStage.CONSENSUS,
            user_id=profile_id,
        )
    await db_session.rollback()


@pytest.mark.asyncio
async def test_cancel_from_any_stage(db_session: AsyncSession) -> None:
    fx = await _fixtures(db_session)
    if fx is None:
        pytest.skip("Missing fixtures.")
    project_id, article_id, template_id, profile_id = fx

    service = RunLifecycleService(db_session)
    run = await service.create_run(
        project_id=project_id,
        article_id=article_id,
        project_template_id=template_id,
        user_id=profile_id,
    )
    cancelled = await service.advance_stage(
        run_id=run.id,
        target_stage=ExtractionRunStage.CANCELLED,
        user_id=profile_id,
    )
    assert cancelled.stage == ExtractionRunStage.CANCELLED.value
    await db_session.rollback()


@pytest.mark.asyncio
async def test_cannot_advance_from_cancelled(db_session: AsyncSession) -> None:
    fx = await _fixtures(db_session)
    if fx is None:
        pytest.skip("Missing fixtures.")
    project_id, article_id, template_id, profile_id = fx

    service = RunLifecycleService(db_session)
    run = await service.create_run(
        project_id=project_id,
        article_id=article_id,
        project_template_id=template_id,
        user_id=profile_id,
    )
    await service.advance_stage(
        run_id=run.id,
        target_stage=ExtractionRunStage.CANCELLED,
        user_id=profile_id,
    )
    with pytest.raises(InvalidStageTransitionError):
        await service.advance_stage(
            run_id=run.id,
            target_stage=ExtractionRunStage.EXTRACT,
            user_id=profile_id,
        )
    await db_session.rollback()


@pytest.mark.asyncio
async def test_create_run_derives_kind_from_template(db_session: AsyncSession) -> None:
    """Run.kind should equal the template's kind, not be hardcoded."""
    from sqlalchemy import text as _text

    fx = await _fixtures(db_session)
    if fx is None:
        pytest.skip("Missing fixtures.")
    project_id, article_id, template_id, profile_id = fx

    template_kind = (
        await db_session.execute(
            _text("SELECT kind FROM public.project_extraction_templates WHERE id = :id"),
            {"id": template_id},
        )
    ).scalar()
    assert template_kind is not None

    service = RunLifecycleService(db_session)
    run = await service.create_run(
        project_id=project_id,
        article_id=article_id,
        project_template_id=template_id,
        user_id=profile_id,
    )
    assert run.kind == template_kind
    await db_session.rollback()


@pytest.mark.asyncio
async def test_cannot_finalize_run_without_consensus(
    db_session: AsyncSession,
) -> None:
    """Regression: a Run can reach FINALIZED with 0 consensus decisions,
    leaving an empty 'Published' run that the UI flags as complete while
    no PublishedState rows exist.

    The lifecycle service must block advance(target=FINALIZED) when no
    ConsensusDecision was recorded — otherwise downstream consumers join
    on an empty PublishedState set without warning.
    """
    fx = await _fixtures(db_session)
    if fx is None:
        pytest.skip("Missing fixtures.")
    project_id, article_id, template_id, profile_id = fx

    service = RunLifecycleService(db_session)
    run = await service.create_run(
        project_id=project_id,
        article_id=article_id,
        project_template_id=template_id,
        user_id=profile_id,
    )
    for target in (
        ExtractionRunStage.EXTRACT,
        ExtractionRunStage.CONSENSUS,
    ):
        await service.advance_stage(run_id=run.id, target_stage=target, user_id=profile_id)

    with pytest.raises(EmptyFinalizeError):
        await service.advance_stage(
            run_id=run.id,
            target_stage=ExtractionRunStage.FINALIZED,
            user_id=profile_id,
        )

    # EmptyFinalizeError extends InvalidStageTransitionError so the existing
    # endpoint handler returns 400 — verify the subclass relationship.
    assert issubclass(EmptyFinalizeError, InvalidStageTransitionError)

    await db_session.rollback()


@pytest.mark.asyncio
async def test_finalize_blocked_until_required_fields_filled(
    db_session: AsyncSession,
) -> None:
    """Extraction completeness gate: a run with an unfilled REQUIRED field
    cannot finalize, even though it has a consensus decision; once every
    required (instance, field) carries a resolved value the same advance
    succeeds. Mirrors the frontend progress gate on the authoritative side.
    """
    from uuid import uuid4

    from app.models.extraction import ExtractionRun, TemplateKind
    from app.models.extraction_versioning import ExtractionTemplateVersion
    from app.models.extraction_workflow import ExtractionConsensusMode
    from app.services.extraction_consensus_service import ExtractionConsensusService
    from app.services.hitl_session_service import HITLSessionService
    from app.services.run_lifecycle_service import IncompleteFinalizeError

    fx = await _fixtures(db_session)
    if fx is None:
        pytest.skip("Missing fixtures.")
    project_id, article_id, template_id, profile_id = fx
    entity_type_id = SEED.primary_entity_type
    instance_id = SEED.primary_instance
    field_a = SEED.primary_field

    # Own the run state for this article/template (the suite leaks runs).
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
    run_id = session.run_id

    # The seeded primary template marks nothing required. Add a second real
    # field on the participants entity type and rewrite the run's frozen
    # snapshot so BOTH fields are required — the gate reads requiredness from
    # the snapshot, so this controls the test without touching live config.
    field_b = uuid4()
    await db_session.execute(
        text(
            "INSERT INTO public.extraction_fields "
            "(id, entity_type_id, name, label, field_type, is_required) "
            "VALUES (:id, :etid, 'second_required', 'Second Required', 'text', true)"
        ),
        {"id": str(field_b), "etid": str(entity_type_id)},
    )
    run = await db_session.get(ExtractionRun, run_id)
    assert run is not None
    version = await db_session.get(ExtractionTemplateVersion, run.version_id)
    assert version is not None
    version.schema_ = {
        "entity_types": [
            {
                "id": str(entity_type_id),
                "fields": [
                    {"id": str(field_a), "is_required": True},
                    {"id": str(field_b), "is_required": True},
                ],
            }
        ]
    }
    await db_session.flush()

    lifecycle = RunLifecycleService(db_session)
    # The session already parked the run in EXTRACT; advance straight to CONSENSUS.
    await lifecycle.advance_stage(
        run_id=run_id, target_stage=ExtractionRunStage.CONSENSUS, user_id=profile_id
    )

    consensus = ExtractionConsensusService(db_session)
    # Publish only field_a → passes the >=1-consensus gate but field_b is
    # still unfilled, so completeness must block finalize.
    await consensus.record_consensus(
        run_id=run_id,
        instance_id=instance_id,
        field_id=field_a,
        consensus_user_id=profile_id,
        mode=ExtractionConsensusMode.MANUAL_OVERRIDE,
        value={"value": "120"},
        rationale="fill first required field",
    )
    with pytest.raises(IncompleteFinalizeError):
        await lifecycle.advance_stage(
            run_id=run_id,
            target_stage=ExtractionRunStage.FINALIZED,
            user_id=profile_id,
        )

    # Fill the remaining required field → the same advance now succeeds.
    await consensus.record_consensus(
        run_id=run_id,
        instance_id=instance_id,
        field_id=field_b,
        consensus_user_id=profile_id,
        mode=ExtractionConsensusMode.MANUAL_OVERRIDE,
        value={"value": "done"},
        rationale="fill second required field",
    )
    finalized = await lifecycle.advance_stage(
        run_id=run_id,
        target_stage=ExtractionRunStage.FINALIZED,
        user_id=profile_id,
    )
    assert finalized.stage == ExtractionRunStage.FINALIZED.value

    await db_session.rollback()


@pytest.mark.asyncio
async def test_create_run_with_nonexistent_template_raises(db_session: AsyncSession) -> None:
    from uuid import uuid4

    from app.services.run_lifecycle_service import TemplateNotFoundError

    fx = await _fixtures(db_session)
    if fx is None:
        pytest.skip("Missing fixtures.")
    project_id, article_id, _, profile_id = fx

    service = RunLifecycleService(db_session)
    with pytest.raises(TemplateNotFoundError):
        await service.create_run(
            project_id=project_id,
            article_id=article_id,
            project_template_id=uuid4(),
            user_id=profile_id,
        )
    await db_session.rollback()


@pytest.mark.asyncio
async def test_reopen_after_cancelled_child_creates_fresh_run(
    db_session: AsyncSession,
) -> None:
    """Regression for: reopen_run returned a CANCELLED child instead of
    creating a new revision when the previous child had been cancelled.

    Trigger sequence:
      1. Parent run A finalized (via direct SQL to bypass EmptyFinalizeError).
      2. Reopen A → child run B (EXTRACT).
      3. Cancel B.
      4. Reopen A again → must create child run C (EXTRACT), not return B.
    """
    fx = await _fixtures(db_session)
    if fx is None:
        pytest.skip("Missing fixtures.")
    project_id, article_id, template_id, profile_id = fx

    service = RunLifecycleService(db_session)

    # Step 1: Create and force-finalize parent run A.
    parent = await service.create_run(
        project_id=project_id,
        article_id=article_id,
        project_template_id=template_id,
        user_id=profile_id,
    )
    await db_session.execute(
        text(
            "UPDATE public.extraction_runs "
            "SET stage = 'finalized', status = 'completed' WHERE id = :rid"
        ),
        {"rid": str(parent.id)},
    )
    await db_session.flush()
    # The direct SQL UPDATE bypasses SQLAlchemy's identity map, so the
    # ``parent`` Python object still has ``stage='pending'``. ``reopen_run``
    # SELECTs the run by id and the session would return the cached row
    # before re-querying — making the stage check fall through as PENDING.
    # Refresh the parent so the next SELECT sees the FINALIZED stage.
    await db_session.refresh(parent)

    # Step 2: Reopen → child B in EXTRACT.
    child_b, created_b = await service.reopen_run(run_id=parent.id, user_id=profile_id)
    assert created_b is True  # fresh fork
    assert child_b.stage == ExtractionRunStage.EXTRACT.value
    child_b_id = child_b.id

    # Step 3: Cancel child B.
    await service.advance_stage(
        run_id=child_b_id,
        target_stage=ExtractionRunStage.CANCELLED,
        user_id=profile_id,
    )

    # Step 4: Reopen A again — must produce a NEW child C, not return B.
    child_c, created_c = await service.reopen_run(run_id=parent.id, user_id=profile_id)
    assert created_c is True  # the cancelled child is not reused → a new fork
    assert child_c.id != child_b_id, "reopen_run returned the cancelled child instead of a new run"
    assert child_c.stage == ExtractionRunStage.EXTRACT.value

    await db_session.rollback()


@pytest.mark.asyncio
async def test_pending_extract_consensus_finalized_path(
    db_session: AsyncSession,
) -> None:
    """The collapsed 3-stage lifecycle: PENDING→EXTRACT→CONSENSUS→FINALIZED.

    Verifies:
    - PENDING can advance to EXTRACT.
    - EXTRACT cannot skip directly to FINALIZED (must go through CONSENSUS).
    """
    from app.models.extraction_workflow import ExtractionConsensusMode
    from app.services.extraction_consensus_service import ExtractionConsensusService

    fx = await _fixtures(db_session)
    if fx is None:
        pytest.skip("Missing fixtures.")
    project_id, article_id, template_id, profile_id = fx

    svc = RunLifecycleService(db_session)

    # Own the run state for this article/template (the suite leaks runs).
    await db_session.execute(
        text(
            "DELETE FROM public.extraction_runs WHERE project_id = :pid "
            "AND article_id = :aid AND template_id = :tid"
        ),
        {"pid": str(project_id), "aid": str(article_id), "tid": str(template_id)},
    )

    run = await svc.create_run(
        project_id=project_id,
        article_id=article_id,
        project_template_id=template_id,
        user_id=profile_id,
    )

    # PENDING → EXTRACT
    run = await svc.advance_stage(run_id=run.id, target_stage="extract", user_id=profile_id)
    assert run.stage == ExtractionRunStage.EXTRACT.value

    # EXTRACT cannot skip to FINALIZED
    with pytest.raises(InvalidStageTransitionError):
        await svc.advance_stage(run_id=run.id, target_stage="finalized", user_id=profile_id)

    # EXTRACT → CONSENSUS → FINALIZED (with a consensus decision to satisfy the gate)
    await svc.advance_stage(run_id=run.id, target_stage="consensus", user_id=profile_id)

    consensus = ExtractionConsensusService(db_session)
    await consensus.record_consensus(
        run_id=run.id,
        instance_id=SEED.primary_instance,
        field_id=SEED.primary_field,
        consensus_user_id=profile_id,
        mode=ExtractionConsensusMode.MANUAL_OVERRIDE,
        value={"value": "lifecycle-test"},
        rationale="test_pending_extract_consensus_finalized_path",
    )

    finalized = await svc.advance_stage(run_id=run.id, target_stage="finalized", user_id=profile_id)
    assert finalized.stage == ExtractionRunStage.FINALIZED.value

    await db_session.rollback()


async def test_enum_has_extract_not_proposal_review(db_session_real):
    rows = (
        (
            await db_session_real.execute(
                text("SELECT unnest(enum_range(NULL::public.extraction_run_stage))::text AS v")
            )
        )
        .scalars()
        .all()
    )
    assert "extract" in rows
    assert "proposal" not in rows
    assert "review" not in rows


@pytest.mark.asyncio
async def test_approve_and_finalize_publishes_agreed_and_finalizes(
    db_session: AsyncSession,
) -> None:
    """The no-divergence dead-end fix (spec I2): a run whose required field is
    filled only by a reviewer decision — with ZERO consensus decisions — cannot
    finalize via plain advance (EmptyFinalizeError). approve_and_finalize publishes
    the agreed value and finalizes in one atomic action."""
    from app.services.extraction_review_service import ExtractionReviewService

    fx = await _fixtures(db_session)
    if fx is None:
        pytest.skip("Missing fixtures.")
    project_id, article_id, template_id, profile_id = fx

    await db_session.execute(
        text(
            "DELETE FROM public.extraction_runs WHERE project_id = :p "
            "AND article_id = :a AND template_id = :t"
        ),
        {"p": str(project_id), "a": str(article_id), "t": str(template_id)},
    )
    svc = RunLifecycleService(db_session)
    run = await svc.create_run(
        project_id=project_id,
        article_id=article_id,
        project_template_id=template_id,
        user_id=profile_id,
    )
    await svc.advance_stage(run_id=run.id, target_stage="extract", user_id=profile_id)
    await ExtractionReviewService(db_session).record_decision(
        run_id=run.id,
        instance_id=SEED.primary_instance,
        field_id=SEED.primary_field,
        reviewer_id=profile_id,
        decision="edit",
        value={"value": "42"},
    )
    await svc.advance_stage(run_id=run.id, target_stage="consensus", user_id=profile_id)

    # Plain finalize would raise EmptyFinalizeError (zero consensus decisions);
    # approve_and_finalize publishes the agreed value first.
    finalized, published_count = await svc.approve_and_finalize(run_id=run.id, user_id=profile_id)
    assert finalized.stage == ExtractionRunStage.FINALIZED.value
    assert published_count == 1

    published = (
        (
            await db_session.execute(
                text("SELECT value FROM public.extraction_published_states WHERE run_id = :r"),
                {"r": str(run.id)},
            )
        )
        .scalars()
        .all()
    )
    assert len(published) == 1

    await db_session.rollback()


@pytest.mark.asyncio
async def test_approve_and_finalize_requires_consensus_stage(
    db_session: AsyncSession,
) -> None:
    fx = await _fixtures(db_session)
    if fx is None:
        pytest.skip("Missing fixtures.")
    project_id, article_id, template_id, profile_id = fx

    svc = RunLifecycleService(db_session)
    run = await svc.create_run(
        project_id=project_id,
        article_id=article_id,
        project_template_id=template_id,
        user_id=profile_id,
    )
    await svc.advance_stage(run_id=run.id, target_stage="extract", user_id=profile_id)
    with pytest.raises(InvalidStageTransitionError):
        await svc.approve_and_finalize(run_id=run.id, user_id=profile_id)
    await db_session.rollback()


@pytest.mark.asyncio
async def test_approve_and_finalize_blocks_unfilled_required(
    db_session: AsyncSession,
) -> None:
    """The completeness gate stays a real invariant: a required field with no
    resolved value still blocks finalize, even via approve_and_finalize. The seed
    marks nothing required, so we add a required field AND rewrite the run's frozen
    snapshot (the gate reads requiredness from the snapshot)."""
    from uuid import uuid4

    from app.models.extraction import ExtractionRun
    from app.models.extraction_versioning import ExtractionTemplateVersion
    from app.services.extraction_review_service import ExtractionReviewService
    from app.services.run_lifecycle_service import IncompleteFinalizeError

    fx = await _fixtures(db_session)
    if fx is None:
        pytest.skip("Missing fixtures.")
    project_id, article_id, template_id, profile_id = fx
    entity_type_id = SEED.primary_entity_type
    instance_id = SEED.primary_instance
    field_a = SEED.primary_field

    await db_session.execute(
        text(
            "DELETE FROM public.extraction_runs WHERE project_id = :p "
            "AND article_id = :a AND template_id = :t"
        ),
        {"p": str(project_id), "a": str(article_id), "t": str(template_id)},
    )
    svc = RunLifecycleService(db_session)
    run = await svc.create_run(
        project_id=project_id,
        article_id=article_id,
        project_template_id=template_id,
        user_id=profile_id,
    )

    # A second required field with no value; rewrite the frozen snapshot so BOTH
    # fields are required.
    field_b = uuid4()
    await db_session.execute(
        text(
            "INSERT INTO public.extraction_fields "
            "(id, entity_type_id, name, label, field_type, is_required) "
            "VALUES (:id, :etid, 'second_required', 'Second Required', 'text', true)"
        ),
        {"id": str(field_b), "etid": str(entity_type_id)},
    )
    run_orm = await db_session.get(ExtractionRun, run.id)
    version = await db_session.get(ExtractionTemplateVersion, run_orm.version_id)
    version.schema_ = {
        "entity_types": [
            {
                "id": str(entity_type_id),
                "fields": [
                    {"id": str(field_a), "is_required": True},
                    {"id": str(field_b), "is_required": True},
                ],
            }
        ]
    }
    await db_session.flush()

    await svc.advance_stage(run_id=run.id, target_stage="extract", user_id=profile_id)
    # Fill only field_a; field_b stays unfilled.
    await ExtractionReviewService(db_session).record_decision(
        run_id=run.id,
        instance_id=instance_id,
        field_id=field_a,
        reviewer_id=profile_id,
        decision="edit",
        value={"value": "120"},
    )
    await svc.advance_stage(run_id=run.id, target_stage="consensus", user_id=profile_id)

    with pytest.raises(IncompleteFinalizeError):
        await svc.approve_and_finalize(run_id=run.id, user_id=profile_id)

    # Resolve the second required field via consensus (we are in consensus stage),
    # then approve_and_finalize publishes the remaining agreed coord and succeeds.
    from app.models.extraction_workflow import ExtractionConsensusMode
    from app.services.extraction_consensus_service import ExtractionConsensusService

    await ExtractionConsensusService(db_session).record_consensus(
        run_id=run.id,
        instance_id=instance_id,
        field_id=field_b,
        consensus_user_id=profile_id,
        mode=ExtractionConsensusMode.MANUAL_OVERRIDE,
        value={"value": "done"},
        rationale="fill the second required field",
    )
    finalized, _ = await svc.approve_and_finalize(run_id=run.id, user_id=profile_id)
    assert finalized.stage == ExtractionRunStage.FINALIZED.value

    await db_session.rollback()


@pytest.mark.asyncio
async def test_approve_and_finalize_rejects_unresolved_divergence(
    db_session: AsyncSession,
) -> None:
    """Two reviewers disagree on a coord with no published resolution → approve is
    rejected (the manager must resolve the divergence first)."""
    from app.services.extraction_review_service import ExtractionReviewService

    fx = await _fixtures(db_session)
    if fx is None:
        pytest.skip("Missing fixtures.")
    project_id, article_id, template_id, profile_id = fx
    reviewer_id = SEED.reviewer_profile

    await db_session.execute(
        text(
            "DELETE FROM public.extraction_runs WHERE project_id = :p "
            "AND article_id = :a AND template_id = :t"
        ),
        {"p": str(project_id), "a": str(article_id), "t": str(template_id)},
    )
    svc = RunLifecycleService(db_session)
    run = await svc.create_run(
        project_id=project_id,
        article_id=article_id,
        project_template_id=template_id,
        user_id=profile_id,
    )
    await svc.advance_stage(run_id=run.id, target_stage="extract", user_id=profile_id)
    review = ExtractionReviewService(db_session)
    await review.record_decision(
        run_id=run.id,
        instance_id=SEED.primary_instance,
        field_id=SEED.primary_field,
        reviewer_id=profile_id,
        decision="edit",
        value={"value": "M"},
    )
    await review.record_decision(
        run_id=run.id,
        instance_id=SEED.primary_instance,
        field_id=SEED.primary_field,
        reviewer_id=reviewer_id,
        decision="edit",
        value={"value": "R"},
    )
    await svc.advance_stage(run_id=run.id, target_stage="consensus", user_id=profile_id)

    with pytest.raises(InvalidStageTransitionError, match="diverge"):
        await svc.approve_and_finalize(run_id=run.id, user_id=profile_id)
    await db_session.rollback()


@pytest.mark.asyncio
async def test_approve_and_finalize_treats_unit_difference_as_divergence(
    db_session: AsyncSession,
) -> None:
    """Phase B (decision G) — comparison contract: agreement is keyed on the FULL
    stored envelope, not the unit-stripped scalar. This feeds the ``{value, unit}``
    shape directly (the value remaining after one ``{value: …}`` peel): the old key
    ``_unwrap_value(resolved)`` collapsed it to ``"5"`` and FALSELY agreed on
    ``5 mg`` vs ``5 g``; the full-envelope key keeps the unit, so the coord is a
    conflict and approve_and_finalize must REJECT. (The form double-wraps unit
    values as ``{value: {value, unit}}`` — see the production-fidelity test below —
    so this synthetic shape isolates the one-level-peel behaviour the fix targets.)"""
    from app.services.extraction_review_service import ExtractionReviewService

    fx = await _fixtures(db_session)
    if fx is None:
        pytest.skip("Missing fixtures.")
    project_id, article_id, template_id, profile_id = fx
    reviewer_id = SEED.reviewer_profile

    await db_session.execute(
        text(
            "DELETE FROM public.extraction_runs WHERE project_id = :p "
            "AND article_id = :a AND template_id = :t"
        ),
        {"p": str(project_id), "a": str(article_id), "t": str(template_id)},
    )
    svc = RunLifecycleService(db_session)
    run = await svc.create_run(
        project_id=project_id,
        article_id=article_id,
        project_template_id=template_id,
        user_id=profile_id,
    )
    await svc.advance_stage(run_id=run.id, target_stage="extract", user_id=profile_id)
    review = ExtractionReviewService(db_session)
    await review.record_decision(
        run_id=run.id,
        instance_id=SEED.primary_instance,
        field_id=SEED.primary_field,
        reviewer_id=profile_id,
        decision="edit",
        value={"value": "5", "unit": "mg"},
    )
    await review.record_decision(
        run_id=run.id,
        instance_id=SEED.primary_instance,
        field_id=SEED.primary_field,
        reviewer_id=reviewer_id,
        decision="edit",
        value={"value": "5", "unit": "g"},
    )
    await svc.advance_stage(run_id=run.id, target_stage="consensus", user_id=profile_id)

    with pytest.raises(InvalidStageTransitionError, match="diverge"):
        await svc.approve_and_finalize(run_id=run.id, user_id=profile_id)

    # Nothing was auto-published — the conflict must be resolved by the manager.
    published = (
        await db_session.execute(
            text("SELECT count(*) FROM public.extraction_published_states WHERE run_id = :r"),
            {"r": str(run.id)},
        )
    ).scalar()
    assert published == 0
    await db_session.rollback()


@pytest.mark.asyncio
async def test_approve_and_finalize_publishes_identical_full_envelope(
    db_session: AsyncSession,
) -> None:
    """Phase B (decision G) guardrail: when two reviewers submit the SAME full
    envelope (value AND unit), it is still agreement — approve_and_finalize
    publishes the single value and finalizes. The envelope is published verbatim
    (unit preserved), not the unwrapped scalar. A single-key ``{value: X}`` must
    likewise keep agreeing across reviewers — only differing siblings diverge."""
    from app.services.extraction_review_service import ExtractionReviewService

    fx = await _fixtures(db_session)
    if fx is None:
        pytest.skip("Missing fixtures.")
    project_id, article_id, template_id, profile_id = fx
    reviewer_id = SEED.reviewer_profile

    await db_session.execute(
        text(
            "DELETE FROM public.extraction_runs WHERE project_id = :p "
            "AND article_id = :a AND template_id = :t"
        ),
        {"p": str(project_id), "a": str(article_id), "t": str(template_id)},
    )
    svc = RunLifecycleService(db_session)
    run = await svc.create_run(
        project_id=project_id,
        article_id=article_id,
        project_template_id=template_id,
        user_id=profile_id,
    )
    await svc.advance_stage(run_id=run.id, target_stage="extract", user_id=profile_id)
    review = ExtractionReviewService(db_session)
    envelope = {"value": "5", "unit": "mg"}
    await review.record_decision(
        run_id=run.id,
        instance_id=SEED.primary_instance,
        field_id=SEED.primary_field,
        reviewer_id=profile_id,
        decision="edit",
        value=dict(envelope),
    )
    await review.record_decision(
        run_id=run.id,
        instance_id=SEED.primary_instance,
        field_id=SEED.primary_field,
        reviewer_id=reviewer_id,
        decision="edit",
        value=dict(envelope),
    )
    await svc.advance_stage(run_id=run.id, target_stage="consensus", user_id=profile_id)

    finalized, published_count = await svc.approve_and_finalize(run_id=run.id, user_id=profile_id)
    assert finalized.stage == ExtractionRunStage.FINALIZED.value
    assert published_count == 1

    published_value = (
        await db_session.execute(
            text("SELECT value FROM public.extraction_published_states WHERE run_id = :r"),
            {"r": str(run.id)},
        )
    ).scalar()
    assert published_value == envelope  # full envelope preserved, unit intact
    await db_session.rollback()


@pytest.mark.asyncio
async def test_approve_and_finalize_real_form_double_wrapped_unit_diverges(
    db_session: AsyncSession,
) -> None:
    """Phase B (decision G) — production fidelity. The form does NOT store a bare
    ``{value, unit}``: the autosave builds ``{value, unit}`` and ``writeRunFieldValue``
    wraps it again, so the reviewer decision value is ``{value: {value, unit}}``
    (frontend/services/extractionRunService.ts). This test feeds that exact stored
    shape — ``{value: {value:"5", unit:"mg"}}`` vs ``{value: {value:"5", unit:"g"}}`` —
    and confirms approve_and_finalize REJECTS and publishes nothing. (With this
    double-wrapped shape the old one-level ``_unwrap_value`` already kept the unit,
    so this guards that the full-envelope key does not regress the real path.)"""
    from app.services.extraction_review_service import ExtractionReviewService

    fx = await _fixtures(db_session)
    if fx is None:
        pytest.skip("Missing fixtures.")
    project_id, article_id, template_id, profile_id = fx
    reviewer_id = SEED.reviewer_profile

    await db_session.execute(
        text(
            "DELETE FROM public.extraction_runs WHERE project_id = :p "
            "AND article_id = :a AND template_id = :t"
        ),
        {"p": str(project_id), "a": str(article_id), "t": str(template_id)},
    )
    svc = RunLifecycleService(db_session)
    run = await svc.create_run(
        project_id=project_id,
        article_id=article_id,
        project_template_id=template_id,
        user_id=profile_id,
    )
    await svc.advance_stage(run_id=run.id, target_stage="extract", user_id=profile_id)
    review = ExtractionReviewService(db_session)
    await review.record_decision(
        run_id=run.id,
        instance_id=SEED.primary_instance,
        field_id=SEED.primary_field,
        reviewer_id=profile_id,
        decision="edit",
        value={"value": {"value": "5", "unit": "mg"}},
    )
    await review.record_decision(
        run_id=run.id,
        instance_id=SEED.primary_instance,
        field_id=SEED.primary_field,
        reviewer_id=reviewer_id,
        decision="edit",
        value={"value": {"value": "5", "unit": "g"}},
    )
    await svc.advance_stage(run_id=run.id, target_stage="consensus", user_id=profile_id)

    with pytest.raises(InvalidStageTransitionError, match="diverge"):
        await svc.approve_and_finalize(run_id=run.id, user_id=profile_id)

    published = (
        await db_session.execute(
            text("SELECT count(*) FROM public.extraction_published_states WHERE run_id = :r"),
            {"r": str(run.id)},
        )
    ).scalar()
    assert published == 0
    await db_session.rollback()


# ---------------------------------------------------------------------------
# D8-c: QA decision materialization at extract -> consensus
# ---------------------------------------------------------------------------


async def _insert_legacy_human_proposal(
    db: AsyncSession,
    *,
    run_id: UUID,
    instance_id: UUID,
    field_id: UUID,
    profile_id: UUID,
    value: str,
    backdate_minutes: int = 0,
) -> UUID:
    """Raw-INSERT a pre-D8 human proposal (the service now rejects them).

    Legacy rows only exist as stored data, so tests seed them the way they
    actually exist: straight into the table. ``backdate_minutes`` matters
    because created_at's server_default now() is TRANSACTION-scoped in PG —
    two rows in one test transaction would tie, making newest-per-coord
    nondeterministic (in production each autosave POST was its own
    transaction, so timestamps are naturally distinct).
    """
    proposal_id = uuid4()
    await db.execute(
        text(
            "INSERT INTO public.extraction_proposal_records "
            "(id, run_id, instance_id, field_id, source, source_user_id, "
            " proposed_value, created_at) "
            "VALUES (:id, :r, :i, :f, 'human', :u, CAST(:v AS jsonb), "
            "        now() - make_interval(mins => :backdate))"
        ),
        {
            "id": str(proposal_id),
            "r": str(run_id),
            "i": str(instance_id),
            "f": str(field_id),
            "u": str(profile_id),
            "v": json.dumps({"value": value}),
            "backdate": backdate_minutes,
        },
    )
    return proposal_id


async def _qa_run_with_human_proposal(
    db: AsyncSession,
) -> tuple[UUID, UUID, UUID, UUID, UUID] | None:
    """QA run in extract + ONE human proposal (newest of two) on the coord.

    Returns (run_id, instance_id, field_id, profile_id, newest_proposal_id).
    """
    from tests.integration.test_extraction_proposal_service import (
        _setup_qa_run_with_instance_field,
    )

    built = await _setup_qa_run_with_instance_field(db)
    if built is None:
        return None
    run_id, instance_id, field_id, profile_id = built

    await _insert_legacy_human_proposal(
        db,
        run_id=run_id,
        instance_id=instance_id,
        field_id=field_id,
        profile_id=profile_id,
        value="first answer",
        backdate_minutes=1,
    )
    newest_id = await _insert_legacy_human_proposal(
        db,
        run_id=run_id,
        instance_id=instance_id,
        field_id=field_id,
        profile_id=profile_id,
        value="final answer",
    )
    return run_id, instance_id, field_id, profile_id, newest_id


@pytest.mark.asyncio
async def test_qa_advance_materializes_edit_decisions(db_session: AsyncSession) -> None:
    built = await _qa_run_with_human_proposal(db_session)
    if built is None:
        pytest.skip("Missing fixtures.")
    run_id, instance_id, field_id, profile_id, newest_id = built

    svc = RunLifecycleService(db_session)
    advanced = await svc.advance_stage(
        run_id=run_id, target_stage=ExtractionRunStage.CONSENSUS, user_id=profile_id
    )
    assert advanced.stage == ExtractionRunStage.CONSENSUS.value

    rows = (
        await db_session.execute(
            text(
                "SELECT decision, value, proposal_record_id, rationale "
                "FROM public.extraction_reviewer_decisions "
                "WHERE run_id = :r AND reviewer_id = :u AND instance_id = :i AND field_id = :f"
            ),
            {
                "r": str(run_id),
                "u": str(profile_id),
                "i": str(instance_id),
                "f": str(field_id),
            },
        )
    ).all()
    assert len(rows) == 1, "exactly one decision per (reviewer, coord) materialized"
    decision, value, proposal_record_id, rationale = rows[0]
    assert decision == "edit"
    assert value == {"value": "final answer"}, "the NEWEST human proposal's value is copied"
    assert proposal_record_id is None, "a human proposal is not an AI basis"
    assert rationale is not None and rationale.startswith("Materialized from human proposal")
    assert str(newest_id) in rationale

    state = (
        await db_session.execute(
            text(
                "SELECT current_decision_id FROM public.extraction_reviewer_states "
                "WHERE run_id = :r AND reviewer_id = :u AND instance_id = :i AND field_id = :f"
            ),
            {
                "r": str(run_id),
                "u": str(profile_id),
                "i": str(instance_id),
                "f": str(field_id),
            },
        )
    ).scalar()
    assert state is not None, "ExtractionReviewerState pointer upserted"
    await db_session.rollback()


@pytest.mark.asyncio
async def test_qa_materialization_skips_coords_with_existing_decision(
    db_session: AsyncSession,
) -> None:
    from app.services.extraction_review_service import ExtractionReviewService

    built = await _qa_run_with_human_proposal(db_session)
    if built is None:
        pytest.skip("Missing fixtures.")
    run_id, instance_id, field_id, profile_id, _ = built

    # The reviewer made a REAL decision with a different value — it wins.
    review = ExtractionReviewService(db_session)
    await review.record_decision(
        run_id=run_id,
        instance_id=instance_id,
        field_id=field_id,
        reviewer_id=profile_id,
        decision="edit",
        value={"value": "deliberate answer"},
    )

    svc = RunLifecycleService(db_session)
    await svc.advance_stage(
        run_id=run_id, target_stage=ExtractionRunStage.CONSENSUS, user_id=profile_id
    )

    rows = (
        await db_session.execute(
            text(
                "SELECT value FROM public.extraction_reviewer_decisions "
                "WHERE run_id = :r AND reviewer_id = :u AND instance_id = :i AND field_id = :f"
            ),
            {
                "r": str(run_id),
                "u": str(profile_id),
                "i": str(instance_id),
                "f": str(field_id),
            },
        )
    ).all()
    assert len(rows) == 1, "coords with ANY existing decision are skipped, never overwritten"
    assert rows[0][0] == {"value": "deliberate answer"}
    await db_session.rollback()


@pytest.mark.asyncio
async def test_qa_materialization_replay_is_noop(db_session: AsyncSession) -> None:
    from app.models.extraction import ExtractionRun

    built = await _qa_run_with_human_proposal(db_session)
    if built is None:
        pytest.skip("Missing fixtures.")
    run_id, _instance_id, _field_id, _profile_id, _ = built

    from app.services.extraction_review_service import ExtractionReviewService

    run = await db_session.get(ExtractionRun, run_id)
    assert run is not None

    review = ExtractionReviewService(db_session)
    first = await review.materialize_qa_decisions(run)
    second = await review.materialize_qa_decisions(run)
    assert first == 1
    assert second == 0, "replaying the materialization is a no-op"

    count = (
        await db_session.execute(
            text("SELECT count(*) FROM public.extraction_reviewer_decisions WHERE run_id = :r"),
            {"r": str(run_id)},
        )
    ).scalar()
    assert count == 1
    await db_session.rollback()


@pytest.mark.asyncio
async def test_extraction_advance_does_not_materialize(db_session: AsyncSession) -> None:
    from tests.integration.test_extraction_proposal_service import (
        _setup_run_with_instance_field,
    )

    built = await _setup_run_with_instance_field(db_session)
    if built is None:
        pytest.skip("Missing fixtures.")
    run_id, instance_id, field_id, profile_id = built

    # A stray human proposal on an EXTRACTION run (raw insert — the proposal
    # service's gate blocks human proposals for both kinds).
    await _insert_legacy_human_proposal(
        db_session,
        run_id=run_id,
        instance_id=instance_id,
        field_id=field_id,
        profile_id=profile_id,
        value="stray",
    )

    svc = RunLifecycleService(db_session)
    await svc.advance_stage(
        run_id=run_id, target_stage=ExtractionRunStage.CONSENSUS, user_id=profile_id
    )

    count = (
        await db_session.execute(
            text("SELECT count(*) FROM public.extraction_reviewer_decisions WHERE run_id = :r"),
            {"r": str(run_id)},
        )
    ).scalar()
    assert count == 0, "materialization is QA-only"
    await db_session.rollback()


@pytest.mark.asyncio
async def test_qa_select_existing_succeeds_against_materialized_row(
    db_session: AsyncSession,
) -> None:
    from app.services.extraction_consensus_service import ExtractionConsensusService

    built = await _qa_run_with_human_proposal(db_session)
    if built is None:
        pytest.skip("Missing fixtures.")
    run_id, instance_id, field_id, profile_id, _ = built

    svc = RunLifecycleService(db_session)
    await svc.advance_stage(
        run_id=run_id, target_stage=ExtractionRunStage.CONSENSUS, user_id=profile_id
    )
    materialized_id = (
        await db_session.execute(
            text(
                "SELECT id FROM public.extraction_reviewer_decisions "
                "WHERE run_id = :r AND instance_id = :i AND field_id = :f"
            ),
            {"r": str(run_id), "i": str(instance_id), "f": str(field_id)},
        )
    ).scalar()
    assert materialized_id is not None

    consensus = ExtractionConsensusService(db_session)
    decision, published = await consensus.record_consensus(
        run_id=run_id,
        instance_id=instance_id,
        field_id=field_id,
        consensus_user_id=profile_id,
        mode="select_existing",
        selected_decision_id=materialized_id,
    )
    assert decision.selected_decision_id == materialized_id
    assert published.value == {"value": "final answer"}
    await db_session.rollback()


@pytest.mark.asyncio
async def test_qa_single_user_export_not_blank_after_advance(
    db_session: AsyncSession,
) -> None:

    from app.models.extraction import ExtractionFieldType
    from app.services.extraction_export_service import (
        ExtractionExportService,
        FieldDescriptor,
    )

    built = await _qa_run_with_human_proposal(db_session)
    if built is None:
        pytest.skip("Missing fixtures.")
    run_id, _instance_id, field_id, profile_id, _ = built

    svc = RunLifecycleService(db_session)
    await svc.advance_stage(
        run_id=run_id, target_stage=ExtractionRunStage.CONSENSUS, user_id=profile_id
    )

    export = ExtractionExportService(
        db=db_session,
        user_id=str(profile_id),
        storage=None,  # type: ignore[arg-type]
    )
    value_map = await export._build_single_user_value_map(
        run_ids=[run_id],
        reviewer_id=profile_id,
        fields_by_id={
            field_id: FieldDescriptor(
                field_id=field_id,
                label="QA Field",
                type=ExtractionFieldType.SELECT,
                allowed_values=(),
                parent_section_id=uuid4(),
            )
        },
    )
    assert value_map, "single-user QA export must not be blank after materialization"
    assert "final answer" in " ".join(str(v) for v in value_map.values())
    await db_session.rollback()
