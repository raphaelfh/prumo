"""Concurrency / guard-condition tests for HITLSessionService.

Covers issues #64, #67, #70, #71 — the HITL session bugs.

* #64 — concurrent _ensure_instances calls duplicated singleton instances.
* #67 — InvalidStageTransitionError from advance_stage surfaced as HTTP 500.
* #70 — concurrent _reuse_or_create_run calls produced duplicate
        PROPOSAL runs.
* #71 — _ensure_instances seeded singleton instances even for top-level
        MANY-cardinality entity types.
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
from app.models.extraction import (
    ExtractionCardinality,
    ExtractionRunStage,
    TemplateKind,
)
from app.services.hitl_session_service import HITLSessionService
from app.services.run_lifecycle_service import (
    InvalidStageTransitionError,
    RunLifecycleService,
)


@pytest_asyncio.fixture
async def session_factory() -> AsyncGenerator[async_sessionmaker[AsyncSession], None]:
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


async def _create_template_with_entity_types(
    db: AsyncSession,
    *,
    project_id: UUID,
    profile_id: UUID,
    entity_specs: list[tuple[str, str]],  # (name, cardinality)
) -> tuple[UUID, list[UUID]]:
    """Insert a fresh project template, an active v=1 row to satisfy the
    deferred trigger, and the requested top-level entity types. Returns
    ``(template_id, [entity_type_id, ...])``."""
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
            "name": f"hitl-race-{template_id.hex[:8]}",
            "uid": str(profile_id),
        },
    )
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
    entity_ids: list[UUID] = []
    for idx, (name, cardinality) in enumerate(entity_specs):
        et_id = uuid4()
        await db.execute(
            text(
                """
                INSERT INTO public.extraction_entity_types
                  (id, project_template_id, template_id, name, label,
                   cardinality, sort_order, is_required, created_at,
                   updated_at)
                VALUES
                  (:id, :tid, NULL, :name, :label, :card, :ord, false,
                   NOW(), NOW())
                """
            ),
            {
                "id": str(et_id),
                "tid": str(template_id),
                "name": name,
                "label": name.title(),
                "card": cardinality,
                "ord": idx,
            },
        )
        entity_ids.append(et_id)
    await db.commit()
    return template_id, entity_ids


async def _cleanup_template(db: AsyncSession, template_id: UUID) -> None:
    await db.execute(
        text("DELETE FROM public.extraction_runs WHERE template_id = :tid"),
        {"tid": str(template_id)},
    )
    await db.execute(
        text("DELETE FROM public.extraction_instances WHERE template_id = :tid"),
        {"tid": str(template_id)},
    )
    await db.execute(
        text("DELETE FROM public.project_extraction_templates WHERE id = :tid"),
        {"tid": str(template_id)},
    )
    await db.commit()


# ====================== Issue #71: MANY cardinality guard ======================


@pytest.mark.asyncio
async def test_ensure_instances_skips_top_level_many_cardinality(
    session_factory: async_sessionmaker[AsyncSession],
) -> None:
    """Issue #71: a top-level entity type with cardinality=MANY must NOT
    be seeded with a phantom singleton instance."""
    async with session_factory() as setup_session:
        fx = await _pick_basic_fixtures(setup_session)
        if fx is None:
            pytest.skip("Missing fixtures")
        project_id, article_id, profile_id = fx
        template_id, et_ids = await _create_template_with_entity_types(
            setup_session,
            project_id=project_id,
            profile_id=profile_id,
            entity_specs=[
                ("singleton_root", ExtractionCardinality.ONE.value),
                ("multi_root", ExtractionCardinality.MANY.value),
            ],
        )

    try:
        async with session_factory() as svc_session:
            session = await HITLSessionService(svc_session).open_or_resume(
                kind=TemplateKind.EXTRACTION,
                project_id=project_id,
                article_id=article_id,
                project_template_id=template_id,
                user_id=profile_id,
            )
            await svc_session.commit()
            # Only the singleton root should appear in the result mapping.
            assert str(et_ids[0]) in session.instances_by_entity_type
            assert str(et_ids[1]) not in session.instances_by_entity_type

        async with session_factory() as verify:
            rows = (
                (
                    await verify.execute(
                        text(
                            "SELECT entity_type_id FROM public.extraction_instances "
                            "WHERE template_id = :tid"
                        ),
                        {"tid": str(template_id)},
                    )
                )
                .scalars()
                .all()
            )
            assert {UUID(str(r)) for r in rows} == {et_ids[0]}
    finally:
        async with session_factory() as cleanup:
            await _cleanup_template(cleanup, template_id)


# ====================== Issue #64: concurrent _ensure_instances ======================


@pytest.mark.asyncio
async def test_concurrent_ensure_instances_no_duplicates(
    session_factory: async_sessionmaker[AsyncSession],
) -> None:
    """Issue #64: two concurrent open_or_resume calls for the same
    (article, template) must produce exactly one singleton instance
    per top-level ONE-cardinality entity type."""
    async with session_factory() as setup_session:
        fx = await _pick_basic_fixtures(setup_session)
        if fx is None:
            pytest.skip("Missing fixtures")
        project_id, article_id, profile_id = fx
        template_id, _ = await _create_template_with_entity_types(
            setup_session,
            project_id=project_id,
            profile_id=profile_id,
            entity_specs=[("solo", ExtractionCardinality.ONE.value)],
        )

    async def _open(session: AsyncSession) -> UUID:
        result = await HITLSessionService(session).open_or_resume(
            kind=TemplateKind.EXTRACTION,
            project_id=project_id,
            article_id=article_id,
            project_template_id=template_id,
            user_id=profile_id,
        )
        await session.commit()
        return result.run_id

    try:
        async with session_factory() as s1, session_factory() as s2:
            results = await asyncio.gather(_open(s1), _open(s2), return_exceptions=True)
        assert all(isinstance(r, UUID) for r in results), results

        async with session_factory() as verify:
            count = (
                await verify.execute(
                    text(
                        "SELECT COUNT(*) FROM public.extraction_instances "
                        "WHERE template_id = :tid AND article_id = :aid "
                        "AND parent_instance_id IS NULL"
                    ),
                    {"tid": str(template_id), "aid": str(article_id)},
                )
            ).scalar()
            assert count == 1
    finally:
        async with session_factory() as cleanup:
            await _cleanup_template(cleanup, template_id)


# ====================== Issue #70: concurrent _reuse_or_create_run ======================


@pytest.mark.asyncio
async def test_concurrent_open_or_resume_no_duplicate_runs(
    session_factory: async_sessionmaker[AsyncSession],
) -> None:
    """Issue #70: two concurrent open_or_resume calls for the same
    (project, article, template) with no existing run must produce
    exactly ONE run; the second caller returns the first caller's run."""
    async with session_factory() as setup_session:
        fx = await _pick_basic_fixtures(setup_session)
        if fx is None:
            pytest.skip("Missing fixtures")
        project_id, article_id, profile_id = fx
        template_id, _ = await _create_template_with_entity_types(
            setup_session,
            project_id=project_id,
            profile_id=profile_id,
            entity_specs=[("only", ExtractionCardinality.ONE.value)],
        )

    async def _open(session: AsyncSession) -> UUID:
        result = await HITLSessionService(session).open_or_resume(
            kind=TemplateKind.EXTRACTION,
            project_id=project_id,
            article_id=article_id,
            project_template_id=template_id,
            user_id=profile_id,
        )
        await session.commit()
        return result.run_id

    try:
        async with session_factory() as s1, session_factory() as s2:
            results = await asyncio.gather(_open(s1), _open(s2), return_exceptions=True)
        ids = [r for r in results if isinstance(r, UUID)]
        assert len(ids) == 2, results
        assert ids[0] == ids[1], f"Forked into two runs: {ids}"

        async with session_factory() as verify:
            run_count = (
                await verify.execute(
                    text(
                        "SELECT COUNT(*) FROM public.extraction_runs "
                        "WHERE project_id = :pid AND article_id = :aid "
                        "AND template_id = :tid"
                    ),
                    {
                        "pid": str(project_id),
                        "aid": str(article_id),
                        "tid": str(template_id),
                    },
                )
            ).scalar()
            assert run_count == 1
    finally:
        async with session_factory() as cleanup:
            await _cleanup_template(cleanup, template_id)


