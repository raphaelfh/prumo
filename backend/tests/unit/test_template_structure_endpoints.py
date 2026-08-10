"""Direct endpoint-coroutine tests for the template-structure writes (B-7).

httpx/ASGITransport lines don't register in diff-cover (the known ASGI
blind spot), so these call the coroutines directly with the dependencies
passed explicitly — mirroring test_template_instruction_endpoint.py.

Per endpoint: a happy path (service mocked; envelope + commit asserted,
service awaited with the exact path-scoped kwargs) and one raises-case
per mapped error class (parametrized; commit NOT awaited on error).
"""

import uuid
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime
from typing import Any
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import HTTPException

import app.api.v1.endpoints.template_structure as endpoint_module
from app.schemas.template_structure import (
    SectionCreateRequest,
    SectionDeleteResponse,
    SectionRead,
    SectionUpdateRequest,
    TemplateFieldCreateRequest,
    TemplateFieldDeleteResponse,
    TemplateFieldMoveRequest,
    TemplateFieldRead,
    TemplateFieldReorderRequest,
    TemplateFieldReorderResponse,
    TemplateFieldSortOrderUpdate,
    TemplateFieldUpdateRequest,
)
from app.services.template_field_service import (
    CrossTemplateMoveError,
    DuplicateFieldNameError,
    DuplicateReorderIdsError,
    EntityTypeNotFoundError,
    FieldInUseError,
    FieldNotFoundError,
    ProjectTemplateNotFoundError,
)
from app.services.template_section_service import (
    OneContainerError,
    SectionCardinalityInUseError,
    SectionCardinalityRoleError,
    SectionEntryLabelRoleError,
    SectionInUseError,
    SectionNotFoundError,
    SectionParentRoleError,
)


def _request() -> MagicMock:
    request = MagicMock()
    request.state.trace_id = "trace-1"
    return request


def _field_read(entity_type_id: uuid.UUID | None = None) -> TemplateFieldRead:
    return TemplateFieldRead(
        id=uuid.uuid4(),
        entity_type_id=entity_type_id or uuid.uuid4(),
        name="field_a",
        label="Field A",
        field_type="text",
        is_required=False,
        sort_order=0,
        created_at=datetime.now(tz=UTC),
    )


def _section_read(project_template_id: uuid.UUID | None = None) -> SectionRead:
    return SectionRead(
        id=uuid.uuid4(),
        project_template_id=project_template_id or uuid.uuid4(),
        name="my_section",
        label="My Section",
        cardinality="one",
        role="study_section",
        sort_order=1,
        is_required=False,
        created_at=datetime.now(tz=UTC),
    )


def _field_create_body() -> TemplateFieldCreateRequest:
    return TemplateFieldCreateRequest(
        entity_type_id=uuid.uuid4(),
        name="field_a",
        label="Field A",
        field_type="text",
    )


def _section_create_body() -> SectionCreateRequest:
    return SectionCreateRequest(
        name="my_section",
        label="My Section",
        cardinality="one",
        role="study_section",
    )


# =================== happy paths ===================


@pytest.mark.asyncio
async def test_create_field_wraps_commits_and_scopes(monkeypatch) -> None:
    project_id, template_id = uuid.uuid4(), uuid.uuid4()
    body = _field_create_body()
    read = _field_read(body.entity_type_id)
    service = AsyncMock(return_value=read)
    monkeypatch.setattr(endpoint_module, "create_field", service)
    db = AsyncMock()
    response = await endpoint_module.create_template_field(
        project_id=project_id,
        template_id=template_id,
        body=body,
        request=_request(),
        db=db,
        _user_sub=uuid.uuid4(),
    )
    assert response.ok is True
    assert response.data is read
    assert response.trace_id == "trace-1"
    service.assert_awaited_once_with(
        db, project_id=project_id, template_id=template_id, payload=body
    )
    db.commit.assert_awaited_once()


