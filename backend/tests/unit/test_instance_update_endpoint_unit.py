"""The PATCH /extraction/instances/{id} handler coroutine, called directly.

The integration suite (``test_instance_identity``) reaches these lines
through httpx ASGITransport, which diff-cover does not attribute to them, so
each branch of the handler gets a direct call here. The service is faked;
its behavior is covered unmocked against the real schema.
"""

from __future__ import annotations

from unittest.mock import AsyncMock
from uuid import uuid4

import pytest
from fastapi import HTTPException

from app.api.v1.endpoints import extraction_instances as ei
from app.schemas.extraction import InstanceIdentityUpdateRequest
from app.services.entry_hierarchy_service import EntryKeyDuplicateError
from app.services.instance_identity_service import InstanceNotFoundError

CALLER = uuid4()

#: The body without ``@limiter.limit``'s wrapper (slowapi needs a real
#: starlette Request); module globals are still resolved at call time.
_handler = ei.update_instance.__wrapped__


def _payload() -> InstanceIdentityUpdateRequest:
    return InstanceIdentityUpdateRequest(
        projectId=uuid4(), articleId=uuid4(), templateId=uuid4(), entityKey="x"
    )


class _Request:
    class state:  # noqa: N801 — mirrors starlette's attribute name
        trace_id = "trace-1"


@pytest.fixture(autouse=True)
def gates(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(ei, "ensure_project_member", AsyncMock(return_value=None))
    monkeypatch.setattr(ei, "ensure_project_reviewer", AsyncMock(return_value=None))


def _service(monkeypatch: pytest.MonkeyPatch, outcome: Exception) -> None:
    async def _update(*_args: object, **_kwargs: object) -> None:
        raise outcome

    monkeypatch.setattr(ei, "update_instance_identity", _update)


async def _call(db: AsyncMock) -> object:
    return await _handler(
        request=_Request(),
        instance_id=uuid4(),
        payload=_payload(),
        db=db,
        current_user_sub=CALLER,
    )


@pytest.mark.asyncio
async def test_a_duplicate_key_propagates_as_the_typed_app_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Re-raised, not translated: the global AppError handler owns the typed
    409 envelope; the rollback discards the in-memory re-key."""
    _service(monkeypatch, EntryKeyDuplicateError("x"))
    db = AsyncMock()

    with pytest.raises(EntryKeyDuplicateError) as exc:
        await _call(db)

    assert exc.value.status_code == 409
    assert exc.value.code == "ENTRY_KEY_DUPLICATE"
    db.rollback.assert_awaited_once()
    db.commit.assert_not_awaited()


@pytest.mark.asyncio
async def test_a_missing_instance_becomes_404(monkeypatch: pytest.MonkeyPatch) -> None:
    _service(monkeypatch, InstanceNotFoundError("Instance not found"))
    db = AsyncMock()

    with pytest.raises(HTTPException) as exc:
        await _call(db)

    assert exc.value.status_code == 404
    db.rollback.assert_awaited_once()
    db.commit.assert_not_awaited()
