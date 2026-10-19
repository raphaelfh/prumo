"""/api/v1/extraction/batches — G1–G5b at the edge; the queue is the only stub."""

from __future__ import annotations

import asyncio
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import MagicMock
from uuid import UUID, uuid4

import pytest
from fastapi import HTTPException
from httpx import AsyncClient
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.endpoints import extraction_batches as ep
from app.main import app
from app.schemas.extraction_batch import CreateExtractionBatchRequest
from app.services import engine_credentials
from app.services.extraction_batch_service import ExtractionBatchService, QueueUnavailableError
from app.services.llm_connection_service import MissingCredentialError
from app.services.llm_engine_service import EngineRetiredError
from app.worker import queue_health
from app.worker.tasks import extraction_batch_tasks
from tests.integration.conftest import SEED
from tests.integration.helpers import engine_setup
from tests.integration.helpers.batch_fixtures import make_article

client_as_manager = engine_setup.client_as_manager
client_as_outsider = engine_setup.client_as_outsider

URL = "/api/v1/extraction/batches"


@pytest.fixture
def queue(monkeypatch: pytest.MonkeyPatch) -> MagicMock:
    task = MagicMock()
    monkeypatch.setattr(extraction_batch_tasks, "advance_extraction_batch", task)
    monkeypatch.setattr(queue_health, "is_queue_available", lambda: True)

    async def engine(*_args, **_kwargs):  # noqa: ANN002, ANN003
        return MagicMock()

    monkeypatch.setattr(engine_credentials, "assert_engine_ready", engine)
    return task


def _body(article_ids, **extra) -> dict:  # noqa: ANN001
    return {
        "project_id": str(SEED.primary_project),
        "template_id": str(SEED.primary_template),
        "article_ids": [str(a) for a in article_ids],
        **extra,
    }


async def _batch_count(db: AsyncSession) -> int:
    return (
        await db.execute(
            text("SELECT count(*) FROM public.extraction_batches WHERE owner_id=:o"),
            {"o": str(SEED.primary_profile)},
        )
    ).scalar_one()


@pytest.mark.asyncio
async def test_start_returns_202_detail_and_kicks_the_dispatcher(
    client_as_manager: AsyncClient, db_session: AsyncSession, queue: MagicMock
) -> None:
    a = await make_article(db_session, SEED.primary_project, "Alpha")
    response = await client_as_manager.post(URL, json=_body([a, a]))

    assert response.status_code == 202, response.text
    data = response.json()["data"]
    assert data["state"] == "active" and data["counts"]["total"] == 1
    assert data["items"][0]["title"] == "Alpha"
    queue.delay.assert_called_once_with(data["id"], False)


@pytest.mark.asyncio
async def test_non_member_is_refused_and_nothing_is_written(
    client_as_outsider: AsyncClient, db_session: AsyncSession, queue: MagicMock
) -> None:
    before = await _batch_count(db_session)
    response = await client_as_outsider.post(URL, json=_body([SEED.primary_article]))
    assert response.status_code == 403
    assert await _batch_count(db_session) == before
    queue.delay.assert_not_called()


@pytest.mark.asyncio
async def test_viewer_is_refused(
    client_as_outsider: AsyncClient,
    db_session: AsyncSession,
    queue: MagicMock,  # noqa: ARG001
) -> None:
    await db_session.execute(
        text(
            "INSERT INTO public.project_members (project_id, user_id, role) VALUES (:p, :u, 'viewer')"
        ),
        {"p": str(SEED.primary_project), "u": str(SEED.outsider_profile)},
    )
    response = await client_as_outsider.post(URL, json=_body([SEED.primary_article]))
    assert response.status_code == 403


