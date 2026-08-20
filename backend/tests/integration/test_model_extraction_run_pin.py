"""F4 — the engine the run EXECUTES and the engine it RECORDS must agree.

``ModelExtractionService.extract`` runs whatever engine its caller resolved,
so a run pinned to engine A could execute engine B while
``provenance.engine`` names A. This route closes that by resolving the
PROJECT engine — never the run's pin — and handing the service ``repin``:
it executes in-request and has no retry path into it, so every entry is a
human click, and a human click is entitled to the manager's current choice.

The write itself belongs to the service, the only layer that knows which run
was resolved (``run_id=None`` reuses the coordinate's live run). So these
tests assert the endpoint's half — what it resolves, what it keys for, and
that it asks for a re-pin. The write is pinned by ``freeze_engine``'s own
tests in ``test_run_engine_freeze.py``, end-to-end included.

The service is faked here (this is an endpoint-ordering contract, not an LLM
test); the run row and the project engine are real Postgres.
"""

from __future__ import annotations

from typing import Any

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

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
    """Record which provider the endpoint resolves credentials for (returns
    none). The seam is the B9 resolver's ``APIKeyService`` — the endpoint no
    longer builds one itself, it asks ``resolve_engine_credentials``."""
    asked: list[str] = []

    class _RecordingKeys:
        def __init__(self, _db: Any, _user_id: Any) -> None:
            pass

        async def get_key_for_provider(self, provider: str) -> None:
            asked.append(provider)
            return None

    from app.services import engine_credentials as ec

    monkeypatch.setattr(ec, "APIKeyService", _RecordingKeys)
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


@pytest.mark.asyncio
async def test_pinned_run_model_extraction_repins_to_the_project_engine(
    client_as_manager: AsyncClient,
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A manager flips the project engine after the run was pinned — model
    extraction on that run must execute (and key for) the manager's CURRENT
    pair, and rewrite the run's pin to match.

    Before the re-pin this endpoint served the stale pin forever: one live
    run per coordinate keeps a run alive for weeks, so the first model ever
    used on it outlived every later selection, and the popover chip claimed
    in the present tense to name the model extraction uses.
    """
    captured = _fake_service(monkeypatch)
    asked = _stub_key_service(monkeypatch)

    run = await engine_setup.run_in_extract(db_session)
    await engine_setup.pin_run(db_session, run, "openai", "gpt-4o-mini")
    await engine_setup.set_project_engine(db_session, "anthropic", "claude-sonnet-5")

    r = await client_as_manager.post("/api/v1/extraction/models", json=_payload(run_id=str(run.id)))
    assert r.status_code == 200, r.text

    engine = captured["extract"]["engine"]
    assert (engine.provider, engine.model) == ("anthropic", "claude-sonnet-5"), (
        f"the stale pin beat the manager's choice: {engine.provider}:{engine.model}"
    )
    # The key must follow the engine that will actually run — resolving it
    # for the old provider is a spurious MissingLLMKeyError plus a key_scope
    # recorded against a provider that never ran.
    assert asked == ["anthropic"], f"the key was resolved for the wrong provider: {asked}"
    # Resolving the new pair is only half the job: without this the service
    # would adopt the stale pin and run ``gpt-4o-mini`` anyway.
    assert captured["extract"]["repin"] is True, "the service was not asked to re-pin"


@pytest.mark.asyncio
async def test_unpinned_run_model_extraction_hands_over_the_resolved_pair(
    client_as_manager: AsyncClient,
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """An unpinned run resolves the project engine and hands it to the service
    with ``repin``, so the record is written before any LLM call runs on it.

    The endpoint deliberately does NOT write it here: it would take the run's
    row lock before the service has validated stage and template, and this
    route holds its transaction open across the whole extraction.
    """
    captured = _fake_service(monkeypatch)
    _stub_key_service(monkeypatch)

    run = await engine_setup.run_in_extract(db_session)
    await engine_setup.set_project_engine(db_session, "openai", "gpt-5.6-terra")

    r = await client_as_manager.post("/api/v1/extraction/models", json=_payload(run_id=str(run.id)))
    assert r.status_code == 200, r.text

    engine = captured["extract"]["engine"]
    assert (engine.provider, engine.model) == ("openai", "gpt-5.6-terra")
    assert captured["extract"]["repin"] is True

    await db_session.refresh(run)
    assert engine_setup.pinned_engine_of(run) == {}, (
        f"the endpoint wrote the pin the service owns: results={run.results}"
    )
