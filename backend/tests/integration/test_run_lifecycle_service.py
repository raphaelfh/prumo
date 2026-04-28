"""Integration tests for RunLifecycleService."""

from uuid import UUID

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.extraction import ExtractionRunStage
from app.services.run_lifecycle_service import (
    InvalidStageTransitionError,
    RunLifecycleService,
)


async def _fixtures(db: AsyncSession) -> tuple[UUID, UUID, UUID, UUID] | None:
    """Return (project_id, article_id, project_template_id, profile_id) or None."""
    project_id = (await db.execute(text("SELECT id FROM public.projects LIMIT 1"))).scalar()
    article_id = (await db.execute(text("SELECT id FROM public.articles LIMIT 1"))).scalar()
    template_id = (
        await db.execute(text("SELECT id FROM public.project_extraction_templates LIMIT 1"))
    ).scalar()
    profile_id = (await db.execute(text("SELECT id FROM public.profiles LIMIT 1"))).scalar()
    if not all((project_id, article_id, template_id, profile_id)):
        return None
    return project_id, article_id, template_id, profile_id


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
