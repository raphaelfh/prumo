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

from app.api.v1.endpoints.llm_engine import (
    clear_my_llm_engine,
    get_llm_engine,
    set_llm_engine,
    set_my_llm_engine,
)
from app.schemas.llm_engine import (
    LlmEngineDefaultRead,
    LlmEngineEffectiveRead,
    LlmEngineRead,
    LlmEngineStored,
    LlmEngineUpdateRequest,
    UserEngineUpdateRequest,
)
from app.services.parser_settings_service import ProjectNotFoundError

_EP = "app.api.v1.endpoints.llm_engine"

_get = getattr(get_llm_engine, "__wrapped__", get_llm_engine)
_put = getattr(set_llm_engine, "__wrapped__", set_llm_engine)
_put_me = getattr(set_my_llm_engine, "__wrapped__", set_my_llm_engine)
_delete_me = getattr(clear_my_llm_engine, "__wrapped__", clear_my_llm_engine)


def _read(provider: str = "openai", model: str = "gpt-4o-mini") -> LlmEngineRead:
    return LlmEngineRead(
        default=LlmEngineDefaultRead(
            provider=provider,
            model=model,
            mode="fast",
            source="env_default",
            retired=False,
            user_choice_allowed=True,
        ),
        effective=LlmEngineEffectiveRead(
            provider=provider,
            model=model,
            mode="fast",
            source="env_default",
            retired=False,
        ),
        source="env_default",
        catalog=[],
        availability={"openai": "global", "anthropic": None},
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
    ``user_choice_allowed`` (the manager lock) rides the same named
    pass-through."""
    project_id, manager = uuid4(), uuid4()
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
                provider="openai", model="gpt-4o", user_choice_allowed=False
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
        user_choice_allowed=False,
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


# ---------------------------------------------------------------------------
# PUT / DELETE …/llm-engine/me — the viewer's own row
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_put_me_writes_the_viewer_row_and_returns_the_fresh_read() -> None:
    """The write takes the viewer from the auth dependency (never the body)
    and ``is_manager`` from the single membership helper; the response is
    the re-read view, committed."""
    project_id, viewer = uuid4(), uuid4()
    data = _read(provider="anthropic", model="claude-haiku-4-5")
    service = MagicMock()
    service.get_engine_read = AsyncMock(return_value=data)
    db = AsyncMock()
    set_row = AsyncMock()

    with (
        patch(f"{_EP}.set_user_engine", set_row),
        patch(f"{_EP}.viewer_is_manager", AsyncMock(return_value=False)),
        patch(f"{_EP}.LlmEngineService", return_value=service),
    ):
        resp = await _put_me(
            project_id=project_id,
            body=UserEngineUpdateRequest(provider="anthropic", model="claude-haiku-4-5"),
            request=_request(),
            db=db,
            viewer_id=viewer,
        )

    assert resp.ok is True
    assert resp.data is data
    assert resp.trace_id == "trace-llm-engine"
    set_row.assert_awaited_once_with(
        db,
        user_id=viewer,
        project_id=project_id,
        provider="anthropic",
        model="claude-haiku-4-5",
        mode="fast",
        connection_id=None,
        is_manager=False,
    )
    service.get_engine_read.assert_awaited_once_with(project_id, viewer)
    db.commit.assert_awaited_once()


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("raised", "expected_status"),
    [
        (ValueError("Unknown engine"), 400),
        (ProjectNotFoundError("Project x not found"), 404),
    ],
    ids=["invalid-pair", "missing-project"],
)
async def test_put_me_maps_service_errors_to_status(
    raised: Exception, expected_status: int
) -> None:
    """``EngineLockedError`` / ``EngineNeedsKeyError`` are AppErrors and
    deliberately NOT caught here — the registered handler serves their typed
    403 / 422 envelopes; only a bad pair (400) and a missing project (404)
    are mapped."""
    db = AsyncMock()

    with (
        patch(f"{_EP}.set_user_engine", AsyncMock(side_effect=raised)),
        patch(f"{_EP}.viewer_is_manager", AsyncMock(return_value=False)),
        patch(f"{_EP}.LlmEngineService", return_value=MagicMock()),
        pytest.raises(HTTPException) as exc_info,
    ):
        await _put_me(
            project_id=uuid4(),
            body=UserEngineUpdateRequest(provider="openai", model="gpt-4o"),
            request=_request(),
            db=db,
            viewer_id=uuid4(),
        )

    assert exc_info.value.status_code == expected_status
    db.commit.assert_not_awaited()


@pytest.mark.asyncio
async def test_delete_me_clears_the_viewer_row_and_commits() -> None:
    project_id, viewer = uuid4(), uuid4()
    db = AsyncMock()

    with patch(f"{_EP}.clear_user_engine", AsyncMock(return_value=True)) as clear_row:
        resp = await _delete_me(project_id=project_id, request=_request(), db=db, viewer_id=viewer)

    assert resp.ok is True
    assert resp.data.cleared is True
    clear_row.assert_awaited_once_with(db, user_id=viewer, project_id=project_id)
    db.commit.assert_awaited_once()
