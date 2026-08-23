# backend/tests/unit/test_project_templates_portable_endpoints_unit.py
"""Direct endpoint-coroutine tests for export / import / delete.

The HTTP-layer smoke (tests/integration/test_template_portable_endpoints.py)
runs through ASGITransport, whose handler lines do not register on
diff-cover; these call the coroutines directly. All three endpoints carry
``@limiter.limit``, so the request is a REAL starlette Request (slowapi
rejects mocks; a MagicMock trace_id also fails ApiResponse validation).
"""

from unittest.mock import AsyncMock, patch
from uuid import uuid4

import pytest
from fastapi import HTTPException
from starlette.requests import Request

from app.api.v1.endpoints.project_templates import (
    delete_project_template,
    export_project_template,
    import_project_template,
)
from app.main import app
from app.schemas.hitl_session import CloneTemplateResponse, TemplateDeleteResponse
from app.schemas.template_portable import PortableTemplate
from app.services.project_template_active_service import ProjectTemplateNotFoundError

_EP = "app.api.v1.endpoints.project_templates"

_DOC = PortableTemplate.model_validate(
    {
        "prumo_template": 1,
        "kind": "extraction",
        "name": "T",
        "sections": [{"name": "sec", "label": "S"}],
    }
)


def _request(method: str = "POST") -> Request:
    request = Request(
        {
            "type": "http",
            "method": method,
            "path": "/",
            "headers": [],
            "query_string": b"",
            "client": ("test-client", 1),
            "app": app,
        }
    )
    request.state.trace_id = "trace-1"
    return request


@pytest.mark.asyncio
async def test_export_returns_document_in_envelope() -> None:
    project_id, template_id = uuid4(), uuid4()
    with patch(f"{_EP}.to_portable", AsyncMock(return_value=_DOC)) as svc:
        resp = await export_project_template(
            project_id=project_id,
            template_id=template_id,
            request=_request("GET"),
            db=AsyncMock(),
            _user_sub=uuid4(),
        )
    assert svc.await_args.kwargs == {"project_id": project_id, "template_id": template_id}
    assert resp.ok is True and resp.data is _DOC and resp.trace_id == "trace-1"


@pytest.mark.asyncio
async def test_export_not_found_is_404() -> None:
    with (
        patch(f"{_EP}.to_portable", AsyncMock(side_effect=ProjectTemplateNotFoundError("x"))),
        pytest.raises(HTTPException) as exc,
    ):
        await export_project_template(
            project_id=uuid4(),
            template_id=uuid4(),
            request=_request("GET"),
            db=AsyncMock(),
            _user_sub=uuid4(),
        )
    assert exc.value.status_code == 404


@pytest.mark.asyncio
async def test_import_parses_then_imports_then_commits() -> None:
    project_id, caller = uuid4(), uuid4()
    result = CloneTemplateResponse(
        project_template_id=uuid4(),
        version_id=uuid4(),
        entity_type_count=1,
        field_count=0,
        created=True,
    )
    db = AsyncMock()
    with (
        patch(f"{_EP}.parse_portable_document", return_value=_DOC) as parse,
        patch(f"{_EP}.import_portable", AsyncMock(return_value=result)) as imp,
    ):
        resp = await import_project_template(
            project_id=project_id,
            request=_request(),
            db=db,
            body={"prumo_template": 1},
            current_user_sub=caller,
        )
    parse.assert_called_once_with({"prumo_template": 1})
    assert imp.await_args.kwargs == {"project_id": project_id, "doc": _DOC, "user_id": caller}
    db.commit.assert_awaited_once()
    assert resp.data == result


@pytest.mark.asyncio
async def test_delete_returns_service_payload_and_commits() -> None:
    project_id, template_id = uuid4(), uuid4()
    payload = TemplateDeleteResponse(project_template_id=template_id, deleted=True)
    db = AsyncMock()
    with patch(f"{_EP}.delete_template", AsyncMock(return_value=payload)) as svc:
        resp = await delete_project_template(
            project_id=project_id,
            template_id=template_id,
            request=_request("DELETE"),
            db=db,
            _user_sub=uuid4(),
        )
    assert svc.await_args.kwargs == {"project_id": project_id, "template_id": template_id}
    db.commit.assert_awaited_once()
    assert resp.data == payload


@pytest.mark.asyncio
async def test_delete_not_found_is_404() -> None:
    with (
        patch(f"{_EP}.delete_template", AsyncMock(side_effect=ProjectTemplateNotFoundError("x"))),
        pytest.raises(HTTPException) as exc,
    ):
        await delete_project_template(
            project_id=uuid4(),
            template_id=uuid4(),
            request=_request("DELETE"),
            db=AsyncMock(),
            _user_sub=uuid4(),
        )
    assert exc.value.status_code == 404