@pytest.mark.asyncio
async def test_update_field_wraps_commits_and_scopes(monkeypatch) -> None:
    project_id, template_id, field_id = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    body = TemplateFieldUpdateRequest(label="New Label")
    read = _field_read()
    service = AsyncMock(return_value=read)
    monkeypatch.setattr(endpoint_module, "update_field", service)
    db = AsyncMock()
    response = await endpoint_module.update_template_field(
        project_id=project_id,
        template_id=template_id,
        field_id=field_id,
        body=body,
        request=_request(),
        db=db,
        _user_sub=uuid.uuid4(),
    )
    assert response.ok is True
    assert response.data is read
    assert response.trace_id == "trace-1"
    service.assert_awaited_once_with(
        db, project_id=project_id, template_id=template_id, field_id=field_id, payload=body
    )
    db.commit.assert_awaited_once()


@pytest.mark.asyncio
async def test_delete_field_wraps_commits_and_scopes(monkeypatch) -> None:
    project_id, template_id, field_id = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    result = TemplateFieldDeleteResponse(id=field_id, deleted=True)
    service = AsyncMock(return_value=result)
    monkeypatch.setattr(endpoint_module, "delete_field", service)
    db = AsyncMock()
    response = await endpoint_module.delete_template_field(
        project_id=project_id,
        template_id=template_id,
        field_id=field_id,
        request=_request(),
        db=db,
        _user_sub=uuid.uuid4(),
    )
    assert response.ok is True
    assert response.data is result
    assert response.trace_id == "trace-1"
    service.assert_awaited_once_with(
        db, project_id=project_id, template_id=template_id, field_id=field_id
    )
    db.commit.assert_awaited_once()


@pytest.mark.asyncio
async def test_move_field_wraps_commits_and_scopes(monkeypatch) -> None:
    project_id, template_id, field_id = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    body = TemplateFieldMoveRequest(entity_type_id=uuid.uuid4(), sort_order=3)
    read = _field_read(body.entity_type_id)
    service = AsyncMock(return_value=read)
    monkeypatch.setattr(endpoint_module, "move_field", service)
    db = AsyncMock()
    response = await endpoint_module.move_template_field(
        project_id=project_id,
        template_id=template_id,
        field_id=field_id,
        body=body,
        request=_request(),
        db=db,
        _user_sub=uuid.uuid4(),
    )
    assert response.ok is True
    assert response.data is read
    assert response.trace_id == "trace-1"
    service.assert_awaited_once_with(
        db, project_id=project_id, template_id=template_id, field_id=field_id, payload=body
    )
    db.commit.assert_awaited_once()


@pytest.mark.asyncio
async def test_reorder_fields_wraps_commits_and_scopes(monkeypatch) -> None:
    project_id, template_id = uuid.uuid4(), uuid.uuid4()
    body = TemplateFieldReorderRequest(
        updates=[TemplateFieldSortOrderUpdate(id=uuid.uuid4(), sort_order=0)]
    )
    result = TemplateFieldReorderResponse(updated_count=1)
    service = AsyncMock(return_value=result)
    monkeypatch.setattr(endpoint_module, "reorder_fields", service)
    db = AsyncMock()
    response = await endpoint_module.reorder_template_fields(
        project_id=project_id,
        template_id=template_id,
        body=body,
        request=_request(),
        db=db,
        _user_sub=uuid.uuid4(),
    )
    assert response.ok is True
    assert response.data is result
    assert response.trace_id == "trace-1"
    service.assert_awaited_once_with(
        db, project_id=project_id, template_id=template_id, payload=body
    )
    db.commit.assert_awaited_once()


@pytest.mark.asyncio
async def test_create_section_wraps_commits_and_scopes(monkeypatch) -> None:
    project_id, template_id = uuid.uuid4(), uuid.uuid4()
    body = _section_create_body()
    read = _section_read(template_id)
    service = AsyncMock(return_value=read)
    monkeypatch.setattr(endpoint_module, "create_section", service)
    db = AsyncMock()
    response = await endpoint_module.create_template_section(
        project_id=project_id,
        template_id=template_id,
        body=body,
        request=_request(),
        db=db,
        _user_sub=uuid.uuid4(),
    )
    assert response.ok is True
    assert response.data is read
    assert response.trace_id == "trace-1"
    service.assert_awaited_once_with(
        db, project_id=project_id, template_id=template_id, payload=body
    )
    db.commit.assert_awaited_once()


