"""Screening records read: the wire shape, the config reasons, and the handler called directly.

Handler lines driven through httpx ASGITransport register no coverage, so the
records endpoint is called here with the service patched.
"""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock
from uuid import UUID, uuid4

import pytest

from app.api.v1.endpoints import screening as endpoint
from app.repositories.screening_repository import RecordSource
from app.schemas.screening import (
    ScreeningConfigRead,
    ScreeningPhase,
    ScreeningRecordRow,
    ScreeningRecordsRead,
)
from app.services import screening_review_service as module
from app.services.screening_outcome import Outcome
from app.services.screening_settings import ScreeningRoles
from app.utils.rate_limiter import limiter

PROJECT = uuid4()
CALLER = uuid4()

_WIRE_FIELDS = {
    "article_id",
    "assignment_id",
    "phase",
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
        request=request, project_id=PROJECT, db=MagicMock(), user_sub=CALLER, phase="title_abstract"
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
        request=request, project_id=PROJECT, db=MagicMock(), user_sub=CALLER, phase="full_text"
    )

    assert result.data is read
    service.records.assert_awaited_once_with(PROJECT, CALLER, "full_text")


async def test_records_handler_passes_no_phase(monkeypatch: pytest.MonkeyPatch) -> None:
    read = ScreeningRecordsRead(
        phase=None,
        reviewer_count=2,
        inclusion_criteria=[],
        exclusion_reasons=[],
        rows=[],
        removed_duplicate_ids=[uuid4()],
    )
    service = MagicMock()
    service.records = AsyncMock(return_value=read)
    monkeypatch.setattr(endpoint, "ScreeningReviewService", MagicMock(return_value=service))
    request = SimpleNamespace(state=SimpleNamespace(trace_id="trace-1"))

    result = await endpoint.get_screening_records.__wrapped__(
        request=request, project_id=PROJECT, db=MagicMock(), user_sub=CALLER, phase=None
    )

    assert result.ok
    assert result.data is read
    assert result.trace_id == "trace-1"
    service.records.assert_awaited_once_with(PROJECT, CALLER, None)


ART_A, ART_B = uuid4(), uuid4()
ROLES = ScreeningRoles(can_manage=False, can_review=True, can_arbitrate=False)


def _source(article_id: UUID) -> RecordSource:
    return RecordSource(
        article_id=article_id,
        assignment_id=None,
        title=f"T-{article_id}",
        authors=None,
        publication_year=None,
        journal_title=None,
        pmid=None,
        doi=None,
        ingestion_source=None,
        has_pdf=False,
    )


def _service(
    monkeypatch: pytest.MonkeyPatch,
    *,
    counts: dict[str, int | None],
    sources: dict[str, list[UUID]],
    removed: list[UUID] | None = None,
) -> module.ScreeningReviewService:
    """A service whose collaborators answer per phase: reviewer counts and record sources."""
    service = module.ScreeningReviewService(MagicMock())
    monkeypatch.setattr(
        service, "_reviewer_count", AsyncMock(side_effect=lambda _p, phase: counts[phase])
    )
    monkeypatch.setattr(module, "screening_roles", AsyncMock(return_value=ROLES))
    monkeypatch.setattr(module, "assignment_states", AsyncMock(return_value={}))
    monkeypatch.setattr(module, "load_inclusion_criteria", AsyncMock(return_value=["Adults"]))
    monkeypatch.setattr(module, "load_exclusion_reasons", AsyncMock(return_value=["Not ML"]))
    service.screening = MagicMock(
        record_rows=AsyncMock(side_effect=lambda **kw: [_source(a) for a in sources[kw["phase"]]]),
        removed_duplicate_ids=AsyncMock(return_value=removed or []),
    )
    return service


async def test_records_no_phase_merges_full_text_rows_and_lists_removed(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    removed = [uuid4()]
    service = _service(
        monkeypatch,
        counts={"title_abstract": 2, "full_text": 3},
        sources={"title_abstract": [ART_A, ART_B], "full_text": [ART_B]},
        removed=removed,
    )
    monkeypatch.setattr(
        service, "_title_abstract_outcomes", AsyncMock(return_value=(2, {ART_B: None}))
    )

    read = await service.records(PROJECT, CALLER, None)

    assert read.phase is None
    assert read.reviewer_count == 2
    assert [(r.article_id, r.phase, r.queue_rank) for r in read.rows] == [
        (ART_A, "title_abstract", 0),
        (ART_B, "full_text", 1),
    ]
    assert read.rows[1].ta_reviewer_count == 2
    assert read.removed_duplicate_ids == removed
    assert read.inclusion_criteria == ["Adults"]
    assert read.exclusion_reasons == ["Not ML"]


async def test_records_no_phase_full_text_off_keeps_ta_rows(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    removed = [uuid4()]
    service = _service(
        monkeypatch,
        counts={"title_abstract": 2, "full_text": None},
        sources={"title_abstract": [ART_A, ART_B]},
        removed=removed,
    )

    read = await service.records(PROJECT, CALLER, None)

    assert [(r.article_id, r.phase) for r in read.rows] == [
        (ART_A, "title_abstract"),
        (ART_B, "title_abstract"),
    ]
    assert read.removed_duplicate_ids == removed
    assert service.screening.record_rows.await_count == 1


async def test_records_phased_has_no_removed_ids(monkeypatch: pytest.MonkeyPatch) -> None:
    service = _service(
        monkeypatch, counts={"title_abstract": 2}, sources={"title_abstract": [ART_A]}
    )

    read = await service.records(PROJECT, CALLER, "title_abstract")

    assert read.phase == "title_abstract"
    assert [r.article_id for r in read.rows] == [ART_A]
    assert read.removed_duplicate_ids == []
    service.screening.removed_duplicate_ids.assert_not_awaited()


async def test_phase_rows_full_text_carries_the_title_abstract_outcome(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    service = _service(monkeypatch, counts={}, sources={"full_text": [ART_A]})
    outcome = Outcome(
        kind="consensus", decision="include", exclusion_reason=None, reasons_differ=False
    )
    ta = AsyncMock(return_value=(2, {ART_A: outcome}))
    monkeypatch.setattr(service, "_title_abstract_outcomes", ta)

    rows = await service._phase_rows(PROJECT, CALLER, "full_text", 3, ROLES)

    ta.assert_awaited_once_with(PROJECT)
    assert (rows[0].ta_outcome, rows[0].ta_outcome_kind, rows[0].ta_reviewer_count) == (
        "include",
        "consensus",
        2,
    )


async def test_phase_rows_title_abstract_skips_the_title_abstract_lookup(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    service = _service(monkeypatch, counts={}, sources={"title_abstract": [ART_A]})
    ta = AsyncMock()
    monkeypatch.setattr(service, "_title_abstract_outcomes", ta)

    rows = await service._phase_rows(PROJECT, CALLER, "title_abstract", 2, ROLES)

    ta.assert_not_awaited()
    assert rows[0].ta_outcome is None
    assert rows[0].ta_reviewer_count is None


def test_merge_phases_appends_a_full_text_row_without_a_title_abstract_row() -> None:
    ta_row = _row(ART_A, "title_abstract")
    ft_orphan = _row(ART_B, "full_text")

    merged = module._merge_phases([ta_row], [ft_orphan])

    assert [(r.article_id, r.queue_rank) for r in merged] == [(ART_A, 0), (ART_B, 1)]


def _row(article_id: UUID, phase: ScreeningPhase) -> ScreeningRecordRow:
    return module._record_row(0, phase, _source(article_id), None, CALLER, ROLES)
