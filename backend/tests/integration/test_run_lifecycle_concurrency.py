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
from uuid import UUID, uuid4

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


@pytest_asyncio.fixture
async def session_factory() -> AsyncGenerator[async_sessionmaker[AsyncSession], None]:
    """Two-session factory bound to a single engine so concurrent
    transactions contend on the same connection pool."""
    engine = create_async_engine(settings.async_database_url, echo=False, pool_pre_ping=True)
    yield async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    await engine.dispose()


async def _pick_basic_fixtures(db: AsyncSession) -> tuple[UUID, UUID, UUID] | None:
    project_id = (await db.execute(text("SELECT id FROM public.projects LIMIT 1"))).scalar()
    article_id = (await db.execute(text("SELECT id FROM public.articles LIMIT 1"))).scalar()
    profile_id = (await db.execute(text("SELECT id FROM public.profiles LIMIT 1"))).scalar()
    if not all((project_id, article_id, profile_id)):
        return None
    return UUID(str(project_id)), UUID(str(article_id)), UUID(str(profile_id))


async def _create_fresh_extraction_template(
    db: AsyncSession,
    *,
    project_id: UUID,
    profile_id: UUID,
) -> UUID:
    """Insert a brand-new project_extraction_template that has NO
    extraction_template_versions row, so the next create_run call must
    lazily snapshot v=1."""
    template_id = uuid4()
    await db.execute(
        text(
            """
            INSERT INTO public.project_extraction_templates
              (id, project_id, name, kind, framework, is_active,
               created_by, created_at, updated_at)
            VALUES
              (:id, :pid, :name, 'extraction', 'CUSTOM', false,
               :uid, NOW(), NOW())
            """
        ),
        {
            "id": str(template_id),
            "pid": str(project_id),
            "name": f"race-tpl-{template_id.hex[:8]}",
            "uid": str(profile_id),
        },
    )
    # The active-version invariant trigger is DEFERRED so we can flush
    # without an active version, but we must seed one before COMMIT.
    version_id = uuid4()
    await db.execute(
        text(
            """
            INSERT INTO public.extraction_template_versions
              (id, project_template_id, version, schema, published_at,
               published_by, is_active, created_at, updated_at)
            VALUES
              (:id, :tid, 1, '{"entity_types": []}'::jsonb, NOW(),
               :uid, true, NOW(), NOW())
            """
        ),
        {"id": str(version_id), "tid": str(template_id), "uid": str(profile_id)},
    )
    await db.commit()
    return template_id


async def _set_version_inactive(db: AsyncSession, template_id: UUID) -> None:
    """Flip the only active version row to is_active=false (simulating
    issue #65: a partial rollback or manual fix). The active-version
    trigger only fires when a parent template exists; we keep it
    happy by reactivating it again at the end of each test before
    cleanup commits."""
    await db.execute(
        text(
            "UPDATE public.extraction_template_versions "
            "SET is_active = false WHERE project_template_id = :tid"
        ),
        {"tid": str(template_id)},
    )


async def _cleanup_template(db: AsyncSession, template_id: UUID) -> None:
    """Drop everything we created. Required because integration tests
    commit (otherwise the trigger fires) and the test DB is shared."""
    await db.execute(
        text("DELETE FROM public.extraction_runs WHERE template_id = :tid"),
        {"tid": str(template_id)},
    )
    await db.execute(
        text("DELETE FROM public.project_extraction_templates WHERE id = :tid"),
        {"tid": str(template_id)},
    )
    await db.commit()


# ============== _snapshot_initial_version: races + reactivation ==============


@pytest.mark.asyncio
async def test_snapshot_initial_version_is_idempotent_against_existing_active(
    session_factory: async_sessionmaker[AsyncSession],
) -> None:
    """Issue #54 / #69: ``_snapshot_initial_version`` must be safe to
    re-invoke when an active v=1 row already exists for the template.

    The old code did a naked ``INSERT version=1`` and blew up on the
    unique constraint when called twice. The fix is an ON CONFLICT
    upsert that returns the existing row. We exercise the upsert path
    directly so we do not have to subvert the DEFERRED active-version
    trigger (migration 0004) that makes the "no version row" state
    unrepresentable in committed data.
    """
    async with session_factory() as setup_session:
        fx = await _pick_basic_fixtures(setup_session)
        if fx is None:
            pytest.skip("Missing project/article/profile fixtures")
        project_id, article_id, profile_id = fx
        template_id = await _create_fresh_extraction_template(
            setup_session, project_id=project_id, profile_id=profile_id
        )

    try:
        async with session_factory() as svc_session:
            service = RunLifecycleService(svc_session)
            # First call: returns the existing seed row (created in
            # _create_fresh_extraction_template). No INSERT happens
            # because of the ON CONFLICT.
            v1 = await service._snapshot_initial_version(
                project_template_id=template_id, user_id=profile_id
            )
            # Second call from a fresh service must not crash on the
            # unique constraint and must return the SAME row.
            v2 = await service._snapshot_initial_version(
                project_template_id=template_id, user_id=profile_id
            )
            await svc_session.commit()
            assert v1.id == v2.id
            assert v1.version == 1
            assert v1.is_active is True

        async with session_factory() as verify:
            count = (
                await verify.execute(
                    text(
                        "SELECT COUNT(*) FROM public.extraction_template_versions "
                        "WHERE project_template_id = :tid"
                    ),
                    {"tid": str(template_id)},
                )
            ).scalar()
            assert count == 1
        # Use project_id / article_id to keep linters quiet about
        # unused fixture returns.
        assert project_id is not None and article_id is not None
    finally:
        async with session_factory() as cleanup:
            await _cleanup_template(cleanup, template_id)


