"""Direct endpoint-coroutine tests with the service patched in the ENDPOINT
MODULE'S namespace (the test_llm_engine_endpoints_unit pattern)."""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import pytest
from fastapi import HTTPException
from pydantic import SecretStr

from app.api.v1.endpoints.project_connections import (
    create_project_connection,
    delete_project_connection,
    list_project_connections,
    update_project_connection,
    verify_project_connection,
)
from app.core.net_guard import EndpointUrlError
from app.schemas.llm_connection import (
    LlmConnectionDeleteResult,
    LlmConnectionUpdateRequest,
    ProjectConnectionCreateRequest,
)
from app.services.llm_connection_service import ConnectionNotFoundError

_EP = "app.api.v1.endpoints.project_connections"
_create = getattr(create_project_connection, "__wrapped__", create_project_connection)
_list = getattr(list_project_connections, "__wrapped__", list_project_connections)
_delete = getattr(delete_project_connection, "__wrapped__", delete_project_connection)
_update = getattr(update_project_connection, "__wrapped__", update_project_connection)
_verify = getattr(verify_project_connection, "__wrapped__", verify_project_connection)


def _req() -> MagicMock:
    """A MagicMock request whose state.trace_id is a real None (not a Mock)."""
    request = MagicMock()
    request.state.trace_id = None
    return request


@pytest.mark.asyncio
async def test_delete_maps_not_found_to_404() -> None:
    service = MagicMock()
    service.delete_project = AsyncMock(side_effect=ConnectionNotFoundError("nope"))
    with (
        patch(f"{_EP}.LlmConnectionService", return_value=service),
        pytest.raises(HTTPException) as exc,
    ):
        await _delete(uuid4(), uuid4(), _req(), AsyncMock(), uuid4())
    assert exc.value.status_code == 404


@pytest.mark.asyncio
async def test_delete_commits_and_wraps_the_typed_result() -> None:
    project_id, cid, db = uuid4(), uuid4(), AsyncMock()
    service = MagicMock()
    service.delete_project = AsyncMock(return_value=LlmConnectionDeleteResult(deleted=True, id=cid))
    with patch(f"{_EP}.LlmConnectionService", return_value=service):
        resp = await _delete(project_id, cid, _req(), db, uuid4())
    assert resp.ok is True and resp.data.id == cid
    db.commit.assert_awaited_once()


@pytest.mark.asyncio
async def test_update_maps_value_error_to_400() -> None:
    service = MagicMock()
    service.update_project = AsyncMock(side_effect=ValueError("already exists"))
    with (
        patch(f"{_EP}.LlmConnectionService", return_value=service),
        pytest.raises(HTTPException) as exc,
    ):
        await _update(
            uuid4(),
            uuid4(),
            LlmConnectionUpdateRequest(label="x"),
            _req(),
            AsyncMock(),
            uuid4(),
        )
    assert exc.value.status_code == 400


@pytest.mark.asyncio
async def test_create_commits_and_maps_a_url_rejection_to_400() -> None:
    project_id = uuid4()
    body = ProjectConnectionCreateRequest(provider="openai", label="x", api_key=SecretStr("k"))
    db, service = AsyncMock(), MagicMock()
    service.create_project = AsyncMock(return_value=MagicMock())
    with patch(f"{_EP}.LlmConnectionService", return_value=service):
        resp = await _create(project_id, body, _req(), db, uuid4())
    assert resp.ok is True
    db.commit.assert_awaited_once()
    service.create_project = AsyncMock(side_effect=EndpointUrlError("private address"))
    with (
        patch(f"{_EP}.LlmConnectionService", return_value=service),
        pytest.raises(HTTPException) as exc,
    ):
        await _create(project_id, body, _req(), AsyncMock(), uuid4())
    assert exc.value.status_code == 400


@pytest.mark.asyncio
async def test_list_wraps_the_service_rows() -> None:
    project_id = uuid4()
    service = MagicMock()
    service.list_project = AsyncMock(return_value=[])
    with patch(f"{_EP}.LlmConnectionService", return_value=service):
        resp = await _list(project_id, _req(), AsyncMock(), uuid4())
    assert resp.ok is True and resp.data == []


@pytest.mark.asyncio
async def test_verify_maps_not_found_to_404_and_a_failed_revet_to_400() -> None:
    project_id, cid = uuid4(), uuid4()
    service = MagicMock()
    service.verify_project = AsyncMock(side_effect=ConnectionNotFoundError("nope"))
    with (
        patch(f"{_EP}.LlmConnectionService", return_value=service),
        pytest.raises(HTTPException) as exc,
    ):
        await _verify(project_id, cid, _req(), AsyncMock(), uuid4())
    assert exc.value.status_code == 404
    service.verify_project = AsyncMock(side_effect=EndpointUrlError("dns"))
    with (
        patch(f"{_EP}.LlmConnectionService", return_value=service),
        pytest.raises(HTTPException) as exc,
    ):
        await _verify(project_id, cid, _req(), AsyncMock(), uuid4())
    assert exc.value.status_code == 400
