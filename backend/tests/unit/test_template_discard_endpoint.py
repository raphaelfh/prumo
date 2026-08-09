"""Direct endpoint-coroutine tests for POST discard-draft (B-9c1, T2).

httpx/ASGITransport lines don't register in diff-cover (the known ASGI
blind spot), so the status-code map — the whole substance of this
endpoint — is exercised by calling the coroutine with its dependencies
passed explicitly, mirroring test_template_config_status_endpoint.py. The
behaviour behind each error lives in
tests/integration/test_template_discard_draft.py.
"""

import uuid
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import HTTPException

import app.api.v1.endpoints.project_templates as endpoint_module
from app.core.error_handler import AppError
from app.schemas.hitl_session import (
    DiscardDraftRequest,
    DiscardDraftResponse,
    DiscardKeptNode,
)
from app.services.project_template_active_service import ProjectTemplateNotFoundError
from app.services.template_discard_service import (
    DiscardBlockedByCardinalityError,
    DiscardRacedError,
    NarrowBaselineError,
    OrphanAcknowledgementRequiredError,
)
from app.services.template_restore_service import ContainerSwapUnsupportedError
from app.services.template_version_read_service import NoActiveTemplateVersionError


def _request() -> MagicMock:
    request = MagicMock()
    request.state.trace_id = "trace-1"
    return request


async def _call(db: AsyncMock, *, acknowledge_orphans: bool = False):
    return await endpoint_module.discard_template_draft(
        project_id=uuid.uuid4(),
        template_id=uuid.uuid4(),
        body=DiscardDraftRequest(acknowledge_orphans=acknowledge_orphans),
        request=_request(),
        db=db,
        current_user_sub=uuid.uuid4(),
    )


@pytest.mark.asyncio
async def test_discard_wraps_the_result_and_commits(monkeypatch) -> None:
    template_id = uuid.uuid4()
    result = DiscardDraftResponse(
        project_template_id=template_id,
        draft_was_open=True,
        created_entity_types=0,
        deleted_entity_types=1,
        updated_entity_types=2,
        created_fields=3,
        deleted_fields=4,
        updated_fields=5,
        instruction_reset=True,
        kept=[
            DiscardKeptNode(
                node_id=uuid.uuid4(),
                node_kind="entity_type",
                label="Outcomes",
                reason="has_recorded_data",
            )
        ],
    )
    service = AsyncMock(return_value=result)
    monkeypatch.setattr(endpoint_module, "discard_draft", service)
    db = AsyncMock()

    response = await _call(db, acknowledge_orphans=True)

    assert response.ok is True
    assert response.data is result
    assert response.trace_id == "trace-1"
    assert service.await_args.kwargs["acknowledge_orphans"] is True
    db.commit.assert_awaited_once()


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "error",
    [
        ProjectTemplateNotFoundError("gone"),
        NoActiveTemplateVersionError("never published"),
    ],
)
async def test_missing_template_maps_to_404(monkeypatch, error: Exception) -> None:
    monkeypatch.setattr(endpoint_module, "discard_draft", AsyncMock(side_effect=error))
    db = AsyncMock()

    with pytest.raises(HTTPException) as exc:
        await _call(db)

    assert exc.value.status_code == 404
    assert exc.value.detail == str(error)
    db.commit.assert_not_awaited()


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("error", "code"),
    [
        (NarrowBaselineError("legacy"), "NARROW_BASELINE"),
        (DiscardBlockedByCardinalityError("two entries"), "CARDINALITY_DOWNGRADE_BLOCKED"),
        (ContainerSwapUnsupportedError("swapped"), "CONTAINER_SWAP_UNSUPPORTED"),
        (OrphanAcknowledgementRequiredError("orphans"), "ORPHAN_ACK_REQUIRED"),
        (DiscardRacedError("raced"), "DISCARD_RACED"),
    ],
)
async def test_refusals_propagate_as_coded_409s(monkeypatch, error: AppError, code: str) -> None:
    """B-9c2 D1: the endpoint no longer catches these. They reach
    ``app_error_handler``, which is the only thing that can write
    ``error.code`` and ``error.details`` — the old
    ``HTTPException(409, str(e))`` produced ``HTTP_ERROR`` for all five."""
    monkeypatch.setattr(endpoint_module, "discard_draft", AsyncMock(side_effect=error))
    db = AsyncMock()

    with pytest.raises(AppError) as exc:
        await _call(db)

    assert exc.value is error
    assert exc.value.status_code == 409
    assert exc.value.code == code
    # ``AppError.__init__`` keeps ``super().__init__(message)``, so the
    # service-level ``pytest.raises`` assertions still read the message.
    assert str(exc.value) == exc.value.message
    # A refusal must never commit — most of them leave the transaction
    # deliberately unusable (D8).
    db.commit.assert_not_awaited()