@pytest.mark.asyncio
async def test_snapshot_initial_version_reactivates_existing_inactive_row(
    session_factory: async_sessionmaker[AsyncSession],
) -> None:
    """Issue #65: when v=1 exists with is_active=false the lookup misses
    it and the old code crashed with an IntegrityError on the
    (template_id, version) unique constraint. With the upsert fix the
    row is reactivated in place and create_run succeeds."""
    async with session_factory() as setup_session:
        fx = await _pick_basic_fixtures(setup_session)
        if fx is None:
            pytest.skip("Missing project/article/profile fixtures")
        project_id, article_id, profile_id = fx
        template_id = await _create_fresh_extraction_template(
            setup_session, project_id=project_id, profile_id=profile_id
        )

    try:
        # The deferred trigger forbids committing a template with no
        # active version, so we exercise the reactivation in a single
        # transaction: flip is_active=false, immediately re-snapshot,
        # then commit (the row is active again by COMMIT time).
        async with session_factory() as svc_session:
            await _set_version_inactive(svc_session, template_id)
            await svc_session.flush()
            v = await RunLifecycleService(svc_session)._snapshot_initial_version(
                project_template_id=template_id, user_id=profile_id
            )
            await svc_session.commit()
            assert v.version == 1
            assert v.is_active is True

        async with session_factory() as verify:
            row = (
                await verify.execute(
                    text(
                        "SELECT version, is_active FROM "
                        "public.extraction_template_versions "
                        "WHERE project_template_id = :tid"
                    ),
                    {"tid": str(template_id)},
                )
            ).first()
            assert row is not None
            assert row[0] == 1
            assert row[1] is True
        # Use article_id / project_id to keep linters quiet.
        assert article_id is not None and project_id is not None
    finally:
        async with session_factory() as cleanup:
            await _cleanup_template(cleanup, template_id)


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
        template_id = (
            await setup_session.execute(
                text(
                    "SELECT id FROM public.project_extraction_templates "
                    "WHERE kind = 'extraction' LIMIT 1"
                )
            )
        ).scalar()
        if template_id is None:
            pytest.skip("No extraction template available")
        run = await RunLifecycleService(setup_session).create_run(
            project_id=project_id,
            article_id=article_id,
            project_template_id=UUID(str(template_id)),
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
            # Race two identical advances PENDING → PROPOSAL. Without a
            # row lock both callers see stage=PENDING, both pass the
            # precondition, and both write stage=PROPOSAL silently
            # (the second succeeds even though it raced with the first).
            # With the FOR UPDATE lock, the second caller blocks until
            # the first commits, then wakes up to see stage=PROPOSAL —
            # PROPOSAL → PROPOSAL is not an allowed transition, so it
            # raises InvalidStageTransitionError instead of silently
            # overwriting.
            results = await asyncio.gather(
                _advance(s1, ExtractionRunStage.PROPOSAL),
                _advance(s2, ExtractionRunStage.PROPOSAL),
                return_exceptions=True,
            )
        successes = [r for r in results if isinstance(r, str)]
        invalid = [r for r in results if isinstance(r, InvalidStageTransitionError)]
        assert len(successes) == 1, results
        assert len(invalid) == 1, results
        assert successes[0] == ExtractionRunStage.PROPOSAL.value

        async with session_factory() as verify:
            stage = (
                await verify.execute(
                    text("SELECT stage FROM public.extraction_runs WHERE id = :rid"),
                    {"rid": str(run_id)},
                )
            ).scalar()
            assert stage == ExtractionRunStage.PROPOSAL.value
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
        template_id = (
            await setup_session.execute(
                text(
                    "SELECT id FROM public.project_extraction_templates "
                    "WHERE kind = 'extraction' LIMIT 1"
                )
            )
        ).scalar()
        if template_id is None:
            pytest.skip("No extraction template")
        run = await RunLifecycleService(setup_session).create_run(
            project_id=project_id,
            article_id=article_id,
            project_template_id=UUID(str(template_id)),
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
        child = await RunLifecycleService(session).reopen_run(run_id=parent_id, user_id=profile_id)
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
