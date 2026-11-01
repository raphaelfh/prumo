"""Screening records read: the wire shape, the config reasons, and the handler called directly.

Handler lines driven through httpx ASGITransport register no coverage, so the
records endpoint is called here with the service patched.
"""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import pytest

from app.api.v1.endpoints import screening as endpoint
from app.schemas.screening import ScreeningConfigRead, ScreeningRecordRow, ScreeningRecordsRead
from app.utils.rate_limiter import limiter

PROJECT = uuid4()
CALLER = uuid4()

_WIRE_FIELDS = {
    "article_id",
    "assignment_id",
    "queue_rank",
    "title",
    "first_author",
    "publication_year",
    "journal_title",
    "pmid",
    "doi",
    "ingestion_source",
    "has_pdf",
    "status",
    "my_decision",
    "my_exclusion_reason",
    "outcome",
    "outcome_exclusion_reason",
    "outcome_kind",
    "ta_outcome",
    "ta_outcome_kind",
    "ta_reviewer_count",
}


def test_record_row_has_exactly_the_wire_fields() -> None:
    fields = set(ScreeningRecordRow.model_fields)

    assert fields == _WIRE_FIELDS
    assert "abstract" not in fields


def test_config_read_carries_exclusion_reasons() -> None:
    assert ScreeningConfigRead.model_fields["exclusion_reasons"].annotation == list[str]


async def test_records_handler_returns_the_read(monkeypatch: pytest.MonkeyPatch) -> None:
    read = ScreeningRecordsRead(
        phase="title_abstract",
        reviewer_count=2,
        inclusion_criteria=["Adults"],
        exclusion_reasons=["Not ML"],
        rows=[],
    )
    service = MagicMock()
    service.records = AsyncMock(return_value=read)
    monkeypatch.setattr(endpoint, "ScreeningReviewService", MagicMock(return_value=service))
    request = SimpleNamespace(state=SimpleNamespace(trace_id="trace-1"))

    result = await endpoint.get_screening_records.__wrapped__(
        request, PROJECT, "title_abstract", MagicMock(), CALLER
    )

    assert result.ok
    assert result.data is read
    service.records.assert_awaited_once_with(PROJECT, CALLER, "title_abstract")


def test_records_route_is_limited_to_120_per_minute() -> None:
    limits = limiter._route_limits["app.api.v1.endpoints.screening.get_screening_records"]

    assert [str(limit.limit) for limit in limits] == ["120 per 1 minute"]


async def test_records_handler_passes_full_text(monkeypatch: pytest.MonkeyPatch) -> None:
    read = ScreeningRecordsRead(
        phase="full_text", reviewer_count=2, inclusion_criteria=[], exclusion_reasons=[], rows=[]
    )
    service = MagicMock()
    service.records = AsyncMock(return_value=read)
    monkeypatch.setattr(endpoint, "ScreeningReviewService", MagicMock(return_value=service))
    request = SimpleNamespace(state=SimpleNamespace(trace_id="trace-1"))

    result = await endpoint.get_screening_records.__wrapped__(
        request, PROJECT, "full_text", MagicMock(), CALLER
    )

    assert result.data is read
    service.records.assert_awaited_once_with(PROJECT, CALLER, "full_text")
