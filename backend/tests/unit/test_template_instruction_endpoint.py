"""Direct endpoint-coroutine tests for the llm-instruction pair.

httpx/ASGITransport lines don't register in diff-cover (the known ASGI
blind spot), so these call the coroutines directly with the dependencies
passed explicitly — mirroring test_run_write_endpoints_unit.py.
"""

import uuid
from unittest.mock import AsyncMock, MagicMock

import pydantic
import pytest
from fastapi import HTTPException

import app.api.v1.endpoints.project_templates as endpoint_module
from app.schemas.hitl_session import (
    TemplateInstructionRead,
    UpdateTemplateInstructionRequest,
    UpdateTemplateInstructionResponse,
)
from app.services.project_template_active_service import ProjectTemplateNotFoundError
from app.services.template_draft_lock_service import DraftLockHeldError


def _request() -> MagicMock:
    request = MagicMock()
    request.state.trace_id = "trace-1"
    return request


@pytest.mark.asyncio
async def test_get_llm_instruction_wraps_service_result(monkeypatch) -> None:
    template_id = uuid.uuid4()
    read = TemplateInstructionRead(
        project_template_id=template_id,
        llm_template_instruction="X",
        default_instruction=None,
    )
    monkeypatch.setattr(endpoint_module, "get_template_instruction", AsyncMock(return_value=read))
    response = await endpoint_module.get_template_llm_instruction(
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
async def test_get_llm_instruction_maps_not_found_to_404(monkeypatch) -> None:
    monkeypatch.setattr(
        endpoint_module,
        "get_template_instruction",
        AsyncMock(side_effect=ProjectTemplateNotFoundError("nope")),
    )
    with pytest.raises(HTTPException) as exc:
        await endpoint_module.get_template_llm_instruction(
            project_id=uuid.uuid4(),
            template_id=uuid.uuid4(),
            request=_request(),
            db=AsyncMock(),
            _user_sub=uuid.uuid4(),
        )
    assert exc.value.status_code == 404


@pytest.mark.asyncio
async def test_put_llm_instruction_commits_and_wraps(monkeypatch) -> None:
    """B-4: the PUT stages a draft edit — the response carries only the
    normalized value (no version fields; nothing republishes)."""
    template_id = uuid.uuid4()
    result = UpdateTemplateInstructionResponse(
        project_template_id=template_id,
        llm_template_instruction="X",
    )
    monkeypatch.setattr(endpoint_module, "claim_draft_lock", AsyncMock())
    monkeypatch.setattr(endpoint_module, "set_template_instruction", AsyncMock(return_value=result))
    db = AsyncMock()
    response = await endpoint_module.update_template_llm_instruction(
        project_id=uuid.uuid4(),
        template_id=template_id,
        body=UpdateTemplateInstructionRequest(llm_template_instruction="X"),
        request=_request(),
        db=db,
        user_sub=uuid.uuid4(),
    )
    assert response.ok is True
    assert response.data is result
    db.commit.assert_awaited_once()


def test_put_response_schema_has_no_version_fields() -> None:
    """Guards against a silent contract resurrection: pydantic's default
    extra='ignore' would keep an old-shape construction green."""
    assert set(UpdateTemplateInstructionResponse.model_fields) == {
        "project_template_id",
        "llm_template_instruction",
    }


@pytest.mark.asyncio
async def test_put_llm_instruction_maps_not_found_to_404(monkeypatch) -> None:
    monkeypatch.setattr(endpoint_module, "claim_draft_lock", AsyncMock())
    monkeypatch.setattr(
        endpoint_module,
        "set_template_instruction",
        AsyncMock(side_effect=ProjectTemplateNotFoundError("nope")),
    )
    db = AsyncMock()
    with pytest.raises(HTTPException) as exc:
        await endpoint_module.update_template_llm_instruction(
            project_id=uuid.uuid4(),
            template_id=uuid.uuid4(),
            body=UpdateTemplateInstructionRequest(llm_template_instruction="X"),
            request=_request(),
            db=db,
            user_sub=uuid.uuid4(),
        )
    assert exc.value.status_code == 404
    db.commit.assert_not_awaited()


@pytest.mark.asyncio
async def test_put_llm_instruction_claims_the_lock_as_the_caller_before_writing(
    monkeypatch,
) -> None:
    """The instruction is a draft edit like any structural one: same lock."""
    project_id, template_id, caller = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    calls: list[tuple[str, dict]] = []

    async def _claim(_db: object, **kwargs: object) -> None:
        calls.append(("claim", kwargs))

    async def _write(_db: object, **kwargs: object) -> UpdateTemplateInstructionResponse:
        calls.append(("write", kwargs))
        return UpdateTemplateInstructionResponse(
            project_template_id=template_id, llm_template_instruction="X"
        )

    monkeypatch.setattr(endpoint_module, "claim_draft_lock", _claim)
    monkeypatch.setattr(endpoint_module, "set_template_instruction", _write)
    await endpoint_module.update_template_llm_instruction(
        project_id=project_id,
        template_id=template_id,
        body=UpdateTemplateInstructionRequest(llm_template_instruction="X"),
        request=_request(),
        db=AsyncMock(),
        user_sub=caller,
    )
    assert [name for name, _ in calls] == ["claim", "write"]
    assert calls[0][1] == {"project_id": project_id, "template_id": template_id, "user_id": caller}


@pytest.mark.asyncio
async def test_put_llm_instruction_held_lock_propagates_without_write_or_commit(
    monkeypatch,
) -> None:
    held = DraftLockHeldError(
        "held", details={"holder_id": str(uuid.uuid4()), "holder_name": "Ana"}
    )
    monkeypatch.setattr(endpoint_module, "claim_draft_lock", AsyncMock(side_effect=held))
    write = AsyncMock()
    monkeypatch.setattr(endpoint_module, "set_template_instruction", write)
    db = AsyncMock()
    with pytest.raises(DraftLockHeldError):
        await endpoint_module.update_template_llm_instruction(
            project_id=uuid.uuid4(),
            template_id=uuid.uuid4(),
            body=UpdateTemplateInstructionRequest(llm_template_instruction="X"),
            request=_request(),
            db=db,
            user_sub=uuid.uuid4(),
        )
    write.assert_not_awaited()
    db.commit.assert_not_awaited()


def test_request_schema_rejects_over_4000_chars() -> None:
    with pytest.raises(pydantic.ValidationError):
        UpdateTemplateInstructionRequest(llm_template_instruction="x" * 4001)
