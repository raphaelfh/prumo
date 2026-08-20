"""B6 — direct endpoint-coroutine unit tests for the llm-endpoints routes.

Mirrors ``test_llm_engine_endpoints_unit``: the service is patched in the
ENDPOINT MODULE'S namespace and the pristine coroutine under the
``@limiter.limit`` wrapper is called directly (the ASGI diff-cover blind
spot). Auth is ``Depends(require_project_manager)`` on every route —
resolved by FastAPI, not in the handler body — so the role matrix lives
in the integration suite (``test_llm_endpoints_api``).

The 422 shape test builds the REAL FastAPI validation path through a
minimal app mounting the actual router (auth/db overridden): a rejected
create body must never echo ``api_key`` material — that is the SecretStr
guarantee the schema docstring promises.
"""

from __future__ import annotations

import inspect
from collections.abc import AsyncGenerator
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

import app.api.v1.endpoints.llm_endpoints as llm_endpoints_module
from app.api.deps.security import require_project_manager
from app.api.v1.endpoints.llm_endpoints import (
    create_llm_endpoint,
    delete_llm_endpoint,
    list_llm_endpoints,
    router,
    update_llm_endpoint,
    verify_llm_endpoint,
)
from app.core.deps import get_db
from app.core.net_guard import EndpointUrlError
from app.schemas.llm_endpoint import (
    LlmEndpointCapabilities,
    LlmEndpointCreateRequest,
    LlmEndpointDeleteResult,
    LlmEndpointProbeResult,
    LlmEndpointRead,
    LlmEndpointUpdateRequest,
)
from app.services.llm_endpoint_service import (
    EndpointNotFoundError,
    EndpointUnavailableError,
)

_EP = "app.api.v1.endpoints.llm_endpoints"

_list = getattr(list_llm_endpoints, "__wrapped__", list_llm_endpoints)
_create = getattr(create_llm_endpoint, "__wrapped__", create_llm_endpoint)
_update = getattr(update_llm_endpoint, "__wrapped__", update_llm_endpoint)
_delete = getattr(delete_llm_endpoint, "__wrapped__", delete_llm_endpoint)
_verify = getattr(verify_llm_endpoint, "__wrapped__", verify_llm_endpoint)


def _read() -> LlmEndpointRead:
    return LlmEndpointRead(
        id=uuid4(),
        label="Lab Ollama",
        base_url="https://llm.lab.example.com/v1",
        has_api_key=True,
        allowed_models=["llama3"],
        capabilities=LlmEndpointCapabilities(),
        validation_status="unverified",
        last_validated_at=None,
        created_by_name="Integration Primary",
    )


def _request() -> MagicMock:
    request = MagicMock()
    request.state.trace_id = "trace-llm-endpoints"
    return request


def _create_body() -> LlmEndpointCreateRequest:
    return LlmEndpointCreateRequest(label="Lab Ollama", base_url="https://llm.lab.example.com/v1")


def _update_body() -> LlmEndpointUpdateRequest:
    return LlmEndpointUpdateRequest(label="Lab Ollama", base_url="https://llm.lab.example.com/v1")


# ---------------------------------------------------------------------------
# Happy paths — service mocked, envelope + commit asserted
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_list_returns_the_service_reads_in_the_envelope() -> None:
    project_id, manager = uuid4(), uuid4()
    data = [_read()]
    service = MagicMock()
    service.list_for_project = AsyncMock(return_value=data)

    with patch(f"{_EP}.LlmEndpointService", return_value=service):
        resp = await _list(
            project_id=project_id, request=_request(), db=AsyncMock(), _manager=manager
        )

    assert resp.ok is True
    assert resp.data is data
    assert resp.trace_id == "trace-llm-endpoints"
    service.list_for_project.assert_awaited_once_with(project_id)


@pytest.mark.asyncio
async def test_create_returns_the_read_and_commits() -> None:
    project_id, manager = uuid4(), uuid4()
    data = _read()
    body = _create_body()
    service = MagicMock()
    service.create = AsyncMock(return_value=data)
    db = AsyncMock()

    with patch(f"{_EP}.LlmEndpointService", return_value=service):
        resp = await _create(
            project_id=project_id, body=body, request=_request(), db=db, manager_id=manager
        )

    assert resp.ok is True
    assert resp.data is data
    service.create.assert_awaited_once_with(project_id=project_id, created_by=manager, payload=body)
    db.commit.assert_awaited_once()


