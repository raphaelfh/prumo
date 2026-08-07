"""Direct endpoint-coroutine tests for the active-version read (B-3a) —
httpx/ASGI lines don't register in diff-cover."""

import uuid
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import HTTPException

import app.api.v1.endpoints.project_templates as endpoint_module
from app.schemas.hitl_session import TemplateActiveVersionRead
from app.services.project_template_active_service import ProjectTemplateNotFoundError
from app.services.template_version_read_service import NoActiveTemplateVersionError


def _request() -> MagicMock:
    request = MagicMock()
    request.state.trace_id = "trace-b3a"
    return request


@pytest.mark.asyncio
async def test_wraps_the_service_result(monkeypatch) -> None:
    read = TemplateActiveVersionRead(version_id=uuid.uuid4(), version=3, entity_types=[])
    monkeypatch.setattr(endpoint_module, "get_active_version_tree", AsyncMock(return_value=read))
    response = await endpoint_module.get_template_active_version(
        project_id=uuid.uuid4(),
        template_id=uuid.uuid4(),
        request=_request(),
        db=AsyncMock(),
        _user_sub=uuid.uuid4(),
    )
    assert response.ok is True
    assert response.data is read
    assert response.trace_id == "trace-b3a"


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "error",
    [ProjectTemplateNotFoundError("nope"), NoActiveTemplateVersionError("none")],
)
async def test_maps_both_not_found_flavours_to_404(monkeypatch, error) -> None:
    monkeypatch.setattr(endpoint_module, "get_active_version_tree", AsyncMock(side_effect=error))
    with pytest.raises(HTTPException) as exc:
        await endpoint_module.get_template_active_version(
            project_id=uuid.uuid4(),
            template_id=uuid.uuid4(),
            request=_request(),
            db=AsyncMock(),
            _user_sub=uuid.uuid4(),
        )
    assert exc.value.status_code == 404