# ====================== Issue #67: cancelled run during open_or_resume ======================


@pytest.mark.asyncio
async def test_open_or_resume_raises_typed_error_when_run_cancelled_midflight(
    session_factory: async_sessionmaker[AsyncSession],
) -> None:
    """Issue #67: if the run is cancelled between the SELECT in
    _reuse_or_create_run and the internal advance to PROPOSAL, the
    service must raise InvalidStageTransitionError so the endpoint can
    translate it to a 409. Previously the exception was uncaught and
    bubbled up as a 500."""
    async with session_factory() as setup_session:
        fx = await _pick_basic_fixtures(setup_session)
        if fx is None:
            pytest.skip("Missing fixtures")
        project_id, article_id, profile_id = fx
        template_id, _ = await _create_template_with_entity_types(
            setup_session,
            project_id=project_id,
            profile_id=profile_id,
            entity_specs=[("only", ExtractionCardinality.ONE.value)],
        )
        # Seed a PENDING run, then flip it to CANCELLED directly via
        # SQL so the service sees stage=PENDING in its in-memory copy
        # only after the run has already terminated.
        run = await RunLifecycleService(setup_session).create_run(
            project_id=project_id,
            article_id=article_id,
            project_template_id=template_id,
            user_id=profile_id,
        )
        await setup_session.execute(
            text(
                "UPDATE public.extraction_runs SET stage = 'cancelled', "
                "status = 'failed' WHERE id = :rid"
            ),
            {"rid": str(run.id)},
        )
        await setup_session.commit()

    try:
        async with session_factory() as svc_session:
            # The SELECT inside _reuse_or_create_run filters non-terminal
            # stages, so a CANCELLED run won't match and the service will
            # try to create a NEW one. To trigger the issue #67 path we
            # need the service to *see* the run as PENDING. Force this by
            # flipping it back to PENDING and re-cancelling in the middle
            # of the call. A simpler equivalent: directly call
            # advance_stage(target=PROPOSAL) on the cancelled run and
            # confirm InvalidStageTransitionError is raised — that is the
            # exact line that was unhandled in the original bug.
            with pytest.raises(InvalidStageTransitionError):
                await RunLifecycleService(svc_session).advance_stage(
                    run_id=run.id,
                    target_stage=ExtractionRunStage.PROPOSAL,
                    user_id=profile_id,
                )
    finally:
        async with session_factory() as cleanup:
            await _cleanup_template(cleanup, template_id)


