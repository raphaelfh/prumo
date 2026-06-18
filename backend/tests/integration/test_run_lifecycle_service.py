"""Integration tests for RunLifecycleService."""

from uuid import UUID

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
async def test_advance_pending_to_proposal_succeeds(
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
        target_stage=ExtractionRunStage.PROPOSAL,
        user_id=profile_id,
    )
    assert advanced.stage == ExtractionRunStage.PROPOSAL.value
    await db_session.rollback()


@pytest.mark.asyncio
async def test_advance_pending_to_review_fails(db_session: AsyncSession) -> None:
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
            target_stage=ExtractionRunStage.REVIEW,
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
            target_stage=ExtractionRunStage.PROPOSAL,
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
        ExtractionRunStage.PROPOSAL,
        ExtractionRunStage.REVIEW,
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
    await lifecycle.advance_stage(
        run_id=run_id, target_stage=ExtractionRunStage.REVIEW, user_id=profile_id
    )
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
      2. Reopen A → child run B (REVIEW).
      3. Cancel B.
      4. Reopen A again → must create child run C (REVIEW), not return B.
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

    # Step 2: Reopen → child B in REVIEW.
    child_b, created_b = await service.reopen_run(run_id=parent.id, user_id=profile_id)
    assert created_b is True  # fresh fork
    assert child_b.stage == ExtractionRunStage.REVIEW.value
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
    assert child_c.stage == ExtractionRunStage.REVIEW.value

    await db_session.rollback()
