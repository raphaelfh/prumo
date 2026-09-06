"""The DELETE /extraction/instances handler coroutine, called directly.

Same reason as its POST sibling (``test_entry_create_endpoint_unit``): the
integration suite reaches these lines through httpx ASGITransport, which
diff-cover does not attribute to them, so the handler's own branches — the
200 construction, both arms of the trace-id fallback, and each error
translation — need a direct call to be covered at all.

Everything the handler depends on is faked. The point is the handler's
logic; the service's is covered unmocked against the real schema in
``test_entry_bulk_delete_service``, which is also where the all-or-nothing
property is proved.
"""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest
from fastapi import HTTPException

from app.api.v1.endpoints import extraction_instances as ei
from app.schemas.extraction import EntryBulkDeleteRequest
from app.services.entry_bulk_delete_service import EntryNotFoundError, EntryNotRepeatingError

CALLER = uuid4()

#: The handler body, without ``@limiter.limit``'s wrapper — slowapi refuses
#: anything that is not a real starlette ``Request``, and the rate limiter is
#: infrastructure the integration suite already exercises. Patching module
#: globals still reaches this function: it resolves them at call time.
_handler = ei.delete_entries_endpoint.__wrapped__


def _payload(count: int = 2) -> EntryBulkDeleteRequest:
    return EntryBulkDeleteRequest(
        projectId=uuid4(),
        articleId=uuid4(),
        templateId=uuid4(),
        instanceIds=[uuid4() for _ in range(count)],
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

    async def _delete_entries(*_args: object, **_kwargs: object) -> int:
        if isinstance(outcome, Exception):
            raise outcome
        return outcome  # type: ignore[return-value]

    monkeypatch.setattr(ei, "delete_entries", _delete_entries)


def _request(trace_id: object = "trace-1") -> SimpleNamespace:
    state = SimpleNamespace() if trace_id is None else SimpleNamespace(trace_id=trace_id)
    return SimpleNamespace(state=state)


@pytest.mark.asyncio
async def test_the_handler_returns_the_count_and_commits(
    monkeypatch: pytest.MonkeyPatch, gates: dict[str, AsyncMock]
) -> None:
    _service(monkeypatch, 2)
    db = AsyncMock()

    result = await _handler(request=_request(), payload=_payload(), db=db, current_user_sub=CALLER)

    assert result.data.deleted == 2
    db.commit.assert_awaited_once()
    db.rollback.assert_not_awaited()
    # Both gates run, and BEFORE the delete.
    gates["member"].assert_awaited_once()
    gates["reviewer"].assert_awaited_once()


@pytest.mark.asyncio
async def test_the_trace_id_falls_back_when_the_request_carries_none(
    monkeypatch: pytest.MonkeyPatch, gates: dict[str, AsyncMock]
) -> None:
    del gates  # side-effect fixture: both auth gates pass
    _service(monkeypatch, 1)

    with_trace = await _handler(
        request=_request("trace-abc"), payload=_payload(), db=AsyncMock(), current_user_sub=CALLER
    )
    without = await _handler(
        request=_request(None), payload=_payload(), db=AsyncMock(), current_user_sub=CALLER
    )

    assert with_trace.trace_id == "trace-abc"
    assert without.trace_id == "missing-trace-id"


@pytest.mark.asyncio
async def test_a_missing_entry_becomes_404_and_rolls_back(
    monkeypatch: pytest.MonkeyPatch, gates: dict[str, AsyncMock]
) -> None:
    del gates
    _service(monkeypatch, EntryNotFoundError("Entry x not found"))
    db = AsyncMock()

    with pytest.raises(HTTPException) as exc:
        await _handler(request=_request(), payload=_payload(), db=db, current_user_sub=CALLER)

    assert exc.value.status_code == 404
    # The rollback is what makes the refusal inert — without it the request's
    # transaction stays open and the next statement inherits it.
    db.rollback.assert_awaited_once()
    db.commit.assert_not_awaited()


@pytest.mark.asyncio
async def test_a_singleton_becomes_422_and_rolls_back(
    monkeypatch: pytest.MonkeyPatch, gates: dict[str, AsyncMock]
) -> None:
    del gates
    _service(monkeypatch, EntryNotRepeatingError("Entry x does not repeat"))
    db = AsyncMock()

    with pytest.raises(HTTPException) as exc:
        await _handler(request=_request(), payload=_payload(), db=db, current_user_sub=CALLER)

    assert exc.value.status_code == 422
    db.rollback.assert_awaited_once()
    db.commit.assert_not_awaited()


@pytest.mark.asyncio
async def test_an_unrelated_exception_is_NOT_translated(
    monkeypatch: pytest.MonkeyPatch, gates: dict[str, AsyncMock]
) -> None:
    """The two ``except`` clauses name their errors. A bare ``except
    Exception`` would answer 422 with an internal message echoed in
    ``detail`` — mis-stating the cause and leaking it — so anything else must
    reach the 500 handler untouched."""
    del gates
    _service(monkeypatch, RuntimeError("something else went wrong"))

    with pytest.raises(RuntimeError):
        await _handler(
            request=_request(), payload=_payload(), db=AsyncMock(), current_user_sub=CALLER
        )
