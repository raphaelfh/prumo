"""Direct endpoint-coroutine tests with the service patched in the ENDPOINT
MODULE'S namespace (the test_llm_engine_endpoints_unit pattern)."""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import pytest
from fastapi import HTTPException
from pydantic import SecretStr

from app.api.v1.endpoints.user_connections import (
    create_my_connection,
    delete_my_connection,
    list_my_connections,
    list_providers,
    update_my_connection,
    verify_my_connection,
)
from app.core.net_guard import EndpointUrlError
from app.schemas.llm_connection import (
    LlmConnectionDeleteResult,
    LlmConnectionUpdateRequest,
    UserConnectionCreateRequest,
)
from app.services.llm_connection_service import ConnectionNotFoundError

_EP = "app.api.v1.endpoints.user_connections"
_create = getattr(create_my_connection, "__wrapped__", create_my_connection)
_list = getattr(list_my_connections, "__wrapped__", list_my_connections)
_delete = getattr(delete_my_connection, "__wrapped__", delete_my_connection)
_update = getattr(update_my_connection, "__wrapped__", update_my_connection)
_verify = getattr(verify_my_connection, "__wrapped__", verify_my_connection)
_providers = getattr(list_providers, "__wrapped__", list_providers)


def _req() -> MagicMock:
    """A MagicMock request whose state.trace_id is a real None (not a Mock)."""
    request = MagicMock()
    request.state.trace_id = None
    return request


@pytest.mark.asyncio
async def test_delete_maps_not_found_to_404() -> None:
    service = MagicMock()
    service.delete_user = AsyncMock(side_effect=ConnectionNotFoundError("nope"))
    with (
        patch(f"{_EP}.LlmConnectionService", return_value=service),
        pytest.raises(HTTPException) as exc,
    ):
        await _delete(uuid4(), _req(), AsyncMock(), uuid4())
    assert exc.value.status_code == 404


@pytest.mark.asyncio
async def test_delete_commits_and_wraps_the_typed_result() -> None:
    cid, db = uuid4(), AsyncMock()
    service = MagicMock()
    service.delete_user = AsyncMock(return_value=LlmConnectionDeleteResult(deleted=True, id=cid))
    with patch(f"{_EP}.LlmConnectionService", return_value=service):
        resp = await _delete(cid, _req(), db, uuid4())
    assert resp.ok is True and resp.data.id == cid
    db.commit.assert_awaited_once()


@pytest.mark.asyncio
async def test_update_maps_value_error_to_400() -> None:
    service = MagicMock()
    service.update_user = AsyncMock(side_effect=ValueError("already exists"))
    with (
        patch(f"{_EP}.LlmConnectionService", return_value=service),
        pytest.raises(HTTPException) as exc,
    ):
        await _update(uuid4(), LlmConnectionUpdateRequest(label="x"), _req(), AsyncMock(), uuid4())
    assert exc.value.status_code == 400


@pytest.mark.asyncio
async def test_create_commits_and_maps_a_url_rejection_to_400() -> None:
    body = UserConnectionCreateRequest(provider="openai", label="x", api_key=SecretStr("k"))
    db, service = AsyncMock(), MagicMock()
    service.create_user = AsyncMock(return_value=MagicMock())
    with patch(f"{_EP}.LlmConnectionService", return_value=service):
        resp = await _create(body, _req(), db, uuid4())
    assert resp.ok is True
    db.commit.assert_awaited_once()
    service.create_user = AsyncMock(side_effect=EndpointUrlError("private address"))
    with (
        patch(f"{_EP}.LlmConnectionService", return_value=service),
        pytest.raises(HTTPException) as exc,
    ):
        await _create(body, _req(), AsyncMock(), uuid4())
    assert exc.value.status_code == 400


@pytest.mark.asyncio
async def test_list_wraps_the_service_rows() -> None:
    service = MagicMock()
    service.list_user = AsyncMock(return_value=[])
    with patch(f"{_EP}.LlmConnectionService", return_value=service):
        resp = await _list(_req(), AsyncMock(), uuid4())
    assert resp.ok is True and resp.data == []


@pytest.mark.asyncio
async def test_verify_maps_not_found_to_404_and_a_failed_revet_to_400() -> None:
    service = MagicMock()
    service.verify_user = AsyncMock(side_effect=ConnectionNotFoundError("nope"))
    with (
        patch(f"{_EP}.LlmConnectionService", return_value=service),
        pytest.raises(HTTPException) as exc,
    ):
        await _verify(uuid4(), _req(), AsyncMock(), uuid4())
    assert exc.value.status_code == 404
    service.verify_user = AsyncMock(side_effect=EndpointUrlError("dns"))
    with (
        patch(f"{_EP}.LlmConnectionService", return_value=service),
        pytest.raises(HTTPException) as exc,
    ):
        await _verify(uuid4(), _req(), AsyncMock(), uuid4())
    assert exc.value.status_code == 400


@pytest.mark.asyncio
async def test_providers_read_is_the_registry() -> None:
    resp = await _providers(_req(), uuid4())
    assert [p.id for p in resp.data] == [
        "openai",
        "anthropic",
        "google",
        "openai_compatible",
        "llama_cloud",
    ]
