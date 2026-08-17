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

from typing import Any

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.extraction import ExtractionRun
from app.services.model_extraction_service import ModelExtractionResult
from tests.integration.conftest import SEED
from tests.integration.helpers import engine_setup

client_as_manager = engine_setup.client_as_manager


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

    run = await engine_setup.run_in_extract(db_session)
    await engine_setup.pin_run(db_session, run, "openai", "gpt-4o-mini")
    await engine_setup.set_project_engine(db_session, "anthropic", "claude-sonnet-4-5")

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

    run = await engine_setup.run_in_extract(db_session)
    await engine_setup.set_project_engine(db_session, "openai", "gpt-4o")

    r = await client_as_manager.post("/api/v1/extraction/models", json=_payload(run_id=str(run.id)))
    assert r.status_code == 200, r.text

    engine = captured["extract"]["engine"]
    assert (engine.provider, engine.model) == ("openai", "gpt-4o")

    await db_session.refresh(run)
    pinned = _pinned_engine_of(run)
    assert (pinned.get("provider"), pinned.get("model")) == ("openai", "gpt-4o"), (
        f"the resolved pair was not frozen onto the run: results={run.results}"
    )