@pytest.mark.asyncio
async def test_update_returns_the_read_and_commits() -> None:
    project_id, endpoint_id, manager = uuid4(), uuid4(), uuid4()
    data = _read()
    body = _update_body()
    service = MagicMock()
    service.update = AsyncMock(return_value=data)
    db = AsyncMock()

    with patch(f"{_EP}.LlmEndpointService", return_value=service):
        resp = await _update(
            project_id=project_id,
            endpoint_id=endpoint_id,
            body=body,
            request=_request(),
            db=db,
            _manager=manager,
        )

    assert resp.ok is True
    assert resp.data is data
    service.update.assert_awaited_once_with(
        project_id=project_id, endpoint_id=endpoint_id, payload=body
    )
    db.commit.assert_awaited_once()


@pytest.mark.asyncio
async def test_delete_returns_the_typed_result_and_commits() -> None:
    """Decision 15: DELETE is a 200 with a typed envelope payload, never 204."""
    project_id, endpoint_id = uuid4(), uuid4()
    data = LlmEndpointDeleteResult(deleted=True, id=endpoint_id)
    service = MagicMock()
    service.delete = AsyncMock(return_value=data)
    db = AsyncMock()

    with patch(f"{_EP}.LlmEndpointService", return_value=service):
        resp = await _delete(
            project_id=project_id,
            endpoint_id=endpoint_id,
            request=_request(),
            db=db,
            _manager=uuid4(),
        )

    assert resp.ok is True
    assert resp.data is data
    service.delete.assert_awaited_once_with(project_id=project_id, endpoint_id=endpoint_id)
    db.commit.assert_awaited_once()


@pytest.mark.asyncio
async def test_verify_returns_the_probe_result_and_commits() -> None:
    """House pattern (llm_engine PUT): the route commits AFTER the service
    call so the persisted probe outcome survives the request."""
    project_id, endpoint_id = uuid4(), uuid4()
    data = LlmEndpointProbeResult(
        validation_status="ok", output_mode="tool", models_seen=["llama3"], error=None
    )
    service = MagicMock()
    service.verify = AsyncMock(return_value=data)
    db = AsyncMock()

    with patch(f"{_EP}.LlmEndpointService", return_value=service):
        resp = await _verify(
            project_id=project_id,
            endpoint_id=endpoint_id,
            request=_request(),
            db=db,
            _manager=uuid4(),
        )

    assert resp.ok is True
    assert resp.data is data
    service.verify.assert_awaited_once_with(project_id=project_id, endpoint_id=endpoint_id)
    db.commit.assert_awaited_once()


# ---------------------------------------------------------------------------
# Error mapping
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("raised", "expected_status"),
    [
        (EndpointUrlError("private_address: llm.lab.example.com"), 400),
        (ValueError("An endpoint labeled 'Lab Ollama' already exists in this project"), 400),
    ],
    ids=["ssrf-rejected", "duplicate-label"],
)
async def test_create_maps_value_errors_to_400(raised: Exception, expected_status: int) -> None:
    service = MagicMock()
    service.create = AsyncMock(side_effect=raised)
    db = AsyncMock()

    with (
        patch(f"{_EP}.LlmEndpointService", return_value=service),
        pytest.raises(HTTPException) as exc_info,
    ):
        await _create(
            project_id=uuid4(),
            body=_create_body(),
            request=_request(),
            db=db,
            manager_id=uuid4(),
        )

    assert exc_info.value.status_code == expected_status
    # str(e) is already sanitized — it IS the client message.
    assert exc_info.value.detail == str(raised)
    db.commit.assert_not_awaited()


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("raised", "expected_status"),
    [
        (EndpointNotFoundError("Endpoint x not found in project y"), 404),
        (EndpointUrlError("unresolvable: llm.lab.example.com"), 400),
        (ValueError("bad"), 400),
    ],
    ids=["cross-project-404", "ssrf-rejected", "value-error"],
)
async def test_update_maps_service_errors_to_status(
    raised: Exception, expected_status: int
) -> None:
    service = MagicMock()
    service.update = AsyncMock(side_effect=raised)

    with (
        patch(f"{_EP}.LlmEndpointService", return_value=service),
        pytest.raises(HTTPException) as exc_info,
    ):
        await _update(
            project_id=uuid4(),
            endpoint_id=uuid4(),
            body=_update_body(),
            request=_request(),
            db=AsyncMock(),
            _manager=uuid4(),
        )

    assert exc_info.value.status_code == expected_status


