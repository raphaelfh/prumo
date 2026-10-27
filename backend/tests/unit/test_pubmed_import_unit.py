"""PubMed import: the pure helpers, the request schema and the handler coroutines.

The handlers are called directly (``__wrapped__`` strips ``@limiter.limit``):
lines driven through httpx ASGITransport register no coverage, so every
branch, the success paths included, needs a direct call. The service and
the Celery task are faked; ``tests/integration/test_pubmed_import.py``
drives them unmocked.
"""

from __future__ import annotations

from datetime import UTC, datetime
from types import SimpleNamespace
from typing import Any
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import pytest
from fastapi import HTTPException, Response, status
from pydantic import ValidationError

from app.api.v1.endpoints import pubmed_import
from app.core.error_handler import AppError
from app.schemas.pubmed_import import (
    ImportRunRead,
    PubmedDryRunRead,
    PubmedImportRequest,
)
from app.services.pubmed_import_service import (
    ImportQueueUnavailableError,
    ImportRunNotFoundError,
    NcbiEmailMissingError,
    run_counts,
)

_import = pubmed_import.import_pubmed.__wrapped__
_poll = pubmed_import.get_import_run.__wrapped__

PROJECT = uuid4()
CALLER = uuid4()
RUN = uuid4()


def test_run_counts_mapping() -> None:
    assert run_counts(
        {"inserted": 3, "updated": 1, "duplicate_in_request": 2, "not_found": 1, "failed": 1},
        total_received=8,
    ) == {"total_received": 8, "persisted": 3, "updated": 1, "skipped": 2, "failed": 2}


def test_run_counts_of_an_empty_run_is_zero() -> None:
    assert run_counts({}, total_received=0) == {
        "total_received": 0,
        "persisted": 0,
        "updated": 0,
        "skipped": 0,
        "failed": 0,
    }


@pytest.mark.parametrize(
    "pmids",
    [[], ["12a"], ["1" * 11], [str(i) for i in range(1, 10_002)]],
    ids=["empty", "non-digit", "too-long", "over-10000"],
)
def test_request_rejects(pmids: list[str]) -> None:
    with pytest.raises(ValidationError):
        PubmedImportRequest(pmids=pmids)


def test_request_forbids_unknown_fields() -> None:
    with pytest.raises(ValidationError):
        PubmedImportRequest.model_validate({"pmids": ["1"], "source": "x"})


def test_queue_unavailable_is_a_503_app_error() -> None:
    err = ImportQueueUnavailableError()
    assert (err.status_code, err.code) == (503, "SERVICE_UNAVAILABLE")
    assert isinstance(err, AppError)


def test_missing_ncbi_email_is_a_503_app_error() -> None:
    err = NcbiEmailMissingError()
    assert (err.status_code, err.code) == (503, "NCBI_EMAIL_NOT_CONFIGURED")
    assert err.message == "PubMed import is not configured on this server."


# ---------------------------------------------------------------------------
# Handler coroutines
# ---------------------------------------------------------------------------


def _request(trace_id: str | None = "trace-1") -> Any:
    state = SimpleNamespace() if trace_id is None else SimpleNamespace(trace_id=trace_id)
    return SimpleNamespace(state=state)


class _Harness:
    """The fakes one handler call sees, recording the order of side effects."""

    def __init__(self, monkeypatch: pytest.MonkeyPatch) -> None:
        self.order: list[str] = []
        self.db = SimpleNamespace(commit=AsyncMock(side_effect=lambda: self.order.append("commit")))
        self.service = SimpleNamespace(
            dry_run=AsyncMock(),
            start=AsyncMock(return_value=RUN),
            mark_failed=AsyncMock(side_effect=lambda **_: self.order.append("mark_failed")),
            get_run=AsyncMock(),
        )
        self.delay = MagicMock(side_effect=lambda **_: self.order.append("delay"))
        monkeypatch.setattr(pubmed_import, "PubmedImportService", lambda _db: self.service)
        monkeypatch.setattr(pubmed_import, "import_pubmed_task", SimpleNamespace(delay=self.delay))

    async def post(self, body: PubmedImportRequest, response: Response) -> Any:
        return await _import(
            request=_request(),
            response=response,
            project_id=PROJECT,
            body=body,
            db=self.db,
            user_sub=CALLER,
        )


