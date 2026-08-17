"""F4 — model extraction must honor the run's pinned engine (C1b).

``ModelExtractionService.extract`` runs whatever engine its caller resolved,
so a run pinned to engine A could execute engine B while
``provenance.engine`` names A. The endpoint must read the run's pin FIRST
(before the project resolve — which could even 409 a retired pair the run
is legitimately pinned to) and, for an unpinned run, freeze the resolved
pair so the record exists before any LLM call.

The service itself is faked (this is an endpoint-ordering contract, not an
LLM test); the run row, the pin write and the freeze are real Postgres.
"""

from __future__ import annotations

from collections.abc import AsyncGenerator
from typing import Any
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
from app.services.llm_engine_service import LlmEngineService
from app.services.model_extraction_service import ModelExtractionResult
from app.services.run_lifecycle_service import RunLifecycleService
from tests.integration.conftest import SEED


def _client_as(profile_id: str, db_session: AsyncSession) -> AsyncClient:
    async def override_get_db() -> AsyncGenerator[AsyncSession, None]:
        yield db_session

    async def override_get_current_user() -> TokenPayload:
        return TokenPayload(
            sub=profile_id,
            email=f"{profile_id}@integration-test.prumo.local",
            role="authenticated",
            aal="aal1",
        )

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


async def _run_in_extract(db: AsyncSession) -> ExtractionRun:
    """A fresh run at the seeded coordinate, advanced to EXTRACT."""
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
    await db.flush()
    return run


async def _set_project_engine(db: AsyncSession, provider: str, model: str) -> None:
    await LlmEngineService(db).set_for_project(
        project_id=SEED.primary_project,
        provider=provider,
        model=model,
        mode="fast",
        updated_by=SEED.primary_profile,
    )


def _fake_service(monkeypatch: pytest.MonkeyPatch) -> dict[str, Any]:
    """Replace the endpoint's ModelExtractionService with a capture shim."""
    captured: dict[str, Any] = {}

    class _FakeModelExtractionService:
        def __init__(self, **kwargs: Any) -> None:
            captured["ctor"] = kwargs

        async def extract(self, **kwargs: Any) -> ModelExtractionResult:
            captured["extract"] = kwargs
            return ModelExtractionResult(
                extraction_run_id=str(kwargs.get("run_id")),
                models_created=[],
                total_models=0,
                child_instances_created=0,
                tokens_prompt=0,
                tokens_completion=0,
                tokens_total=0,
                duration_ms=1.0,
            )

    from app.api.v1.endpoints import model_extraction as me

    monkeypatch.setattr(me, "ModelExtractionService", _FakeModelExtractionService)
    return captured


def _stub_key_service(monkeypatch: pytest.MonkeyPatch) -> list[str]:
    """Record which provider the endpoint keys for (returns no key)."""
    asked: list[str] = []

    class _RecordingKeys:
        def __init__(self, db: Any, user_id: Any) -> None:
            pass

        async def get_key_for_provider(self, provider: str) -> None:
            asked.append(provider)
            return None

    from app.api.v1.endpoints import model_extraction as me

    monkeypatch.setattr(me, "APIKeyService", _RecordingKeys)
    return asked


def _payload(run_id: str | None = None) -> dict[str, Any]:
    body: dict[str, Any] = {
        "projectId": str(SEED.primary_project),
        "articleId": str(SEED.primary_article),
        "templateId": str(SEED.primary_template),
    }
    if run_id is not None:
        body["runId"] = run_id
    return body


def _pinned_engine_of(run: ExtractionRun) -> dict[str, Any]:
    provenance = (run.results or {}).get("provenance") or {}
    return provenance.get("engine") or {}


@pytest.mark.asyncio
async def test_pinned_run_model_extraction_uses_the_pinned_pair(
    client_as_manager: AsyncClient,
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A manager flips the project engine after the run was pinned — model
    extraction on that run must execute (and key for) the PINNED pair, not
    the flipped project engine ``provenance.engine`` does not name."""
    captured = _fake_service(monkeypatch)
    asked = _stub_key_service(monkeypatch)

    run = await _run_in_extract(db_session)
    await ExtractionRunRepository(db_session).freeze_engine(
        run.id, LlmTarget(provider="openai", model="gpt-4o-mini").model_dump()
    )
    await _set_project_engine(db_session, "anthropic", "claude-sonnet-4-5")

    r = await client_as_manager.post("/api/v1/extraction/models", json=_payload(run_id=str(run.id)))
    assert r.status_code == 200, r.text

    engine = captured["extract"]["engine"]
    assert (engine.provider, engine.model) == ("openai", "gpt-4o-mini"), (
        f"the pinned pair did not win: {engine.provider}:{engine.model}"
    )
    assert asked == ["openai"], f"the key was resolved for the wrong provider: {asked}"


@pytest.mark.asyncio
async def test_unpinned_run_model_extraction_freezes_the_resolved_pair(
    client_as_manager: AsyncClient,
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """An unpinned run resolves the project engine AND freezes it onto the
    run, so the engine record exists before any LLM call runs on it."""
    captured = _fake_service(monkeypatch)
    _stub_key_service(monkeypatch)

    run = await _run_in_extract(db_session)
    await _set_project_engine(db_session, "openai", "gpt-4o")

    r = await client_as_manager.post("/api/v1/extraction/models", json=_payload(run_id=str(run.id)))
    assert r.status_code == 200, r.text

    engine = captured["extract"]["engine"]
    assert (engine.provider, engine.model) == ("openai", "gpt-4o")

    await db_session.refresh(run)
    pinned = _pinned_engine_of(run)
    assert (pinned.get("provider"), pinned.get("model")) == ("openai", "gpt-4o"), (
        f"the resolved pair was not frozen onto the run: results={run.results}"
    )
