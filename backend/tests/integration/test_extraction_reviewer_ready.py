"""Integration tests for the per-reviewer ready flag (HITL Phase 2, Task 1)."""

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.repositories.extraction_reviewer_ready_repository import (
    ExtractionReviewerReadyRepository,
)
from app.services.run_lifecycle_service import RunLifecycleService
from tests.integration.conftest import SEED


async def _ctx(db: AsyncSession):
    """Return the seeded coherent (project, article, template, profile) tuple, or None."""
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
async def test_reviewer_ready_table_exists(db_session_real: AsyncSession) -> None:
    rows = (
        (
            await db_session_real.execute(
                text(
                    "SELECT column_name FROM information_schema.columns "
                    "WHERE table_schema='public' AND table_name='extraction_reviewer_ready'"
                )
            )
        )
        .scalars()
        .all()
    )
    assert {
        "id",
        "run_id",
        "reviewer_id",
        "is_ready",
        "marked_ready_at",
        "created_at",
        "updated_at",
    } <= set(rows)


@pytest.mark.asyncio
async def test_ready_upsert_is_idempotent_and_toggles(db_session: AsyncSession) -> None:
    ctx = await _ctx(db_session)
    if ctx is None:
        pytest.skip("Missing fixtures.")
    project_id, article_id, template_id, profile_id = ctx

    run = await RunLifecycleService(db_session).create_run(
        project_id=project_id,
        article_id=article_id,
        project_template_id=template_id,
        user_id=profile_id,
    )
    repo = ExtractionReviewerReadyRepository(db_session)

    row = await repo.upsert(run_id=run.id, reviewer_id=profile_id, is_ready=True)
    assert row.is_ready is True
    assert row.marked_ready_at is not None
    # Idempotent re-mark.
    await repo.upsert(run_id=run.id, reviewer_id=profile_id, is_ready=True)
    assert await repo.ready_reviewer_ids(run.id) == [profile_id]

    # Un-mark clears the flag and the set.
    cleared = await repo.upsert(run_id=run.id, reviewer_id=profile_id, is_ready=False)
    assert cleared.is_ready is False
    assert cleared.marked_ready_at is None
    assert await repo.ready_reviewer_ids(run.id) == []

    await db_session.rollback()