@pytest.fixture
def harness(monkeypatch: pytest.MonkeyPatch) -> _Harness:
    return _Harness(monkeypatch)


async def test_handler_dry_run_returns_counts(harness: _Harness) -> None:
    counts = PubmedDryRunRead(
        kind="dry_run", received=3, distinct=2, duplicate_in_request=1, already_in_project=1, new=1
    )
    harness.service.dry_run.return_value = counts
    response = Response(status_code=status.HTTP_202_ACCEPTED)

    envelope = await harness.post(
        PubmedImportRequest(pmids=["1", "2", "2"], dry_run=True), response
    )

    assert response.status_code == 200
    assert envelope.ok is True
    assert envelope.data.kind == "dry_run"
    assert envelope.data == counts
    assert envelope.trace_id == "trace-1"
    harness.service.dry_run.assert_awaited_once_with(PROJECT, ["1", "2", "2"])
    harness.service.start.assert_not_awaited()
    harness.delay.assert_not_called()


async def test_handler_started_is_202(harness: _Harness) -> None:
    response = Response(status_code=status.HTTP_202_ACCEPTED)

    envelope = await harness.post(PubmedImportRequest(pmids=["42908551"]), response)

    assert response.status_code == 202
    assert envelope.data.kind == "started"
    assert envelope.data.sync_run_id == RUN
    assert envelope.data.status == "pending"
    harness.service.start.assert_awaited_once_with(PROJECT, CALLER)
    assert harness.order == ["commit", "delay"]
    harness.delay.assert_called_once_with(
        project_id=str(PROJECT), sync_run_id=str(RUN), pmids=["42908551"], trace_id="trace-1"
    )


async def test_handler_queue_unavailable_propagates(harness: _Harness) -> None:
    harness.service.start.side_effect = ImportQueueUnavailableError()

    with pytest.raises(ImportQueueUnavailableError):
        await harness.post(PubmedImportRequest(pmids=["1"]), Response())

    harness.db.commit.assert_not_awaited()
    harness.delay.assert_not_called()


async def test_handler_failed_enqueue_marks_run_failed(harness: _Harness) -> None:
    def broken_delay(**_: Any) -> None:
        harness.order.append("delay")
        raise ConnectionError("broker down")

    harness.delay.side_effect = broken_delay

    with pytest.raises(ImportQueueUnavailableError):
        await harness.post(PubmedImportRequest(pmids=["1"]), Response())

    harness.service.mark_failed.assert_awaited_once_with(project_id=PROJECT, sync_run_id=RUN)
    assert harness.order == ["commit", "delay", "mark_failed", "commit"]


async def test_poll_handler_returns_the_run(harness: _Harness) -> None:
    run = ImportRunRead(
        sync_run_id=RUN,
        source="pubmed",
        status="running",
        total_received=5,
        persisted=2,
        updated=0,
        unchanged=1,
        skipped=1,
        failed=0,
        not_found=0,
        fetch_failed=0,
        error_code=None,
        started_at=datetime(2026, 10, 23, tzinfo=UTC),
        completed_at=None,
    )
    harness.service.get_run.return_value = run

    envelope = await _poll(
        request=_request(None),
        project_id=PROJECT,
        sync_run_id=RUN,
        db=harness.db,
        user_sub=CALLER,
    )

    assert envelope.ok is True
    assert envelope.data == run
    assert envelope.trace_id is None
    harness.service.get_run.assert_awaited_once_with(
        project_id=PROJECT, requester_id=CALLER, sync_run_id=RUN
    )


async def test_poll_handler_missing_run_is_404(harness: _Harness) -> None:
    harness.service.get_run.side_effect = ImportRunNotFoundError()

    with pytest.raises(HTTPException) as exc_info:
        await _poll(
            request=_request(),
            project_id=PROJECT,
            sync_run_id=RUN,
            db=harness.db,
            user_sub=CALLER,
        )

    assert exc_info.value.status_code == 404