@pytest.mark.asyncio
async def test_outsider_gets_403_before_the_engine_check(
    client_as_outsider: AsyncClient,
    queue: MagicMock,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Membership precedes the credential precheck: a non-member never sees
    the 409 that would reveal the project's engine configuration."""

    async def no_key(*_args, **_kwargs):  # noqa: ANN002, ANN003
        raise MissingCredentialError("openai")

    monkeypatch.setattr(engine_credentials, "assert_engine_ready", no_key)
    response = await client_as_outsider.post(URL, json=_body([SEED.primary_article]))
    assert response.status_code == 403, response.text
    queue.delay.assert_not_called()


@pytest.mark.asyncio
async def test_direct_start_refused_by_the_kickoff_gate_enqueues_nothing(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Direct coroutine call (ASGI-driven handler lines register no coverage)."""
    from starlette.requests import Request

    task = MagicMock()
    monkeypatch.setattr(extraction_batch_tasks, "advance_extraction_batch", task)

    async def refuse(*_args, **_kwargs):  # noqa: ANN002, ANN003
        raise HTTPException(status_code=403, detail="Reviewer role required")

    monkeypatch.setattr(ep, "ensure_project_reviewer", refuse)
    request = Request({"type": "http", "method": "POST", "path": "/", "headers": []})
    payload = ep.CreateExtractionBatchRequest(**_body([SEED.primary_article]))
    with pytest.raises(HTTPException) as exc:
        await ep.start_extraction_batch.__wrapped__(
            request, payload, SimpleNamespace(), SEED.primary_profile
        )
    assert exc.value.status_code == 403
    task.delay.assert_not_called()


@pytest.mark.asyncio
async def test_foreign_template_and_foreign_article_answer_the_same_400(
    client_as_manager: AsyncClient,
    db_session: AsyncSession,
    queue: MagicMock,  # noqa: ARG001
) -> None:
    foreign_article = await make_article(db_session, SEED.secondary_project)
    bad_template = await client_as_manager.post(
        URL, json={**_body([SEED.primary_article]), "template_id": str(uuid4())}
    )
    bad_article = await client_as_manager.post(
        URL, json=_body([SEED.primary_article, foreign_article])
    )
    assert bad_template.status_code == bad_article.status_code == 400
    assert bad_template.json()["error"] == bad_article.json()["error"]


@pytest.mark.asyncio
@pytest.mark.parametrize("count", [0, 101])
async def test_article_count_out_of_bounds_is_422(
    client_as_manager: AsyncClient,
    queue: MagicMock,  # noqa: ARG001
    count: int,
) -> None:
    response = await client_as_manager.post(URL, json=_body([uuid4() for _ in range(count)]))
    assert response.status_code == 422


@pytest.mark.asyncio
async def test_retired_engine_is_409_and_writes_nothing(
    client_as_manager: AsyncClient,
    db_session: AsyncSession,
    queue: MagicMock,  # noqa: ARG001
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def retired(*_args, **_kwargs):  # noqa: ANN002, ANN003
        raise EngineRetiredError("retired")

    monkeypatch.setattr(engine_credentials, "assert_engine_ready", retired)
    before = await _batch_count(db_session)
    response = await client_as_manager.post(URL, json=_body([SEED.primary_article]))
    assert response.status_code == 409 and response.json()["error"]["code"] == "LLM_ENGINE_RETIRED"
    assert await _batch_count(db_session) == before


@pytest.mark.asyncio
async def test_start_queue_down_is_503_and_writes_no_batch(
    client_as_manager: AsyncClient,
    db_session: AsyncSession,
    queue: MagicMock,  # noqa: ARG001
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(queue_health, "is_queue_available", lambda: False)
    before = await _batch_count(db_session)
    response = await client_as_manager.post(URL, json=_body([SEED.primary_article]))
    assert response.status_code == 503
    assert response.json()["error"]["code"] == "SERVICE_UNAVAILABLE"
    assert await _batch_count(db_session) == before


@pytest.mark.asyncio
async def test_second_batch_for_the_same_tool_is_409_with_the_active_id(
    client_as_manager: AsyncClient,
    db_session: AsyncSession,
    queue: MagicMock,  # noqa: ARG001
) -> None:
    a = await make_article(db_session, SEED.primary_project)
    first = (await client_as_manager.post(URL, json=_body([a]))).json()["data"]["id"]
    second = await client_as_manager.post(URL, json=_body([SEED.primary_article]))
    assert second.status_code == 409
    assert second.json()["error"]["code"] == "AI_BATCH_ALREADY_ACTIVE"
    assert second.json()["error"]["details"] == {"batch_id": first}


@pytest.mark.asyncio
async def test_list_detail_cancel_and_resume(
    client_as_manager: AsyncClient,
    client_as_outsider: AsyncClient,
    db_session: AsyncSession,
    queue: MagicMock,
) -> None:
    a = await make_article(db_session, SEED.primary_project)
    batch_id = (await client_as_manager.post(URL, json=_body([a]))).json()["data"]["id"]

    listed = await client_as_manager.get(
        URL, params={"project_id": str(SEED.primary_project), "active": "true"}
    )
    assert [b["id"] for b in listed.json()["data"]] == [batch_id]
    assert (await client_as_outsider.get(f"{URL}/{batch_id}")).status_code == 404
    assert (await client_as_manager.get(f"{URL}/{uuid4()}")).status_code == 404

    cancelled = await client_as_manager.post(f"{URL}/{batch_id}/cancel")
    assert cancelled.status_code == 200
    assert cancelled.json()["data"]["state"] == "cancelled"
    assert cancelled.json()["data"]["items"][0]["reason_code"] == "CANCELLED"

    queue.delay.reset_mock()
    resumed = await client_as_manager.post(f"{URL}/{batch_id}/resume")
    assert resumed.status_code == 200
    queue.delay.assert_called_once_with(batch_id, True)


def test_create_and_resume_declare_a_typed_response_model() -> None:
    """Pins the OpenAPI contract: create's 202 and resume's 200 must carry a
    real ``ApiResponse[ExtractionBatchDetail]`` schema, not ``{}``. Both
    routes return a bare ``JSONResponse`` (so the 202 status survives), which
    only works with a typed wire contract if ``response_model`` is declared
    explicitly alongside it — ``response_model=None`` would satisfy FastAPI
    but erase T from the generated OpenAPI schema.
    """
    from app.schemas.common import ApiResponse
    from app.schemas.extraction_batch import ExtractionBatchDetail

    expected = ApiResponse[ExtractionBatchDetail]
    routes = {
        (route.path, tuple(route.methods)): route  # type: ignore[attr-defined]
        for route in ep.router.routes
    }

    create_route = routes[("", ("POST",))]
    resume_route = routes[("/{batch_id}/resume", ("POST",))]
    assert create_route.response_model == expected
    assert resume_route.response_model == expected


_REAL_ASSERT_ENGINE_READY = engine_credentials.assert_engine_ready


def _request_for(article_ids) -> CreateExtractionBatchRequest:  # noqa: ANN001
    return CreateExtractionBatchRequest(**_body(article_ids))


async def _delete_batch(db: AsyncSession, batch_id: UUID) -> None:
    await db.execute(
        text("DELETE FROM public.extraction_batches WHERE id=:id"), {"id": str(batch_id)}
    )
    await db.commit()


@pytest.mark.asyncio
async def test_create_then_rollback_leaves_no_batch(db_session_real: AsyncSession) -> None:
    """Real-commit session: under the SAVEPOINT fixture a rollback discards
    committed rows too, so only this one proves ``create`` does not commit."""
    batch_id = await ExtractionBatchService(db_session_real).create(
        SEED.primary_profile, _request_for([SEED.primary_article])
    )
    await db_session_real.rollback()
    try:
        count = (
            await db_session_real.execute(
                text("SELECT count(*) FROM public.extraction_batches WHERE id=:id"),
                {"id": str(batch_id)},
            )
        ).scalar_one()
        assert count == 0
    finally:
        await _delete_batch(db_session_real, batch_id)


@pytest.mark.asyncio
async def test_cancel_then_rollback_leaves_batch_uncancelled(
    db_session_real: AsyncSession,
) -> None:
    service = ExtractionBatchService(db_session_real)
    batch_id = await service.create(SEED.primary_profile, _request_for([SEED.primary_article]))
    await db_session_real.commit()
    try:
        await service.cancel(SEED.primary_profile, batch_id, now=datetime.now(UTC))
        await db_session_real.rollback()

        cancelled_at = (
            await db_session_real.execute(
                text("SELECT cancelled_at FROM public.extraction_batches WHERE id=:id"),
                {"id": str(batch_id)},
            )
        ).scalar_one()
        statuses = (
            (
                await db_session_real.execute(
                    text("SELECT status FROM public.extraction_batch_items WHERE batch_id=:id"),
                    {"id": str(batch_id)},
                )
            )
            .scalars()
            .all()
        )
        assert cancelled_at is None
        assert statuses == ["queued"]
    finally:
        await _delete_batch(db_session_real, batch_id)


@pytest.mark.asyncio
async def test_start_missing_key_is_409_and_writes_no_batch(
    client_as_manager: AsyncClient,
    db_session: AsyncSession,
    queue: MagicMock,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def no_credential(_db, *, providers, **_kwargs):  # noqa: ANN001, ANN003
        return dict.fromkeys(providers)

    monkeypatch.setattr(engine_credentials, "assert_engine_ready", _REAL_ASSERT_ENGINE_READY)
    monkeypatch.setattr(engine_credentials, "availability_map", no_credential)
    before = await _batch_count(db_session)
    response = await client_as_manager.post(URL, json=_body([SEED.primary_article]))
    assert response.status_code == 409, response.text
    assert response.json()["error"]["code"] == "MISSING_API_KEY"
    assert await _batch_count(db_session) == before
    queue.delay.assert_not_called()


@pytest.mark.asyncio
async def test_kick_sees_the_committed_batch(
    db_session_real: AsyncSession,
    queue: MagicMock,  # noqa: ARG001
    monkeypatch: pytest.MonkeyPatch,
    _engine,  # noqa: ANN001
) -> None:
    """The dispatcher runs on another connection: the row must be committed
    before the kick, or the first advance finds nothing to do."""
    seen: list[int] = []

    async def read_on_a_new_connection(batch_id: UUID) -> int:
        async with _engine.connect() as conn:
            return (
                await conn.execute(
                    text("SELECT count(*) FROM public.extraction_batches WHERE id=:id"),
                    {"id": str(batch_id)},
                )
            ).scalar_one()

    def kick(batch_id: UUID, *, reenqueue_stale: bool = False) -> None:  # noqa: ARG001
        with ThreadPoolExecutor(max_workers=1) as pool:
            seen.append(pool.submit(asyncio.run, read_on_a_new_connection(batch_id)).result())

    monkeypatch.setattr(ep, "kick_batch", kick)
    batch_id = None
    try:
        async with engine_setup.client_as(str(SEED.primary_profile), db_session_real) as client:
            response = await client.post(URL, json=_body([SEED.primary_article]))
        assert response.status_code == 202, response.text
        batch_id = response.json()["data"]["id"]
        assert seen == [1]
    finally:
        app.dependency_overrides.clear()
        if batch_id is not None:
            await _delete_batch(db_session_real, UUID(batch_id))


@pytest.mark.asyncio
async def test_service_start_checks_engine_then_queue_then_creates(
    db_session: AsyncSession,
    queue: MagicMock,  # noqa: ARG001
) -> None:
    a = await make_article(db_session, SEED.primary_project)
    started = await ExtractionBatchService(db_session).start(
        SEED.primary_profile, _request_for([a])
    )
    assert started.replayed is False
    batch_id = started.batch_id
    count = (
        await db_session.execute(
            text("SELECT count(*) FROM public.extraction_batch_items WHERE batch_id=:id"),
            {"id": str(batch_id)},
        )
    ).scalar_one()
    assert count == 1


@pytest.mark.asyncio
async def test_service_start_refuses_a_down_queue_before_writing(
    db_session: AsyncSession,
    queue: MagicMock,  # noqa: ARG001
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(queue_health, "is_queue_available", lambda: False)
    before = await _batch_count(db_session)
    with pytest.raises(QueueUnavailableError):
        await ExtractionBatchService(db_session).start(
            SEED.primary_profile, _request_for([SEED.primary_article])
        )
    assert await _batch_count(db_session) == before
