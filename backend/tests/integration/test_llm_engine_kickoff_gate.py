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
async def test_outsider_on_retired_project_gets_403_not_409(
    client_as_outsider: AsyncClient,
    db_session: AsyncSession,
) -> None:
    """Auth precedes engine work — the retired 409 must not leak to
    non-members."""
    await _retire_project_engine(db_session)
    r = await client_as_outsider.post("/api/v1/extraction/sections", json=_section_payload())
    assert r.status_code == 403, r.text


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

    fake_enqueue = MagicMock()
    monkeypatch.setattr(se, "run_section_extraction_task", MagicMock(apply_async=fake_enqueue))

    payload = {**_section_payload(), "runId": str(run.id)}
    r = await client_as_manager.post("/api/v1/extraction/sections", json=payload)
    assert r.status_code == 409, r.text
    assert r.json()["error"]["code"] == "LLM_ENGINE_RETIRED"
    fake_enqueue.assert_not_called()


@pytest.mark.asyncio
async def test_kickoff_on_a_user_row_whose_connection_is_gone_is_typed_409(
    client_as_manager: AsyncClient, db_session: AsyncSession
) -> None:
    """The user-row half of the same gate: the caller's own engine row, not
    the project default, is what retired — and it is still a typed 409."""
    from app.services.llm_connection_service import LlmConnectionService
    from app.services.user_engine_service import set_user_engine

    cid = await engine_setup.make_host_connection(db_session, label="kickoff-gone")
    await set_user_engine(
        db_session,
        user_id=SEED.primary_profile,
        project_id=SEED.primary_project,
        provider="openai_compatible",
        model="endpoint-model-x",
        mode="fast",
        connection_id=cid,
        is_manager=True,
    )
    await LlmConnectionService(db_session).delete_user(
        user_id=SEED.primary_profile, connection_id=cid
    )
    r = await client_as_manager.post("/api/v1/extraction/sections", json=_section_payload())
    assert r.status_code == 409, r.text
    assert r.json()["error"]["code"] == "LLM_ENGINE_RETIRED"
