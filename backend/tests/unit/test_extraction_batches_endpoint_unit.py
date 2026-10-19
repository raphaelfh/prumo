"""Direct endpoint-coroutine unit tests for /api/v1/extraction/batches writes.

The ASGI transport's handler lines do not register on coverage, so the
coroutines are called directly (``__wrapped__`` past ``@limiter.limit``) with
the guard, the service, the kick and the queue probe patched IN THE ENDPOINT
MODULE'S NAMESPACE. One shared ``calls`` list pins the order: the batch row is
committed before the dispatcher is kicked, and a refusal commits nothing.
"""

from __future__ import annotations

import json
from datetime import UTC, datetime
from unittest.mock import AsyncMock, MagicMock
from uuid import UUID, uuid4

import pytest
from fastapi import HTTPException

from app.api.v1.endpoints import extraction_batches as ep
from app.schemas.extraction_batch import (
    CreateExtractionBatchRequest,
    ExtractionBatchCounts,
    ExtractionBatchDetail,
)
from app.services.extraction_batch_service import (
    BatchAlreadyActiveError,
    BatchScopeError,
    QueueUnavailableError,
    StartResult,
)

_start = getattr(ep.start_extraction_batch, "__wrapped__", ep.start_extraction_batch)
_cancel = getattr(ep.cancel_extraction_batch, "__wrapped__", ep.cancel_extraction_batch)
_resume = getattr(ep.resume_extraction_batch, "__wrapped__", ep.resume_extraction_batch)

TRACE = "trace-batches"
OWNER = uuid4()
BATCH = uuid4()


def _detail(batch_id: UUID) -> ExtractionBatchDetail:
    return ExtractionBatchDetail(
        id=batch_id,
        project_id=uuid4(),
        project_name="Project",
        template_id=uuid4(),
        template_name="Template",
        kind="extraction",
        created_at=datetime(2026, 10, 18, tzinfo=UTC),
        finished_at=None,
        state="active",
        stalled=False,
        stop_code=None,
        stop_message=None,
        counts=ExtractionBatchCounts(
            total=1,
            queued=1,
            running=0,
            done=0,
            done_with_issues=0,
            needs_attention=0,
            skipped=0,
            not_run=0,
        ),
        items=[],
    )


class _World:
    """The patched collaborators, recording into one ordered ``calls`` list."""

    def __init__(self, monkeypatch: pytest.MonkeyPatch, *, start_error: Exception | None = None):
        self.calls: list[str] = []
        self.kicks: list[tuple[UUID, bool]] = []
        self.cancelled: list[tuple[UUID, UUID]] = []
        self.started: list[tuple[UUID, CreateExtractionBatchRequest]] = []
        world = self

        class FakeService:
            def __init__(self, db: object) -> None:
                self.db = db

            async def start(
                self, owner_id: UUID, request: CreateExtractionBatchRequest
            ) -> StartResult:
                world.calls.append("start")
                world.started.append((owner_id, request))
                if start_error is not None:
                    raise start_error
                return StartResult(batch_id=BATCH, replayed=False)

            async def cancel(self, owner_id: UUID, batch_id: UUID, *, now: datetime) -> None:  # noqa: ARG002
                world.calls.append("cancel")
                world.cancelled.append((owner_id, batch_id))

            async def detail(
                self,
                owner_id: UUID,  # noqa: ARG002
                batch_id: UUID,
                *,
                now: datetime,  # noqa: ARG002
            ) -> ExtractionBatchDetail:
                return _detail(batch_id)

        async def reviewer(db: object, project_id: UUID, user_sub: UUID) -> None:  # noqa: ARG001
            world.calls.append("guard")

        def kick(batch_id: UUID, *, reenqueue_stale: bool = False) -> None:
            world.calls.append("kick")
            world.kicks.append((batch_id, reenqueue_stale))

        self.db = MagicMock()
        self.db.commit = AsyncMock(side_effect=lambda: world.calls.append("commit"))
        monkeypatch.setattr(ep, "ExtractionBatchService", FakeService)
        monkeypatch.setattr(ep, "ensure_project_reviewer", reviewer)
        monkeypatch.setattr(ep, "kick_batch", kick)
        self.queue_up = True
        monkeypatch.setattr(ep.queue_health, "is_queue_available", lambda: world.queue_up)


