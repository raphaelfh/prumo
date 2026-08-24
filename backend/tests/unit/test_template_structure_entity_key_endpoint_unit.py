"""Direct endpoint-coroutine test for the entity-key update path.

Diff-cover has an ASGI blind spot: handler lines exercised through
``httpx.ASGITransport`` do not register, so the integration test in
``tests/integration/test_template_field_entity_key.py`` leaves these lines
uncovered. Calling the coroutine directly is what registers them.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import pytest
from fastapi import HTTPException
from starlette.requests import Request

from app.api.v1.endpoints.template_structure import update_template_field
from app.main import app
from app.schemas.template_structure import TemplateFieldUpdateRequest
from app.services.template_field_service import DuplicateEntityKeyError

_EP = "app.api.v1.endpoints.template_structure"


def _request() -> Request:
    request = Request(
        {
            "type": "http",
            "method": "PATCH",
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
async def test_declaring_a_second_entity_key_is_a_409() -> None:
    """The typed error must not escape as a raw 23505."""
    db = MagicMock()
    db.commit = AsyncMock()
    with (
        patch(f"{_EP}.claim_draft_lock", AsyncMock()),
        patch(
            f"{_EP}.update_field",
            AsyncMock(side_effect=DuplicateEntityKeyError("already has an entry key")),
        ),
        pytest.raises(HTTPException) as exc,
    ):
        await update_template_field(
            request=_request(),
            project_id=uuid4(),
            template_id=uuid4(),
            field_id=uuid4(),
            body=TemplateFieldUpdateRequest(is_entity_key=True),
            db=db,
            user_sub=uuid4(),
        )
    assert exc.value.status_code == 409
    assert "entry key" in str(exc.value.detail)
    db.commit.assert_not_awaited()