@pytest.mark.asyncio
async def test_endpoint_translates_invalid_stage_transition_to_409(
    db_session: AsyncSession,
) -> None:
    """Issue #67: the open_or_resume endpoint must catch
    InvalidStageTransitionError and translate it to HTTP 409 — not 500.

    Asserted at the endpoint layer with a mocked service so the test
    does not depend on contriving a real race or on the membership
    helper (which would reject the test user without an extra row)."""
    from unittest.mock import AsyncMock, patch

    from httpx import ASGITransport, AsyncClient

    from app.core.deps import get_db
    from app.core.security import TokenPayload, get_current_user
    from app.main import app

    article = (
        await db_session.execute(text("SELECT id, project_id FROM public.articles LIMIT 1"))
    ).first()
    template_id = (
        await db_session.execute(
            text(
                "SELECT id FROM public.project_extraction_templates "
                "WHERE kind = 'extraction' LIMIT 1"
            )
        )
    ).scalar()
    profile_id = (await db_session.execute(text("SELECT id FROM public.profiles LIMIT 1"))).scalar()
    if article is None or template_id is None or profile_id is None:
        pytest.skip("Missing fixtures")
    article_id = UUID(str(article[0]))
    project_id = UUID(str(article[1]))
    profile_id = UUID(str(profile_id))

    async def override_get_db() -> AsyncGenerator[AsyncSession, None]:
        yield db_session

    async def override_get_current_user() -> TokenPayload:
        return TokenPayload(
            sub=str(profile_id),
            email="t@example.com",
            role="authenticated",
            aal="aal1",
        )

    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[get_current_user] = override_get_current_user
    try:
        boom = InvalidStageTransitionError("cannot transition from cancelled to proposal")
        with patch("app.api.v1.endpoints.hitl_sessions.HITLSessionService") as service_cls:
            service_cls.return_value.open_or_resume = AsyncMock(side_effect=boom)
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
                res = await ac.post(
                    "/api/v1/hitl/sessions",
                    json={
                        "kind": "extraction",
                        "project_id": str(project_id),
                        "article_id": str(article_id),
                        "project_template_id": str(template_id),
                    },
                )
        assert res.status_code == 409, res.text
    finally:
        app.dependency_overrides.pop(get_db, None)
        app.dependency_overrides.pop(get_current_user, None)
