"""Duplicates read: the wire shape, the rate limit, and the handler called directly.

Handler lines driven through httpx ASGITransport register no coverage, so the
endpoint coroutine is called here with the service patched.
"""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import pytest

from app.api.deps.security import require_project_manager
from app.api.v1.endpoints import duplicates as endpoint
from app.main import app
from app.schemas.duplicates import DuplicateSide, DuplicatesRead
from app.utils.rate_limiter import limiter

PROJECT = uuid4()
_ROUTE = "/api/v1/projects/{project_id}/duplicates"


def test_duplicate_side_has_the_compare_fields() -> None:
    assert set(DuplicateSide.model_fields) == {
        "article_id",
        "title",
        "authors",
        "publication_year",
        "journal_title",
        "doi",
        "pmid",
        "ingestion_source",
        "has_pdf",
        "has_abstract",
        "screening_decisions",
        "has_review_work",
    }


async def test_duplicates_handler_returns_the_read(monkeypatch: pytest.MonkeyPatch) -> None:
    read = DuplicatesRead(open=[], resolved=[])
    service = MagicMock()
    service.read = AsyncMock(return_value=read)
    monkeypatch.setattr(endpoint, "DuplicateService", MagicMock(return_value=service))
    request = SimpleNamespace(state=SimpleNamespace(trace_id="trace-1"))

    result = await endpoint.get_duplicates.__wrapped__(request, PROJECT, MagicMock())

    assert result.ok
    assert result.data is read
    assert result.trace_id == "trace-1"
    service.read.assert_awaited_once_with(PROJECT)


def test_duplicates_route_requires_a_manager() -> None:
    route = next(r for r in app.routes if getattr(r, "path", "") == _ROUTE)

    assert [d.dependency for d in route.dependencies] == [require_project_manager]


def test_duplicates_route_limit() -> None:
    limits = limiter._route_limits["app.api.v1.endpoints.duplicates.get_duplicates"]

    assert [str(limit.limit) for limit in limits] == ["60 per 1 minute"]
