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

from unittest.mock import MagicMock

import pytest
from httpx import AsyncClient
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

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
async def test_section_continuation_with_run_id_skips_the_retired_gate(
    client_as_manager: AsyncClient,
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """F2: retired entries block NEW runs only — a ``run_id`` continuation
    is not a new run. The enqueue-time 409 must not brick a valid pinned
    run: the worker honors the pin, and an unpinned run resolving retired
    mid-flight already classifies to the friendly ENGINE_RETIRED code."""
    run = await engine_setup.run_in_extract(db_session)
    await engine_setup.pin_run(db_session, run, "openai", "gpt-4o-mini")
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
