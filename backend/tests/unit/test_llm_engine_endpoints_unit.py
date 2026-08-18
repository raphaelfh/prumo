"""T3 — direct endpoint-coroutine unit tests for the llm-engine endpoints.

The ASGI transport's handler lines do not register on coverage (the
diff-cover blind spot), so the coroutines are called directly with the
service patched IN THE ENDPOINT MODULE'S NAMESPACE — mirrors
``test_run_write_endpoints_unit``. Both handlers are ``@limiter.limit``-
decorated; ``getattr(fn, "__wrapped__", fn)`` reaches the pristine
coroutine underneath.

The auth gates here are ``Depends(require_project_scope)`` /
``Depends(require_project_manager)`` — resolved by FastAPI, not called in
the handler body — so role enforcement is asserted in the integration
suite (outsider 403 / reviewer PUT 403 / manager PUT 200).
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import pytest
from fastapi import HTTPException

from app.api.v1.endpoints.llm_engine import get_llm_engine, set_llm_engine
from app.schemas.llm_engine import (
    LlmEngineAlternate,
    LlmEngineRead,
    LlmEngineStored,
    LlmEngineUpdateRequest,
)
from app.services.parser_settings_service import ProjectNotFoundError

_EP = "app.api.v1.endpoints.llm_engine"

_get = getattr(get_llm_engine, "__wrapped__", get_llm_engine)
_put = getattr(set_llm_engine, "__wrapped__", set_llm_engine)


def _read(provider: str = "openai", model: str = "gpt-4o-mini") -> LlmEngineRead:
    return LlmEngineRead(
        provider=provider,
        model=model,
        mode="fast",
        source="default",
        retired=False,
        catalog=[],
        availability={"openai": True, "anthropic": False},
    )


def _request() -> MagicMock:
    request = MagicMock()
    request.state.trace_id = "trace-llm-engine"
    return request


@pytest.mark.asyncio
async def test_get_returns_the_service_read_model_in_the_envelope() -> None:
    project_id, viewer = uuid4(), uuid4()
    data = _read()
    service = MagicMock()
    service.get_engine_read = AsyncMock(return_value=data)

    with patch(f"{_EP}.LlmEngineService", return_value=service):
        resp = await _get(
            project_id=project_id,
            request=_request(),
            db=AsyncMock(),
            viewer_id=viewer,
        )

    assert resp.ok is True
    assert resp.data is data
    assert resp.trace_id == "trace-llm-engine"
    service.get_engine_read.assert_awaited_once_with(project_id, viewer)


@pytest.mark.asyncio
async def test_get_maps_missing_project_to_404() -> None:
    service = MagicMock()
    service.get_engine_read = AsyncMock(side_effect=ProjectNotFoundError("Project x not found"))

    with (
        patch(f"{_EP}.LlmEngineService", return_value=service),
        pytest.raises(HTTPException) as exc_info,
    ):
        await _get(project_id=uuid4(), request=_request(), db=AsyncMock(), viewer_id=uuid4())

    assert exc_info.value.status_code == 404


@pytest.mark.asyncio
async def test_put_writes_named_fields_and_returns_the_fresh_read() -> None:
    """The service receives NAMED validated fields — ``updated_by`` from the
    auth dependency, never the body — and the response is the re-read view.
    ``endpoint_id`` (B8) rides the same named pass-through."""
    project_id, manager, endpoint_id = uuid4(), uuid4(), uuid4()
    data = _read(model="gpt-4o")
    service = MagicMock()
    service.set_for_project = AsyncMock(
        return_value=LlmEngineStored(provider="openai", model="gpt-4o")
    )
    service.get_engine_read = AsyncMock(return_value=data)
    db = AsyncMock()

    with patch(f"{_EP}.LlmEngineService", return_value=service):
        resp = await _put(
            project_id=project_id,
            body=LlmEngineUpdateRequest(
                provider="openai",
                model="gpt-4o",
                alternates=[LlmEngineAlternate(provider="anthropic", model="claude-sonnet-5")],
                endpoint_id=endpoint_id,
            ),
            request=_request(),
            db=db,
            manager_id=manager,
        )

    assert resp.ok is True
    assert resp.data is data
    service.set_for_project.assert_awaited_once_with(
        project_id=project_id,
        provider="openai",
        model="gpt-4o",
        mode="fast",
        updated_by=manager,
        alternates=[LlmEngineAlternate(provider="anthropic", model="claude-sonnet-5")],
        endpoint_id=endpoint_id,
    )
    db.commit.assert_awaited_once()


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("raised", "expected_status"),
    [
        (ValueError("Unknown engine"), 400),
        (ProjectNotFoundError("Project x not found"), 404),
    ],
    ids=["unknown-engine", "missing-project"],
)
async def test_put_maps_service_errors_to_status(raised: Exception, expected_status: int) -> None:
    service = MagicMock()
    service.set_for_project = AsyncMock(side_effect=raised)

    with (
        patch(f"{_EP}.LlmEngineService", return_value=service),
        pytest.raises(HTTPException) as exc_info,
    ):
        await _put(
            project_id=uuid4(),
            body=LlmEngineUpdateRequest(provider="openai", model="gpt-4o"),
            request=_request(),
            db=AsyncMock(),
            manager_id=uuid4(),
        )

    assert exc_info.value.status_code == expected_status


@pytest.mark.asyncio
async def test_put_maps_an_alternates_value_error_to_400() -> None:
    """The alternates write-gate ValueError rides the same 400 mapping —
    and the body's alternates actually reach the service call."""
    service = MagicMock()
    service.set_for_project = AsyncMock(
        side_effect=ValueError(
            "Unknown alternate engine openai:gpt-99 — not in the server catalogue"
        )
    )
    alternates = [LlmEngineAlternate(provider="openai", model="gpt-99")]

    with (
        patch(f"{_EP}.LlmEngineService", return_value=service),
        pytest.raises(HTTPException) as exc_info,
    ):
        await _put(
            project_id=uuid4(),
            body=LlmEngineUpdateRequest(provider="openai", model="gpt-4o", alternates=alternates),
            request=_request(),
            db=AsyncMock(),
            manager_id=uuid4(),
        )

    assert exc_info.value.status_code == 400
    assert "alternate engine" in exc_info.value.detail
    assert service.set_for_project.await_args.kwargs["alternates"] == alternates
