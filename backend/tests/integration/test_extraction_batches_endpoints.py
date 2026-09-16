"""/api/v1/extraction/batches — G1–G5b at the edge; the queue is the only stub."""

from __future__ import annotations

from unittest.mock import MagicMock
from uuid import uuid4

import pytest
from httpx import AsyncClient
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.endpoints import extraction_batches as ep
from app.services.llm_engine_service import EngineRetiredError
from tests.integration.conftest import SEED
from tests.integration.helpers import engine_setup
from tests.integration.helpers.batch_fixtures import make_article

client_as_manager = engine_setup.client_as_manager
client_as_outsider = engine_setup.client_as_outsider

URL = "/api/v1/extraction/batches"


@pytest.fixture
def queue(monkeypatch: pytest.MonkeyPatch) -> MagicMock:
    task = MagicMock()
    monkeypatch.setattr(ep, "advance_extraction_batch", task)
    monkeypatch.setattr(ep, "_is_queue_available", lambda: True)

    async def engine(*_args, **_kwargs):  # noqa: ANN002, ANN003
        return MagicMock()

    monkeypatch.setattr(ep, "resolve_engine", engine)
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

    monkeypatch.setattr(ep, "resolve_engine", retired)
    before = await _batch_count(db_session)
    response = await client_as_manager.post(URL, json=_body([SEED.primary_article]))
    assert response.status_code == 409 and response.json()["error"]["code"] == "LLM_ENGINE_RETIRED"
    assert await _batch_count(db_session) == before


@pytest.mark.asyncio
async def test_queue_down_is_503_and_writes_nothing(
    client_as_manager: AsyncClient,
    db_session: AsyncSession,
    queue: MagicMock,  # noqa: ARG001
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(ep, "_is_queue_available", lambda: False)
    before = await _batch_count(db_session)
    response = await client_as_manager.post(URL, json=_body([SEED.primary_article]))
    assert response.status_code == 503
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
