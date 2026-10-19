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

The last block pins the service-level credential precheck every AI kickoff
runs before anything is queued (``engine_credentials.assert_engine_ready``):
no credential at any rung is a typed ``MISSING_API_KEY`` 409, an unusable
pinned connection is ``LLM_ENDPOINT_UNAVAILABLE``, and the check is
read-only (no decryption, no ``last_used_at`` write).
"""

from __future__ import annotations

from unittest.mock import MagicMock
from uuid import UUID

import pytest
from httpx import AsyncClient
from pydantic import SecretStr
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.schemas.llm_connection import ProjectConnectionCreateRequest, UserConnectionCreateRequest
from app.schemas.llm_target import LlmTarget
from app.services import engine_credentials, llm_connection_service
from app.services.engine_credentials import assert_engine_ready
from app.services.llm_connection_service import (
    ConnectionUnavailableError,
    LlmConnectionService,
    MissingCredentialError,
    owned_user_connection,
)
from app.services.llm_engine_service import resolve_engine
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


# --- service-level credential precheck (assert_engine_ready) ---------------

_PRECHECK = {"project_id": SEED.primary_project, "user_id": SEED.primary_profile}


async def _openai_project_engine(db: AsyncSession) -> None:
    await engine_setup.set_project_engine(db, "openai", "gpt-5.6-terra")


async def _user_openai_key(db: AsyncSession) -> UUID:
    read = await LlmConnectionService(db).create_user(
        user_id=SEED.primary_profile,
        payload=UserConnectionCreateRequest(
            provider="openai", label="precheck user key", api_key=SecretStr("sk-user")
        ),
    )
    return read.id


async def _project_openai_key(db: AsyncSession) -> UUID:
    read = await LlmConnectionService(db).create_project(
        project_id=SEED.primary_project,
        created_by=SEED.primary_profile,
        payload=ProjectConnectionCreateRequest(
            provider="openai", label="precheck shared key", api_key=SecretStr("sk-project")
        ),
    )
    return read.id


def _no_global_key(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(llm_connection_service, "global_key_for", lambda _p: None)


def _boom(*_a: object, **_k: object) -> None:
    raise AssertionError("the precheck must never decrypt a key")


@pytest.mark.asyncio
async def test_precheck_without_a_key_at_any_rung_is_missing_api_key_409(
    db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    await _openai_project_engine(db_session)
    _no_global_key(monkeypatch)
    with pytest.raises(MissingCredentialError) as caught:
        await assert_engine_ready(db_session, **_PRECHECK)
    assert caught.value.code == "MISSING_API_KEY"
    assert caught.value.status_code == 409


@pytest.mark.parametrize(
    "connection_id",
    ["foreign", "not-a-uuid"],
    ids=["foreign-connection", "malformed-connection-id"],
)
@pytest.mark.asyncio
async def test_precheck_on_an_unusable_pinned_connection_is_endpoint_unavailable(
    db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch, connection_id: str
) -> None:
    if connection_id == "foreign":
        foreign = await engine_setup.make_host_connection(
            db_session, user_id=SEED.reviewer_profile, label="precheck-foreign-host"
        )
        assert await owned_user_connection(db_session, foreign, SEED.primary_profile) is None
        connection_id = str(foreign)
    pinned = LlmTarget(
        provider="openai_compatible", model="endpoint-model-x", connection_id=connection_id
    )

    async def _pinned_engine(*_a: object, **_k: object) -> LlmTarget:
        return pinned

    monkeypatch.setattr(engine_credentials, "resolve_engine", _pinned_engine)
    with pytest.raises(ConnectionUnavailableError) as caught:
        await assert_engine_ready(db_session, **_PRECHECK)
    assert caught.value.code == "LLM_ENDPOINT_UNAVAILABLE"
    assert caught.value.status_code == 409


@pytest.mark.parametrize("rung", ["user", "project", "global"], ids=["user", "project", "global"])
@pytest.mark.asyncio
async def test_precheck_with_a_key_at_one_rung_returns_the_resolved_engine(
    db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch, rung: str
) -> None:
    await _openai_project_engine(db_session)
    _no_global_key(monkeypatch)
    if rung == "user":
        await _user_openai_key(db_session)
    elif rung == "project":
        await _project_openai_key(db_session)
    else:
        monkeypatch.setattr(llm_connection_service, "global_key_for", lambda _p: "sk-test")
    expected = await resolve_engine(db_session, SEED.primary_project, SEED.primary_profile)
    assert expected.provider == "openai"
    assert await assert_engine_ready(db_session, **_PRECHECK) == expected


@pytest.mark.asyncio
async def test_precheck_is_read_only(
    db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    await _openai_project_engine(db_session)
    _no_global_key(monkeypatch)
    connection_id = await _user_openai_key(db_session)
    row = await owned_user_connection(db_session, connection_id, SEED.primary_profile)
    assert row is not None
    before = row.last_used_at
    monkeypatch.setattr(llm_connection_service, "_fernet_for", _boom)

    await assert_engine_ready(db_session, **_PRECHECK)

    await db_session.flush()
    await db_session.refresh(row)
    assert row.last_used_at == before
