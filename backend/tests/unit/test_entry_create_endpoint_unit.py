"""The POST /extraction/instances handler coroutine, called directly.

The integration suite reaches these lines through httpx ASGITransport,
which diff-cover does not attribute to them — so the handler's own
branches (the 201 construction, both arms of the trace-id fallback, and
each error translation) need a direct call to be covered at all.

Everything the handler depends on is faked: the point is the handler's
logic, not the service's, which ``test_entry_hierarchy_service`` covers
unmocked against the real schema.
"""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest
from fastapi import HTTPException

from app.api.v1.endpoints import extraction_instances as ei
from app.schemas.extraction import EntryCreateRequest, EntryCreateResponse
from app.services.entry_hierarchy_service import (
    EntryKeyDuplicateError,
    EntryTargetNotFoundError,
    InvalidEntryTargetError,
)

CALLER = uuid4()

#: The handler body, without ``@limiter.limit``'s wrapper. slowapi refuses
#: anything that is not a real starlette ``Request``, and the rate limiter is
#: infrastructure the integration suite already exercises — what needs direct
#: coverage here is the handler's own branching. Patching module globals still
#: reaches this function: it resolves them at call time from ``ei.__dict__``.
_handler = ei.create_entry.__wrapped__


def _payload(**overrides: object) -> EntryCreateRequest:
    return EntryCreateRequest(
        projectId=overrides.pop("projectId", uuid4()),
        articleId=uuid4(),
        templateId=uuid4(),
        entityTypeId=uuid4(),
        label="Cox Model",
        entityKey="Cox Model",
        **overrides,
    )


@pytest.fixture
def gates(monkeypatch: pytest.MonkeyPatch) -> dict[str, AsyncMock]:
    """Both auth gates pass; the handler's own branches are what is under test."""
    member = AsyncMock(return_value=None)
    reviewer = AsyncMock(return_value=None)
    monkeypatch.setattr(ei, "ensure_project_member", member)
    monkeypatch.setattr(ei, "ensure_project_reviewer", reviewer)
    return {"member": member, "reviewer": reviewer}


def _service(monkeypatch: pytest.MonkeyPatch, outcome: object) -> None:
    """Point the handler at a fake service that returns or raises ``outcome``."""

    async def _create_entry(**_kwargs: object) -> EntryCreateResponse:
        if isinstance(outcome, Exception):
            raise outcome
        return outcome  # type: ignore[return-value]

    monkeypatch.setattr(
        ei,
        "EntryHierarchyService",
        lambda _db: SimpleNamespace(create_entry=_create_entry),
    )


def _request(trace_id: object = "trace-1") -> SimpleNamespace:
    state = SimpleNamespace() if trace_id is None else SimpleNamespace(trace_id=trace_id)
    return SimpleNamespace(state=state)


@pytest.mark.asyncio
async def test_the_handler_returns_201_body_and_commits(
    monkeypatch: pytest.MonkeyPatch, gates: dict[str, AsyncMock]
) -> None:
    instance_id = uuid4()
    _service(monkeypatch, EntryCreateResponse(instance_id=instance_id, label="Cox Model"))
    db = AsyncMock()

    result = await _handler(request=_request(), payload=_payload(), db=db, current_user_sub=CALLER)

    assert result.data.instance_id == instance_id
    assert result.data.label == "Cox Model"
    db.commit.assert_awaited_once()
    db.rollback.assert_not_awaited()
    # Both gates run, and BEFORE any write.
    gates["member"].assert_awaited_once()
    gates["reviewer"].assert_awaited_once()


@pytest.mark.asyncio
async def test_the_trace_id_falls_back_when_the_request_carries_none(
    monkeypatch: pytest.MonkeyPatch, gates: dict[str, AsyncMock]
) -> None:
    del gates  # side-effect fixture: both auth gates pass
    _service(monkeypatch, EntryCreateResponse(instance_id=uuid4(), label="Cox Model"))

    with_trace = await _handler(
        request=_request("trace-abc"), payload=_payload(), db=AsyncMock(), current_user_sub=CALLER
    )
    without = await _handler(
        request=_request(None), payload=_payload(), db=AsyncMock(), current_user_sub=CALLER
    )

    assert with_trace.trace_id == "trace-abc"
    assert without.trace_id == "missing-trace-id"


@pytest.mark.asyncio
async def test_a_duplicate_key_propagates_as_the_typed_app_error(
    monkeypatch: pytest.MonkeyPatch, gates: dict[str, AsyncMock]
) -> None:
    """Re-raised, not translated: the global AppError handler owns the
    typed 409 envelope, and an HTTPException here would lose the code."""
    del gates  # side-effect fixture: both auth gates pass
    _service(monkeypatch, EntryKeyDuplicateError("Cox Model"))
    db = AsyncMock()

    with pytest.raises(EntryKeyDuplicateError) as exc:
        await _handler(request=_request(), payload=_payload(), db=db, current_user_sub=CALLER)

    assert exc.value.status_code == 409
    assert exc.value.code == "ENTRY_KEY_DUPLICATE"
    db.rollback.assert_awaited_once()
    db.commit.assert_not_awaited()


@pytest.mark.asyncio
async def test_a_missing_target_becomes_404(
    monkeypatch: pytest.MonkeyPatch, gates: dict[str, AsyncMock]
) -> None:
    del gates  # side-effect fixture: both auth gates pass
    _service(monkeypatch, EntryTargetNotFoundError("Parent entry not found"))
    db = AsyncMock()

    with pytest.raises(HTTPException) as exc:
        await _handler(request=_request(), payload=_payload(), db=db, current_user_sub=CALLER)

    assert exc.value.status_code == 404
    assert exc.value.detail == "Parent entry not found"
    db.rollback.assert_awaited_once()
    db.commit.assert_not_awaited()


@pytest.mark.asyncio
async def test_an_invalid_target_becomes_422(
    monkeypatch: pytest.MonkeyPatch, gates: dict[str, AsyncMock]
) -> None:
    del gates  # side-effect fixture: both auth gates pass
    _service(monkeypatch, InvalidEntryTargetError("A root group takes no parentInstanceId"))
    db = AsyncMock()

    with pytest.raises(HTTPException) as exc:
        await _handler(request=_request(), payload=_payload(), db=db, current_user_sub=CALLER)

    assert exc.value.status_code == 422
    assert exc.value.detail == "A root group takes no parentInstanceId"
    db.rollback.assert_awaited_once()


@pytest.mark.asyncio
async def test_a_bare_value_error_also_becomes_422(
    monkeypatch: pytest.MonkeyPatch, gates: dict[str, AsyncMock]
) -> None:
    """The except clause catches ValueError, not only the named subclass —
    a service refusal added later must not escape as a 500."""
    del gates  # side-effect fixture: both auth gates pass
    _service(monkeypatch, ValueError("something the service refused"))
    db = AsyncMock()

    with pytest.raises(HTTPException) as exc:
        await _handler(request=_request(), payload=_payload(), db=db, current_user_sub=CALLER)

    assert exc.value.status_code == 422
    db.rollback.assert_awaited_once()
