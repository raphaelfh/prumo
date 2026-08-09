"""Direct endpoint-coroutine tests for the clone + republish endpoints.

httpx/ASGITransport lines don't register in diff-cover (the known ASGI
blind spot), so these call the coroutine directly with the dependencies
passed explicitly — mirroring test_template_instruction_endpoint.py.
"""

import uuid
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import HTTPException

import app.api.v1.endpoints.project_templates as endpoint_module
from app.schemas.hitl_session import CloneTemplateRequest, TemplatePublishRefusalCode
from app.services.template_clone_service import (
    PendingConfigDraftError,
    TemplateNotFoundError,
)
from app.services.template_version_service import PublishBlockedByMultiEntryError


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


@pytest.mark.asyncio
async def test_clone_maps_publish_blocked_to_409(monkeypatch) -> None:
    """The drift-heal republish inside clone can hit the publish-time
    cardinality re-check (B-8 review); it maps like the pending-draft
    refusal instead of a 500."""
    monkeypatch.setattr(
        endpoint_module,
        "TemplateCloneService",
        MagicMock(return_value=_service_raising(PublishBlockedByMultiEntryError("blocked"))),
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
async def test_republish_propagates_the_typed_publish_refusal(monkeypatch) -> None:
    """B-9b0 D1: the endpoint no longer flattens the publish-time
    cardinality re-check to ``HTTPException(409, str(e))`` — it lets the
    ``AppError`` through so ``app_error_handler`` renders its code and the
    offending section labels. Still commits nothing.

    Kept as a direct endpoint-coroutine call: the ASGI-level envelope test
    in ``tests/integration/test_template_version_republish.py`` does not
    register in diff-cover."""
    service = MagicMock()
    service.republish = AsyncMock(
        side_effect=PublishBlockedByMultiEntryError(
            'Cannot publish: section "Final predictors" is set to repeat once per entry',
            details={"section_labels": ["Final predictors"]},
        )
    )
    monkeypatch.setattr(endpoint_module, "TemplateVersionService", MagicMock(return_value=service))
    db = AsyncMock()
    with pytest.raises(PublishBlockedByMultiEntryError) as exc:
        await endpoint_module.republish_template_version(
            project_id=uuid.uuid4(),
            template_id=uuid.uuid4(),
            request=_request(),
            db=db,
            current_user_sub=uuid.uuid4(),
        )
    assert exc.value.code == TemplatePublishRefusalCode.PUBLISH_BLOCKED_BY_MULTI_ENTRY
    assert exc.value.status_code == 409
    assert exc.value.details == {"section_labels": ["Final predictors"]}
    # Forwarded by keyword, so ``AppError.__init__``'s ``super().__init__``
    # keeps ``str(e)`` equal to the message.
    assert "Final predictors" in str(exc.value)
    db.commit.assert_not_awaited()