@pytest.mark.asyncio
async def test_update_section_wraps_commits_and_scopes(monkeypatch) -> None:
    project_id, template_id, section_id = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    body = SectionUpdateRequest(label="Renamed")
    read = _section_read(template_id)
    service = AsyncMock(return_value=read)
    monkeypatch.setattr(endpoint_module, "update_section", service)
    db = AsyncMock()
    response = await endpoint_module.update_template_section(
        project_id=project_id,
        template_id=template_id,
        section_id=section_id,
        body=body,
        request=_request(),
        db=db,
        _user_sub=uuid.uuid4(),
    )
    assert response.ok is True
    assert response.data is read
    assert response.trace_id == "trace-1"
    service.assert_awaited_once_with(
        db, project_id=project_id, template_id=template_id, section_id=section_id, payload=body
    )
    db.commit.assert_awaited_once()


@pytest.mark.asyncio
async def test_delete_section_wraps_commits_and_scopes(monkeypatch) -> None:
    project_id, template_id, section_id = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    result = SectionDeleteResponse(id=section_id, deleted=True)
    service = AsyncMock(return_value=result)
    monkeypatch.setattr(endpoint_module, "delete_section", service)
    db = AsyncMock()
    response = await endpoint_module.delete_template_section(
        project_id=project_id,
        template_id=template_id,
        section_id=section_id,
        request=_request(),
        db=db,
        _user_sub=uuid.uuid4(),
    )
    assert response.ok is True
    assert response.data is result
    assert response.trace_id == "trace-1"
    service.assert_awaited_once_with(
        db, project_id=project_id, template_id=template_id, section_id=section_id
    )
    db.commit.assert_awaited_once()


# =================== error mapping ===================

_Caller = Callable[[AsyncMock], Awaitable[Any]]


async def _call_create_field(db: AsyncMock) -> Any:
    return await endpoint_module.create_template_field(
        project_id=uuid.uuid4(),
        template_id=uuid.uuid4(),
        body=_field_create_body(),
        request=_request(),
        db=db,
        _user_sub=uuid.uuid4(),
    )


async def _call_update_field(db: AsyncMock) -> Any:
    return await endpoint_module.update_template_field(
        project_id=uuid.uuid4(),
        template_id=uuid.uuid4(),
        field_id=uuid.uuid4(),
        body=TemplateFieldUpdateRequest(label="New"),
        request=_request(),
        db=db,
        _user_sub=uuid.uuid4(),
    )


async def _call_delete_field(db: AsyncMock) -> Any:
    return await endpoint_module.delete_template_field(
        project_id=uuid.uuid4(),
        template_id=uuid.uuid4(),
        field_id=uuid.uuid4(),
        request=_request(),
        db=db,
        _user_sub=uuid.uuid4(),
    )


async def _call_move_field(db: AsyncMock) -> Any:
    return await endpoint_module.move_template_field(
        project_id=uuid.uuid4(),
        template_id=uuid.uuid4(),
        field_id=uuid.uuid4(),
        body=TemplateFieldMoveRequest(entity_type_id=uuid.uuid4(), sort_order=0),
        request=_request(),
        db=db,
        _user_sub=uuid.uuid4(),
    )


async def _call_reorder_fields(db: AsyncMock) -> Any:
    return await endpoint_module.reorder_template_fields(
        project_id=uuid.uuid4(),
        template_id=uuid.uuid4(),
        body=TemplateFieldReorderRequest(
            updates=[TemplateFieldSortOrderUpdate(id=uuid.uuid4(), sort_order=0)]
        ),
        request=_request(),
        db=db,
        _user_sub=uuid.uuid4(),
    )


async def _call_create_section(db: AsyncMock) -> Any:
    return await endpoint_module.create_template_section(
        project_id=uuid.uuid4(),
        template_id=uuid.uuid4(),
        body=_section_create_body(),
        request=_request(),
        db=db,
        _user_sub=uuid.uuid4(),
    )


