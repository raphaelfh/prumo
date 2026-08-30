"""Concurrency / race-condition tests for RunLifecycleService.

Covers issues #54, #65, #66, #68, #69 — the run-lifecycle bugs that were
exposed by concurrent or unusual data states (TOCTOU on first-run
version snapshot, missing row locks on advance / reopen, inactive
v=1 row hitting the unique constraint).

The tests use multiple sessions on the same engine so that the SELECTs
and UPDATEs really do contend on the same DB rows. ``asyncio.gather``
runs the two service calls concurrently in the same event loop.
"""

from __future__ import annotations

import asyncio
from collections.abc import AsyncGenerator
from uuid import UUID

import pytest
import pytest_asyncio
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.config import settings
from app.models.extraction import ExtractionRunStage
from app.services.run_lifecycle_service import (
    InvalidStageTransitionError,
    RunLifecycleService,
)
from tests.integration.conftest import SEED


@pytest_asyncio.fixture
async def session_factory() -> AsyncGenerator[async_sessionmaker[AsyncSession], None]:
    """Two-session factory bound to a single engine so concurrent
    transactions contend on the same connection pool."""
    engine = create_async_engine(settings.async_database_url, echo=False, pool_pre_ping=True)
    yield async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    await engine.dispose()


async def _pick_basic_fixtures(db: AsyncSession) -> tuple[UUID, UUID, UUID] | None:
    """Return the seeded coherent ``(project_id, article_id, profile_id)`` tuple.

    Replaces three independent ``LIMIT 1`` lookups that, on a dev DB with
    rows from several projects, happily returned project=A / article=B /
    profile=C — incoherent, so ``RunLifecycleService.create_run`` raised
    ``TemplateNotFoundError`` because the chosen template's
    ``project_id`` did not match the chosen project. The sentinel tuple
    seeded by ``seeded_integration_db`` always forms a coherent graph
    (``primary_profile`` manages ``primary_project`` which owns
    ``primary_article``).
    """
    if (
        await db.execute(
            text("SELECT 1 FROM public.profiles WHERE id = :id"),
            {"id": str(SEED.primary_profile)},
        )
    ).scalar() is None:
        return None
    return SEED.primary_project, SEED.primary_article, SEED.primary_profile


# ===================== advance_stage: row lock =====================


@pytest.mark.asyncio
async def test_concurrent_advance_stage_serialises_via_row_lock(
    session_factory: async_sessionmaker[AsyncSession],
) -> None:
    """Issue #68: two concurrent advance_stage calls on the same run
    must serialise. One transition wins; the second caller sees the
    new stage and either gets InvalidStageTransitionError or the
    serialised outcome — never a silent overwrite."""
    async with session_factory() as setup_session:
        fx = await _pick_basic_fixtures(setup_session)
        if fx is None:
            pytest.skip("Missing project/article/profile fixtures")
        project_id, article_id, profile_id = fx
        # Use the seeded sentinel template so it stays coherent with the
        # project/article picked above. An earlier ``LIMIT 1`` over
        # ``project_extraction_templates`` could land on a template from
        # a different project on a polluted dev DB and trip
        # ``TemplateNotFoundError`` inside ``create_run``.
        template_id = SEED.primary_template
        run = await RunLifecycleService(setup_session).create_run(
            project_id=project_id,
            article_id=article_id,
            project_template_id=template_id,
            user_id=profile_id,
        )
        await setup_session.commit()
        run_id = run.id

    async def _advance(session: AsyncSession, target: ExtractionRunStage) -> str:
        result = await RunLifecycleService(session).advance_stage(
            run_id=run_id,
            target_stage=target,
            user_id=profile_id,
        )
        await session.commit()
        return result.stage

    try:
        async with session_factory() as s1, session_factory() as s2:
            # Race two identical advances PENDING → EXTRACT. Without a
            # row lock both callers see stage=PENDING, both pass the
            # precondition, and both write stage=EXTRACT silently
            # (the second succeeds even though it raced with the first).
            # With the FOR UPDATE lock, the second caller blocks until
            # the first commits, then wakes up to see stage=EXTRACT —
            # EXTRACT → EXTRACT is not an allowed transition, so it
            # raises InvalidStageTransitionError instead of silently
            # overwriting.
            results = await asyncio.gather(
                _advance(s1, ExtractionRunStage.EXTRACT),
                _advance(s2, ExtractionRunStage.EXTRACT),
                return_exceptions=True,
            )
        successes = [r for r in results if isinstance(r, str)]
        invalid = [r for r in results if isinstance(r, InvalidStageTransitionError)]
        assert len(successes) == 1, results
        assert len(invalid) == 1, results
        assert successes[0] == ExtractionRunStage.EXTRACT.value

        async with session_factory() as verify:
            stage = (
                await verify.execute(
                    text("SELECT stage FROM public.extraction_runs WHERE id = :rid"),
                    {"rid": str(run_id)},
                )
            ).scalar()
            assert stage == ExtractionRunStage.EXTRACT.value
    finally:
        async with session_factory() as cleanup:
            await cleanup.execute(
                text("DELETE FROM public.extraction_runs WHERE id = :rid"),
                {"rid": str(run_id)},
            )
            await cleanup.commit()


