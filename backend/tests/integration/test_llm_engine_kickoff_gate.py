"""T4 — retired-engine gate at the run kickoff endpoints (C1b).

A project whose stored engine left the catalogue must refuse NEW extraction
kickoffs with a typed 409 (``error.code == "LLM_ENGINE_RETIRED"``) — never
the hardcoded ``HTTP_ERROR`` of a bare HTTPException — and auth must
precede engine work: an outsider on the same project gets 403, not 409
(a 409 would leak project configuration to a non-member).

The retired state is produced by a raw JSONB bypass-write (the PostgREST
hole the read-side validation contains), so the gate is exercised end to
end: stored pair → catalogue miss → EngineRetiredError → AppError handler.

The models route is also the surface for the other typed kickoff refusal,
``MISSING_ENTITY_KEY`` (a keyless repeating group): the last test pins its
409 envelope for a member; the outsider case above already proves scope
runs before any service call.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import pytest
from httpx import AsyncClient
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.endpoints import model_extraction as me
from app.services.entity_key import MissingEntityKeyError
from tests.integration.conftest import SEED
from tests.integration.helpers import engine_setup

client_as_manager = engine_setup.client_as_manager
client_as_outsider = engine_setup.client_as_outsider


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


@pytest.mark.asyncio
async def test_kickoff_on_dangling_endpoint_engine_is_typed_409(
    client_as_manager: AsyncClient,
    db_session: AsyncSession,
) -> None:
    """B8 rule 6: the stored engine points at an endpoint whose row was
    deleted (raw SQL — the service delete guard would have refused) — a NEW
    kickoff gets the typed 409 ``LLM_ENDPOINT_UNAVAILABLE``, never a 500."""
    endpoint_id = await engine_setup.make_endpoint(db_session, label="kickoff-dangling")
    await engine_setup.set_project_engine(
        db_session, "openai_compatible", "endpoint-model-x", endpoint_id=endpoint_id
    )
    await db_session.execute(
        text("DELETE FROM public.project_llm_endpoints WHERE id = :eid"),
        {"eid": str(endpoint_id)},
    )

    r = await client_as_manager.post("/api/v1/extraction/sections", json=_section_payload())
    assert r.status_code == 409, r.text
    body = r.json()
    assert body["ok"] is False
    assert body["error"]["code"] == "LLM_ENDPOINT_UNAVAILABLE"

    r2 = await client_as_manager.post("/api/v1/extraction/models", json=_models_payload())
    assert r2.status_code == 409, r2.text
    assert r2.json()["error"]["code"] == "LLM_ENDPOINT_UNAVAILABLE"


@pytest.mark.asyncio
async def test_section_continuation_with_run_id_is_gated_too(
    client_as_manager: AsyncClient,
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A retired engine blocks a ``run_id`` continuation as well as a new run.

    The gate used to skip continuations, because a pinned run was entitled
    to its pin and this 409 could never be cleared. Neither half survives
    re-pinning: attempt 0 of every kickoff resolves the PROJECT engine, so a
    continuation on a retired pair has nothing valid to run, and picking a
    live model clears the 409. Failing fast here beats queuing a job that
    dies in the worker with the same diagnosis.
    """
    run = await engine_setup.run_in_extract(db_session)
    await engine_setup.pin_run(db_session, run, "openai", "gpt-4o-mini")
    await _retire_project_engine(db_session)

    # Only the task seam is stubbed: the gate raises before the queue check,
    # so the task must never be enqueued at all.
    from app.api.v1.endpoints import section_extraction as se

    fake_delay = MagicMock()
    monkeypatch.setattr(se, "run_section_extraction_task", MagicMock(delay=fake_delay))

    payload = {**_section_payload(), "runId": str(run.id)}
    r = await client_as_manager.post("/api/v1/extraction/sections", json=payload)
    assert r.status_code == 409, r.text
    assert r.json()["error"]["code"] == "LLM_ENGINE_RETIRED"
    fake_delay.assert_not_called()


def _keyless_service() -> MagicMock:
    """A service whose kickoff refuses the way a keyless container does; the
    refusal itself is pinned by the entry-group pipeline tests — this test
    pins the ROUTE, the registered handler and the envelope shape."""
    service = MagicMock()
    service.extract = AsyncMock(side_effect=MissingEntityKeyError(uuid4(), "Prediction models"))
    return service


@pytest.mark.asyncio
async def test_models_kickoff_on_keyless_group_is_typed_409(
    client_as_manager: AsyncClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(me, "ModelExtractionService", MagicMock(return_value=_keyless_service()))
    r = await client_as_manager.post("/api/v1/extraction/models", json=_models_payload())
    assert r.status_code == 409, r.text
    body = r.json()
    assert body["ok"] is False
    assert body["error"]["code"] == "MISSING_ENTITY_KEY"
    assert "'Prediction models'" in body["error"]["message"]