async def _call_update_section(db: AsyncMock) -> Any:
    return await endpoint_module.update_template_section(
        project_id=uuid.uuid4(),
        template_id=uuid.uuid4(),
        section_id=uuid.uuid4(),
        body=SectionUpdateRequest(label="Renamed"),
        request=_request(),
        db=db,
        _user_sub=uuid.uuid4(),
    )


async def _call_delete_section(db: AsyncMock) -> Any:
    return await endpoint_module.delete_template_section(
        project_id=uuid.uuid4(),
        template_id=uuid.uuid4(),
        section_id=uuid.uuid4(),
        request=_request(),
        db=db,
        _user_sub=uuid.uuid4(),
    )


# (service attr on the endpoint module, caller, raised error, mapped status)
_ERROR_CASES: list[tuple[str, _Caller, Exception, int]] = [
    ("create_field", _call_create_field, ProjectTemplateNotFoundError("nope"), 404),
    ("create_field", _call_create_field, EntityTypeNotFoundError("nope"), 404),
    ("create_field", _call_create_field, DuplicateFieldNameError("dup"), 409),
    ("update_field", _call_update_field, ProjectTemplateNotFoundError("nope"), 404),
    ("update_field", _call_update_field, FieldNotFoundError("nope"), 404),
    ("update_field", _call_update_field, DuplicateFieldNameError("dup"), 409),
    ("delete_field", _call_delete_field, ProjectTemplateNotFoundError("nope"), 404),
    ("delete_field", _call_delete_field, FieldNotFoundError("nope"), 404),
    ("delete_field", _call_delete_field, FieldInUseError("pinned"), 409),
    ("move_field", _call_move_field, ProjectTemplateNotFoundError("nope"), 404),
    ("move_field", _call_move_field, FieldNotFoundError("nope"), 404),
    ("move_field", _call_move_field, DuplicateFieldNameError("dup"), 409),
    ("move_field", _call_move_field, CrossTemplateMoveError("foreign"), 422),
    ("reorder_fields", _call_reorder_fields, ProjectTemplateNotFoundError("nope"), 404),
    ("reorder_fields", _call_reorder_fields, FieldNotFoundError("nope"), 404),
    ("reorder_fields", _call_reorder_fields, DuplicateReorderIdsError("twice"), 422),
    ("create_section", _call_create_section, ProjectTemplateNotFoundError("nope"), 404),
    ("create_section", _call_create_section, SectionNotFoundError("nope"), 404),
    ("create_section", _call_create_section, SectionParentRoleError("bad parent"), 400),
    ("create_section", _call_create_section, OneContainerError("second"), 409),
    ("update_section", _call_update_section, ProjectTemplateNotFoundError("nope"), 404),
    ("update_section", _call_update_section, SectionNotFoundError("nope"), 404),
    ("update_section", _call_update_section, SectionEntryLabelRoleError("group only"), 422),
    ("update_section", _call_update_section, SectionCardinalityRoleError("per-model only"), 422),
    ("update_section", _call_update_section, SectionCardinalityInUseError("in use"), 409),
    ("delete_section", _call_delete_section, ProjectTemplateNotFoundError("nope"), 404),
    ("delete_section", _call_delete_section, SectionNotFoundError("nope"), 404),
    ("delete_section", _call_delete_section, SectionInUseError("has data"), 409),
]


@pytest.mark.parametrize(
    ("service_name", "call", "error", "expected_status"),
    _ERROR_CASES,
    ids=[f"{name}-{type(err).__name__}-{code}" for name, _, err, code in _ERROR_CASES],
)
@pytest.mark.asyncio
async def test_error_mapping_and_no_commit(
    monkeypatch,
    service_name: str,
    call: _Caller,
    error: Exception,
    expected_status: int,
) -> None:
    monkeypatch.setattr(endpoint_module, service_name, AsyncMock(side_effect=error))
    db = AsyncMock()
    with pytest.raises(HTTPException) as exc:
        await call(db)
    assert exc.value.status_code == expected_status
    assert exc.value.detail == str(error)
    db.commit.assert_not_awaited()
