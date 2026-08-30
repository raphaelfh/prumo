"""Direct endpoint-coroutine unit tests for the ai-context endpoints.

The ASGI transport's handler lines do not register on coverage (the diff-cover
blind spot), so the coroutines are called directly with the service patched IN
THE ENDPOINT MODULE'S NAMESPACE. Both handlers are ``@limiter.limit``-decorated;
``getattr(fn, "__wrapped__", fn)`` reaches the pristine coroutine underneath.

The auth gates are ``Depends(...)`` — resolved by FastAPI, never called in the
handler body — so role enforcement is asserted in the integration suite
(reviewer read-yes/write-403, outsider 403, unknown project 403).
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import pytest
from fastapi import HTTPException

from app.api.v1.endpoints.ai_context import read_ai_context, update_ai_context
from app.schemas.project_ai_context import PicotsSlot, PicotsSlots, ProjectAiContextUpdate
from app.services.project_ai_context import ProjectNotFoundError

_EP = "app.api.v1.endpoints.ai_context"

_get = getattr(read_ai_context, "__wrapped__", read_ai_context)
_put = getattr(update_ai_context, "__wrapped__", update_ai_context)


def _payload(preview: str | None = "- Population: Adults") -> dict:
    return {
        "picots": {
            "population": {"description": "Adults", "inclusion": [], "exclusion": []},
            "index_models": {"description": "", "inclusion": [], "exclusion": []},
            "comparator_models": {"description": "", "inclusion": [], "exclusion": []},
            "outcomes": {"description": "", "inclusion": [], "exclusion": []},
            "timing": {"description": "", "inclusion": [], "exclusion": []},
            "setting_and_intended_use": {"description": "", "inclusion": [], "exclusion": []},
        },
        "labels": {"population": "Population"},
        "review_type": "predictive_model",
        "picots_enabled": True,
        "preview": preview,
    }


def _request() -> MagicMock:
    request = MagicMock()
    request.state.trace_id = "trace-ai-context"
    return request


@pytest.mark.asyncio
async def test_get_wraps_the_service_read_model_in_the_envelope() -> None:
    with patch(f"{_EP}.get_ai_context", AsyncMock(return_value=_payload())) as svc:
        res = await _get(project_id=(pid := uuid4()), request=_request(), db=AsyncMock())

    assert res.ok is True
    assert res.trace_id == "trace-ai-context"
    assert res.data.preview == "- Population: Adults"
    assert res.data.picots.population.description == "Adults"
    assert svc.await_args.args[1] == pid


@pytest.mark.asyncio
async def test_get_maps_a_missing_project_to_404() -> None:
    with (
        patch(f"{_EP}.get_ai_context", AsyncMock(side_effect=ProjectNotFoundError("gone"))),
        pytest.raises(HTTPException) as exc,
    ):
        await _get(project_id=uuid4(), request=_request(), db=AsyncMock())

    assert exc.value.status_code == 404


@pytest.mark.asyncio
async def test_put_passes_both_halves_as_named_kwargs_and_commits() -> None:
    """Named kwargs, so a future reorder cannot silently swap the two halves."""
    db = AsyncMock()
    body = ProjectAiContextUpdate(
        picots=PicotsSlots(population=PicotsSlot(description="Adults")),
        picots_enabled=False,
    )

    with patch(f"{_EP}.set_ai_context", AsyncMock(return_value=_payload(preview=None))) as svc:
        res = await _put(project_id=(pid := uuid4()), body=body, request=_request(), db=db)

    assert svc.await_args.args[1] == pid
    assert svc.await_args.kwargs["picots_enabled"] is False
    assert svc.await_args.kwargs["picots"]["population"]["description"] == "Adults"
    db.commit.assert_awaited_once()
    assert res.data.preview is None


@pytest.mark.asyncio
async def test_put_forwards_an_absent_half_as_none_rather_than_a_default() -> None:
    """Omitting ``picots`` must not write six blank slots over the stored question."""
    with patch(f"{_EP}.set_ai_context", AsyncMock(return_value=_payload())) as svc:
        await _put(
            project_id=uuid4(),
            body=ProjectAiContextUpdate(picots_enabled=True),
            request=_request(),
            db=AsyncMock(),
        )

    assert svc.await_args.kwargs["picots"] is None


@pytest.mark.asyncio
async def test_put_maps_a_missing_project_to_404_without_committing() -> None:
    db = AsyncMock()
    with (
        patch(f"{_EP}.set_ai_context", AsyncMock(side_effect=ProjectNotFoundError("gone"))),
        pytest.raises(HTTPException) as exc,
    ):
        await _put(
            project_id=uuid4(),
            body=ProjectAiContextUpdate(picots_enabled=True),
            request=_request(),
            db=db,
        )

    assert exc.value.status_code == 404
    db.commit.assert_not_awaited()
