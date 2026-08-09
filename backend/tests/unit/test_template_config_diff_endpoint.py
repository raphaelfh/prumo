"""Direct endpoint-coroutine tests for GET config-diff (slice B-9b2a).

httpx/ASGITransport lines don't register in diff-cover (the known ASGI
blind spot), so these call the coroutine directly with the dependencies
passed explicitly — mirroring test_template_config_status_endpoint.py.

The behaviour itself is driven by the integration suite's HTTP tests; this
file covers the endpoint's own two lines: the envelope and the 404 map.
"""

import uuid
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import HTTPException

import app.api.v1.endpoints.project_templates as endpoint_module
from app.schemas.hitl_session import TemplateConfigDiffRead
from app.services.project_template_active_service import ProjectTemplateNotFoundError


def _request() -> MagicMock:
    request = MagicMock()
    request.state.trace_id = "trace-1"
    return request


@pytest.mark.asyncio
async def test_config_diff_wraps_service_result(monkeypatch) -> None:
    template_id = uuid.uuid4()
    read = TemplateConfigDiffRead(project_template_id=template_id, diff_available=True)
    monkeypatch.setattr(endpoint_module, "get_template_config_diff", AsyncMock(return_value=read))

    response = await endpoint_module.get_template_config_diff_endpoint(
        project_id=uuid.uuid4(),
        template_id=template_id,
        request=_request(),
        db=AsyncMock(),
        _user_sub=uuid.uuid4(),
    )

    assert response.ok is True
    assert response.data is read
    assert response.trace_id == "trace-1"


@pytest.mark.asyncio
async def test_config_diff_maps_not_found_to_404(monkeypatch) -> None:
    monkeypatch.setattr(
        endpoint_module,
        "get_template_config_diff",
        AsyncMock(side_effect=ProjectTemplateNotFoundError("nope")),
    )

    with pytest.raises(HTTPException) as exc:
        await endpoint_module.get_template_config_diff_endpoint(
            project_id=uuid.uuid4(),
            template_id=uuid.uuid4(),
            request=_request(),
            db=AsyncMock(),
            _user_sub=uuid.uuid4(),
        )

    assert exc.value.status_code == 404