# ===================== reopen_run: row lock + idempotent child =====================


@pytest.mark.asyncio
async def test_concurrent_reopen_does_not_fork_multiple_children(
    session_factory: async_sessionmaker[AsyncSession],
) -> None:
    """Issue #66: two concurrent reopen_run calls on the same finalized
    parent must produce a single child run. The row lock serialises
    the calls; the existing-child check makes the loser idempotent."""
    async with session_factory() as setup_session:
        fx = await _pick_basic_fixtures(setup_session)
        if fx is None:
            pytest.skip("Missing fixtures")
        project_id, article_id, profile_id = fx
        # Use the sentinel template so it stays coherent with the seeded
        # project/article (see _pick_basic_fixtures). The previous
        # ``LIMIT 1`` could land on a different project's template on a
        # polluted dev DB.
        template_id = SEED.primary_template
        run = await RunLifecycleService(setup_session).create_run(
            project_id=project_id,
            article_id=article_id,
            project_template_id=template_id,
            user_id=profile_id,
        )
        # Drive directly to FINALIZED — no consensus needed for this test.
        await setup_session.execute(
            text(
                "UPDATE public.extraction_runs SET stage = 'finalized', "
                "status = 'completed' WHERE id = :rid"
            ),
            {"rid": str(run.id)},
        )
        await setup_session.commit()
        parent_id = run.id

    async def _reopen(session: AsyncSession) -> UUID:
        child, _ = await RunLifecycleService(session).reopen_run(
            run_id=parent_id, user_id=profile_id
        )
        await session.commit()
        return child.id

    try:
        async with session_factory() as s1, session_factory() as s2:
            results = await asyncio.gather(_reopen(s1), _reopen(s2), return_exceptions=True)
        ids = [r for r in results if isinstance(r, UUID)]
        # Both calls must succeed and return the same child id (the
        # second caller picks up the first caller's child via the
        # existing-child check inside the locked section).
        assert len(ids) == 2, results
        assert ids[0] == ids[1], f"Forked into two children: {ids}"

        async with session_factory() as verify:
            child_count = (
                await verify.execute(
                    text(
                        "SELECT COUNT(*) FROM public.extraction_runs "
                        "WHERE template_id = :tid AND article_id = :aid "
                        "AND parameters->>'parent_run_id' = :pid"
                    ),
                    {
                        "tid": str(template_id),
                        "aid": str(article_id),
                        "pid": str(parent_id),
                    },
                )
            ).scalar()
            assert child_count == 1
    finally:
        async with session_factory() as cleanup:
            await cleanup.execute(
                text(
                    "DELETE FROM public.extraction_runs "
                    "WHERE id = CAST(:pid_uuid AS uuid) "
                    "OR parameters->>'parent_run_id' = :pid_text"
                ),
                {"pid_uuid": str(parent_id), "pid_text": str(parent_id)},
            )
            await cleanup.commit()
