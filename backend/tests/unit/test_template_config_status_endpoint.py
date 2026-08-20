"""Direct endpoint-coroutine tests for GET config-status (slice B-4).

httpx/ASGITransport lines don't register in diff-cover (the known ASGI
blind spot), so these call the coroutine directly with the dependencies
passed explicitly — mirroring test_template_instruction_endpoint.py.
"""

import uuid
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import HTTPException

import app.api.v1.endpoints.project_templates as endpoint_module
from app.schemas.hitl_session import TemplateConfigStatusRead
from app.services.project_template_active_service import ProjectTemplateNotFoundError


def _request() -> MagicMock:
    request = MagicMock()
    request.state.trace_id = "trace-1"
    return request


@pytest.mark.asyncio
async def test_config_status_wraps_service_result(monkeypatch) -> None:
    template_id = uuid.uuid4()
    read = TemplateConfigStatusRead(
        project_template_id=template_id,
        has_pending_changes=True,
        active_version=3,
    )
    monkeypatch.setattr(endpoint_module, "get_template_config_status", AsyncMock(return_value=read))
    response = await endpoint_module.get_template_config_status_endpoint(
        project_id=uuid.uuid4(),
        template_id=template_id,
        request=_request(),
        db=AsyncMock(),
        user_sub=uuid.uuid4(),
    )
    assert response.ok is True
    assert response.data is read
    assert response.trace_id == "trace-1"


@pytest.mark.asyncio
async def test_config_status_maps_not_found_to_404(monkeypatch) -> None:
    monkeypatch.setattr(
        endpoint_module,
        "get_template_config_status",
        AsyncMock(side_effect=ProjectTemplateNotFoundError("nope")),
    )
    with pytest.raises(HTTPException) as exc:
        await endpoint_module.get_template_config_status_endpoint(
            project_id=uuid.uuid4(),
            template_id=uuid.uuid4(),
            request=_request(),
            db=AsyncMock(),
            user_sub=uuid.uuid4(),
        )
    assert exc.value.status_code == 404
