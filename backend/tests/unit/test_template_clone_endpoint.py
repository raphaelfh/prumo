"""Direct endpoint-coroutine tests for the clone endpoint.

httpx/ASGITransport lines don't register in diff-cover (the known ASGI
blind spot), so these call the coroutine directly with the dependencies
passed explicitly — mirroring test_template_instruction_endpoint.py.
"""

import uuid
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import HTTPException

import app.api.v1.endpoints.project_templates as endpoint_module
from app.schemas.hitl_session import CloneTemplateRequest
from app.services.template_clone_service import (
    PendingConfigDraftError,
    TemplateNotFoundError,
)


def _request() -> MagicMock:
    request = MagicMock()
    request.state.trace_id = "trace-1"
    return request


def _clone_result() -> MagicMock:
    result = MagicMock()
    result.project_template_id = uuid.uuid4()
    result.version_id = uuid.uuid4()
    result.entity_type_count = 14
    result.field_count = 66
    result.created = True
    return result


def _service_raising(exc: Exception) -> MagicMock:
    service = MagicMock()
    service.clone = AsyncMock(side_effect=exc)
    return service


@pytest.mark.asyncio
async def test_clone_commits_and_wraps(monkeypatch) -> None:
    service = MagicMock()
    service.clone = AsyncMock(return_value=_clone_result())
    monkeypatch.setattr(endpoint_module, "TemplateCloneService", MagicMock(return_value=service))
    db = AsyncMock()
    response = await endpoint_module.clone_template_into_project(
        project_id=uuid.uuid4(),
        body=CloneTemplateRequest(global_template_id=uuid.uuid4(), kind="extraction"),
        request=_request(),
        db=db,
        current_user_sub=uuid.uuid4(),
    )
    assert response.ok is True
    assert response.data.entity_type_count == 14
    db.commit.assert_awaited_once()


@pytest.mark.asyncio
async def test_clone_maps_pending_draft_to_409(monkeypatch) -> None:
    """B-4: a pending config draft refuses the re-import with a 409 and
    commits nothing."""
    monkeypatch.setattr(
        endpoint_module,
        "TemplateCloneService",
        MagicMock(return_value=_service_raising(PendingConfigDraftError("pending"))),
    )
    db = AsyncMock()
    with pytest.raises(HTTPException) as exc:
        await endpoint_module.clone_template_into_project(
            project_id=uuid.uuid4(),
            body=CloneTemplateRequest(global_template_id=uuid.uuid4(), kind="extraction"),
            request=_request(),
            db=db,
            current_user_sub=uuid.uuid4(),
        )
    assert exc.value.status_code == 409
    db.commit.assert_not_awaited()


@pytest.mark.asyncio
async def test_clone_maps_not_found_to_404(monkeypatch) -> None:
    monkeypatch.setattr(
        endpoint_module,
        "TemplateCloneService",
        MagicMock(return_value=_service_raising(TemplateNotFoundError("nope"))),
    )
    db = AsyncMock()
    with pytest.raises(HTTPException) as exc:
        await endpoint_module.clone_template_into_project(
            project_id=uuid.uuid4(),
            body=CloneTemplateRequest(global_template_id=uuid.uuid4(), kind="extraction"),
            request=_request(),
            db=db,
            current_user_sub=uuid.uuid4(),
        )
    assert exc.value.status_code == 404
    db.commit.assert_not_awaited()
