"""T4 — retired-engine gate at the run kickoff endpoints (C1b).

A project whose stored engine left the catalogue must refuse NEW extraction
kickoffs with a typed 409 (``error.code == "LLM_ENGINE_RETIRED"``) — never
the hardcoded ``HTTP_ERROR`` of a bare HTTPException — and auth must
precede engine work: an outsider on the same project gets 403, not 409
(a 409 would leak project configuration to a non-member).

The retired state is produced by a raw JSONB bypass-write (the PostgREST
hole the read-side validation contains), so the gate is exercised end to
end: stored pair → catalogue miss → EngineRetiredError → AppError handler.
"""

from __future__ import annotations

from collections.abc import AsyncGenerator
from unittest.mock import MagicMock

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_db, get_supabase
from app.core.security import TokenPayload, get_current_user
from app.main import app
from app.models.extraction import ExtractionRun, ExtractionRunStage
from app.repositories import ExtractionRunRepository
from app.schemas.llm_target import LlmTarget
from app.services.run_lifecycle_service import RunLifecycleService
from tests.integration.conftest import SEED


def _make_token(profile_id: str) -> TokenPayload:
    return TokenPayload(
        sub=profile_id,
        email=f"{profile_id}@integration-test.prumo.local",
        role="authenticated",
        aal="aal1",
    )


def _client_as(profile_id: str, db_session: AsyncSession) -> AsyncClient:
    from unittest.mock import MagicMock

    async def override_get_db() -> AsyncGenerator[AsyncSession, None]:
        yield db_session

    async def override_get_current_user() -> TokenPayload:
        return _make_token(profile_id)

    def override_get_supabase() -> MagicMock:
        return MagicMock()

    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[get_current_user] = override_get_current_user
    app.dependency_overrides[get_supabase] = override_get_supabase
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


@pytest_asyncio.fixture
async def client_as_manager(db_session: AsyncSession) -> AsyncGenerator[AsyncClient, None]:
    try:
        async with _client_as(str(SEED.primary_profile), db_session) as ac:
            yield ac
    finally:
        app.dependency_overrides.clear()


@pytest_asyncio.fixture
async def client_as_outsider(db_session: AsyncSession) -> AsyncGenerator[AsyncClient, None]:
    try:
        async with _client_as(str(SEED.outsider_profile), db_session) as ac:
            yield ac
    finally:
        app.dependency_overrides.clear()


async def _retire_project_engine(db: AsyncSession) -> None:
    """Bypass-write a pair the catalogue never listed → resolved as retired."""
    await db.execute(
        text(
            "UPDATE public.projects "
            "SET settings = COALESCE(settings, '{}'::jsonb) "
            '|| CAST(\'{"llm_engine": {"provider": "openai", '
            '"model": "gpt-long-gone"}}\' AS jsonb) '
            "WHERE id = :pid"
        ),
        {"pid": str(SEED.primary_project)},
    )


def _section_payload() -> dict:
    return {
        "projectId": str(SEED.primary_project),
        "articleId": str(SEED.primary_article),
        "templateId": str(SEED.primary_template),
        "entityTypeId": str(SEED.primary_entity_type),
    }


def _models_payload() -> dict:
    return {
        "projectId": str(SEED.primary_project),
        "articleId": str(SEED.primary_article),
        "templateId": str(SEED.primary_template),
    }


@pytest.mark.asyncio
async def test_section_kickoff_on_retired_engine_is_typed_409(
    client_as_manager: AsyncClient,
    db_session: AsyncSession,
) -> None:
    await _retire_project_engine(db_session)
    r = await client_as_manager.post("/api/v1/extraction/sections", json=_section_payload())
    assert r.status_code == 409, r.text
    body = r.json()
    assert body["ok"] is False
    assert body["error"]["code"] == "LLM_ENGINE_RETIRED"


@pytest.mark.asyncio
async def test_models_kickoff_on_retired_engine_is_typed_409(
    client_as_manager: AsyncClient,
    db_session: AsyncSession,
) -> None:
    await _retire_project_engine(db_session)
    r = await client_as_manager.post("/api/v1/extraction/models", json=_models_payload())
    assert r.status_code == 409, r.text
    body = r.json()
    assert body["ok"] is False
    assert body["error"]["code"] == "LLM_ENGINE_RETIRED"


@pytest.mark.asyncio
async def test_outsider_on_retired_project_gets_403_not_409(
    client_as_outsider: AsyncClient,
    db_session: AsyncSession,
) -> None:
    """Auth precedes engine work — the retired 409 must not leak to
    non-members."""
    await _retire_project_engine(db_session)
    r = await client_as_outsider.post("/api/v1/extraction/sections", json=_section_payload())
    assert r.status_code == 403, r.text
    r2 = await client_as_outsider.post("/api/v1/extraction/models", json=_models_payload())
    assert r2.status_code == 403, r2.text


async def _pinned_run_in_extract(db: AsyncSession) -> ExtractionRun:
    """A fresh run at the seeded coordinate, in EXTRACT, pinned to a pair."""
    await db.execute(
        text(
            "DELETE FROM public.extraction_runs WHERE project_id = :pid "
            "AND article_id = :aid AND template_id = :tid"
        ),
        {
            "pid": str(SEED.primary_project),
            "aid": str(SEED.primary_article),
            "tid": str(SEED.primary_template),
        },
    )
    lifecycle = RunLifecycleService(db)
    run = await lifecycle.create_run(
        project_id=SEED.primary_project,
        article_id=SEED.primary_article,
        project_template_id=SEED.primary_template,
        user_id=SEED.primary_profile,
    )
    run = await lifecycle.advance_stage(
        run_id=run.id,
        target_stage=ExtractionRunStage.EXTRACT,
        user_id=SEED.primary_profile,
    )
    await ExtractionRunRepository(db).freeze_engine(
        run.id, LlmTarget(provider="openai", model="gpt-4o-mini").model_dump()
    )
    await db.flush()
    return run


@pytest.mark.asyncio
async def test_section_continuation_with_run_id_skips_the_retired_gate(
    client_as_manager: AsyncClient,
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """F2: retired entries block NEW runs only — a ``run_id`` continuation
    is not a new run. The enqueue-time 409 must not brick a valid pinned
    run: the worker honors the pin, and an unpinned run resolving retired
    mid-flight already classifies to the friendly ENGINE_RETIRED code."""
    run = await _pinned_run_in_extract(db_session)
    await _retire_project_engine(db_session)

    # Queue seams stubbed: the policy under test is the enqueue gate, not
    # Redis/Celery transport.
    from app.api.v1.endpoints import section_extraction as se

    monkeypatch.setattr(se, "_is_queue_available", lambda: True)
    fake_task = MagicMock()
    fake_task.id = "job-f2-continuation"
    monkeypatch.setattr(
        se, "run_section_extraction_task", MagicMock(delay=MagicMock(return_value=fake_task))
    )

    payload = {**_section_payload(), "runId": str(run.id)}
    r = await client_as_manager.post("/api/v1/extraction/sections", json=payload)
    assert r.status_code == 202, r.text
    assert r.json()["ok"] is True
