"""Duplicates read: the wire shape, the rate limit, and the handler called directly.

Handler lines driven through httpx ASGITransport register no coverage, so the
endpoint coroutine is called here with the service patched.
"""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import pytest
from fastapi import HTTPException

from app.api.deps.security import require_project_manager
from app.api.v1.endpoints import duplicates as endpoint
from app.main import app
from app.schemas.common import ApiErrorCode
from app.schemas.duplicates import (
    DuplicateSide,
    DuplicatesRead,
    DuplicateVerdictCreate,
    DuplicateVerdictsCreate,
    DuplicateVerdictsResult,
)
from app.services.article_read_service import ArticleNotFoundError
from app.services.screening_config_service import ProjectNotFoundError
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


USER = uuid4()


def _body() -> DuplicateVerdictsCreate:
    return DuplicateVerdictsCreate(
        items=[
            DuplicateVerdictCreate(article_id=uuid4(), kept_article_id=uuid4(), verdict="duplicate")
        ]
    )


def _patched_service(monkeypatch: pytest.MonkeyPatch, **kwargs: object) -> MagicMock:
    service = MagicMock()
    service.write_verdicts = AsyncMock(**kwargs)
    monkeypatch.setattr(endpoint, "DuplicateService", MagicMock(return_value=service))
    return service


def test_verdicts_route_limit() -> None:
    limits = limiter._route_limits["app.api.v1.endpoints.duplicates.post_duplicate_verdicts"]

    assert [str(limit.limit) for limit in limits] == ["10 per 1 minute"]


async def test_verdicts_handler_commits_and_returns(monkeypatch: pytest.MonkeyPatch) -> None:
    result = DuplicateVerdictsResult(written=2, enrolled_kept=1)
    service = _patched_service(monkeypatch, return_value=result)
    db = MagicMock(commit=AsyncMock())
    body = _body()
    request = SimpleNamespace(state=SimpleNamespace(trace_id="trace-2"))

    response = await endpoint.post_duplicate_verdicts.__wrapped__(request, PROJECT, body, db, USER)

    assert response.ok
    assert response.data is result
    assert response.trace_id == "trace-2"
    service.write_verdicts.assert_awaited_once_with(PROJECT, USER, body.items)
    db.commit.assert_awaited_once()


@pytest.mark.parametrize(
    "error",
    [ArticleNotFoundError("Article x not found"), ProjectNotFoundError()],
    ids=["article", "project"],
)
async def test_verdicts_handler_maps_missing_to_404(
    monkeypatch: pytest.MonkeyPatch, error: Exception
) -> None:
    _patched_service(monkeypatch, side_effect=error)
    db = MagicMock(commit=AsyncMock())
    request = SimpleNamespace(state=SimpleNamespace(trace_id=None))

    with pytest.raises(HTTPException) as raised:
        await endpoint.post_duplicate_verdicts.__wrapped__(request, PROJECT, _body(), db, USER)

    assert raised.value.status_code == 404
    db.commit.assert_not_awaited()


def test_error_codes_exist() -> None:
    assert ApiErrorCode.DUPLICATE_HAS_REVIEW_WORK == "DUPLICATE_HAS_REVIEW_WORK"
    assert ApiErrorCode.DUPLICATE_KEPT_IS_REMOVED == "DUPLICATE_KEPT_IS_REMOVED"