def _request() -> MagicMock:
    request = MagicMock()
    request.state.trace_id = TRACE
    return request


def _payload() -> CreateExtractionBatchRequest:
    return CreateExtractionBatchRequest(
        project_id=uuid4(), template_id=uuid4(), article_ids=[uuid4()]
    )


@pytest.mark.asyncio
async def test_start_commits_then_kicks(monkeypatch: pytest.MonkeyPatch) -> None:
    world = _World(monkeypatch)
    payload = _payload()

    response = await _start(_request(), payload, world.db, OWNER)

    assert world.calls == ["guard", "start", "commit", "kick"]
    assert world.started == [(OWNER, payload)]
    assert world.kicks == [(BATCH, False)]
    assert response.status_code == 202
    body = json.loads(response.body)
    assert body["ok"] is True
    assert body["trace_id"] == TRACE
    assert body["data"]["id"] == str(BATCH)


@pytest.mark.asyncio
async def test_start_queue_unavailable_is_503_without_commit(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    world = _World(monkeypatch, start_error=QueueUnavailableError())

    response = await _start(_request(), _payload(), world.db, OWNER)

    assert response.status_code == 503
    body = json.loads(response.body)
    assert body["error"]["code"] == "SERVICE_UNAVAILABLE"
    assert body["trace_id"] == TRACE
    world.db.commit.assert_not_awaited()
    assert world.kicks == []


@pytest.mark.asyncio
async def test_start_scope_error_is_400_without_commit(monkeypatch: pytest.MonkeyPatch) -> None:
    world = _World(monkeypatch, start_error=BatchScopeError("outside the project"))

    with pytest.raises(HTTPException) as exc:
        await _start(_request(), _payload(), world.db, OWNER)

    assert exc.value.status_code == 400
    world.db.commit.assert_not_awaited()
    assert world.kicks == []


@pytest.mark.asyncio
async def test_start_conflict_propagates_without_commit(monkeypatch: pytest.MonkeyPatch) -> None:
    active = uuid4()
    world = _World(monkeypatch, start_error=BatchAlreadyActiveError(active))

    with pytest.raises(BatchAlreadyActiveError) as exc:
        await _start(_request(), _payload(), world.db, OWNER)

    assert exc.value.status_code == 409
    assert exc.value.details == {"batch_id": str(active)}
    world.db.commit.assert_not_awaited()
    assert world.kicks == []


@pytest.mark.asyncio
async def test_cancel_commits_once(monkeypatch: pytest.MonkeyPatch) -> None:
    world = _World(monkeypatch)

    response = await _cancel(_request(), BATCH, world.db, OWNER)

    assert world.cancelled == [(OWNER, BATCH)]
    assert world.calls == ["cancel", "commit"]
    world.db.commit.assert_awaited_once()
    assert response.data.id == BATCH and response.trace_id == TRACE


@pytest.mark.asyncio
async def test_resume_queue_down_is_503_and_kicks_nothing(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    world = _World(monkeypatch)
    world.queue_up = False

    response = await _resume(_request(), BATCH, world.db, OWNER)

    assert response.status_code == 503
    assert world.kicks == []


@pytest.mark.asyncio
async def test_resume_kicks_with_reenqueue_stale(monkeypatch: pytest.MonkeyPatch) -> None:
    world = _World(monkeypatch)

    response = await _resume(_request(), BATCH, world.db, OWNER)

    assert world.kicks == [(BATCH, True)]
    assert response.data.id == BATCH and response.trace_id == TRACE