@pytest.mark.asyncio
async def test_delete_maps_not_found_to_404() -> None:
    service = MagicMock()
    service.delete = AsyncMock(side_effect=EndpointNotFoundError("Endpoint x not found"))

    with (
        patch(f"{_EP}.LlmEndpointService", return_value=service),
        pytest.raises(HTTPException) as exc_info,
    ):
        await _delete(
            project_id=uuid4(),
            endpoint_id=uuid4(),
            request=_request(),
            db=AsyncMock(),
            _manager=uuid4(),
        )

    assert exc_info.value.status_code == 404


@pytest.mark.asyncio
@pytest.mark.parametrize("route", ["delete", "verify"], ids=["delete", "verify"])
async def test_endpoint_unavailable_propagates_to_the_app_error_handler(route: str) -> None:
    """``EndpointUnavailableError`` is an ``AppError``: the route must NOT
    swallow it into an ``HTTPException`` — the registered handler serves the
    typed 409 envelope (the ``EngineRetiredError`` pattern). No commit."""
    raised = EndpointUnavailableError("Endpoint 'Lab Ollama' cannot be deleted")
    service = MagicMock()
    service.delete = AsyncMock(side_effect=raised)
    service.verify = AsyncMock(side_effect=raised)
    db = AsyncMock()

    with (
        patch(f"{_EP}.LlmEndpointService", return_value=service),
        pytest.raises(EndpointUnavailableError),
    ):
        handler = _delete if route == "delete" else _verify
        await handler(
            project_id=uuid4(),
            endpoint_id=uuid4(),
            request=_request(),
            db=db,
            _manager=uuid4(),
        )

    db.commit.assert_not_awaited()


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("raised", "expected_status"),
    [
        (EndpointNotFoundError("Endpoint x not found in project y"), 404),
        (EndpointUrlError("private_address: llm.lab.example.com"), 400),
    ],
    ids=["cross-project-404", "stored-url-revet-400"],
)
async def test_verify_maps_service_errors_to_status(
    raised: Exception, expected_status: int
) -> None:
    service = MagicMock()
    service.verify = AsyncMock(side_effect=raised)

    with (
        patch(f"{_EP}.LlmEndpointService", return_value=service),
        pytest.raises(HTTPException) as exc_info,
    ):
        await _verify(
            project_id=uuid4(),
            endpoint_id=uuid4(),
            request=_request(),
            db=AsyncMock(),
            _manager=uuid4(),
        )

    assert exc_info.value.status_code == expected_status


# ---------------------------------------------------------------------------
# Rate limits — every route carries its explicit decorator
# ---------------------------------------------------------------------------


def test_every_route_carries_its_explicit_limiter() -> None:
    source = inspect.getsource(llm_endpoints_module)
    assert source.count("@limiter.limit") == 5
    assert source.count('@limiter.limit("60/minute")') == 1  # list
    assert source.count('@limiter.limit("20/minute")') == 3  # create/update/delete
    assert source.count('@limiter.limit("30/minute")') == 1  # verify


# ---------------------------------------------------------------------------
# 422 shape — a rejected create body never echoes api_key material
# ---------------------------------------------------------------------------

_SECRET = "sk-super-secret-422-material"  # noqa: S105 — deliberate test canary


def _mini_app() -> FastAPI:
    """The REAL router behind overridden auth/db — reaches FastAPI's actual
    RequestValidationError path (raised before the handler body runs, so no
    limiter state and no DB are ever touched)."""
    app = FastAPI()
    app.include_router(router, prefix="/api/v1/projects")

    async def override_get_db() -> AsyncGenerator[Any, None]:
        yield AsyncMock()

    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[require_project_manager] = lambda: uuid4()
    return app


@pytest.mark.parametrize(
    "body",
    [
        {"label": "", "base_url": "https://ep.example.com/v1", "api_key": _SECRET},
        {
            "label": "ok",
            "base_url": "https://ep.example.com/v1",
            "api_key": _SECRET,
            "temperature": 0,  # extra="forbid"
        },
        {
            "label": "ok",
            "base_url": "https://ep.example.com/v1",
            "api_key": _SECRET,
            "allowed_models": "not-a-list",
        },
    ],
    ids=["empty-label", "smuggled-field", "bad-allowed-models"],
)
def test_invalid_create_body_422_never_echoes_api_key(body: dict[str, Any]) -> None:
    client = TestClient(_mini_app())

    r = client.post(f"/api/v1/projects/{uuid4()}/llm-endpoints", json=body)

    assert r.status_code == 422
    assert _SECRET not in r.text
