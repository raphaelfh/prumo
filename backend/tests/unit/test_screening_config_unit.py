"""Screening config: pure helpers, schema bounds, and the handler coroutines called directly.

Handler lines driven through httpx ASGITransport register no coverage, so each
branch of the endpoints is called here with ``ScreeningConfigService`` patched.
"""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import pytest
from fastapi import HTTPException
from pydantic import ValidationError

from app.api.v1.endpoints import screening as endpoint
from app.schemas.screening import (
    ScreeningConfigRead,
    ScreeningConfigUpdate,
    ScreeningEnrollRequest,
    ScreeningEnrollResult,
)
from app.services.article_read_service import ArticleNotFoundError
from app.services.screening_config_service import ProjectNotFoundError
from app.services.screening_settings import reviewer_count_of

PROJECT = uuid4()
CALLER = uuid4()

_get = endpoint.get_screening_config.__wrapped__
_put = endpoint.put_screening_config.__wrapped__
_enroll = endpoint.enroll_screening.__wrapped__


def _config() -> ScreeningConfigRead:
    return ScreeningConfigRead(
        reviewer_count=2,
        reviewer_count_locked=False,
        full_text_reviewer_count=None,
        full_text_count_locked=False,
        full_text_ready=0,
        full_text_enrolled=0,
        reviewer_capable=3,
        enrolled=1,
        not_enrolled=2,
        can_manage=True,
        can_review=True,
        can_arbitrate=True,
        exclusion_reasons=[],
    )


@pytest.fixture
def service(monkeypatch: pytest.MonkeyPatch) -> MagicMock:
    instance = MagicMock()
    instance.read = AsyncMock(return_value=_config())
    instance.set_config = AsyncMock(return_value=_config())
    instance.enroll = AsyncMock(return_value=ScreeningEnrollResult(enrolled=3, already_enrolled=0))
    monkeypatch.setattr(endpoint, "ScreeningConfigService", MagicMock(return_value=instance))
    return instance


def _request() -> SimpleNamespace:
    return SimpleNamespace(state=SimpleNamespace(trace_id="trace-1"))


@pytest.mark.parametrize(
    ("settings", "expected"),
    [
        (None, None),
        ({}, None),
        ({"screening": {}}, None),
        ({"screening": {"reviewer_count": 2}}, 2),
        ({"screening": {"reviewer_count": 4}}, None),
        ({"screening": {"reviewer_count": "2"}}, None),
        ({"screening": {"reviewer_count": 1, "ai_visible": True}}, 1),
    ],
    ids=["none", "empty", "no-count", "two", "out-of-range", "string", "sibling-key"],
)
def test_reviewer_count_of(settings: dict | None, expected: int | None) -> None:
    assert reviewer_count_of(settings, "title_abstract") == expected


@pytest.mark.parametrize(
    ("settings", "phase", "expected"),
    [
        ({"screening": {"reviewer_count": 2, "full_text_reviewer_count": 1}}, "full_text", 1),
        ({"screening": {"reviewer_count": 2, "full_text_reviewer_count": 1}}, "title_abstract", 2),
        ({"screening": {"reviewer_count": 2}}, "full_text", None),
        ({"screening": {"full_text_reviewer_count": 4}}, "full_text", None),
        ({"screening": {"full_text_reviewer_count": True}}, "full_text", None),
    ],
    ids=["full-text-key", "title-abstract-key", "full-text-unset", "out-of-range", "bool"],
)
def test_reviewer_count_of_reads_the_phase_key(
    settings: dict, phase: str, expected: int | None
) -> None:
    assert reviewer_count_of(settings, phase) == expected  # type: ignore[arg-type]


@pytest.mark.parametrize("value", [0, 4])
def test_config_update_bounds(value: int) -> None:
    with pytest.raises(ValidationError):
        ScreeningConfigUpdate(reviewer_count=value)
    with pytest.raises(ValidationError):
        ScreeningConfigUpdate.model_validate({"reviewer_count": 2, "ai_visible": True})


def test_enroll_request_rejects_empty_list_and_extra_keys() -> None:
    with pytest.raises(ValidationError):
        ScreeningEnrollRequest(article_ids=[])
    with pytest.raises(ValidationError):
        ScreeningEnrollRequest.model_validate({"unknown": 1})


async def test_get_config_handler_returns_the_config(service: MagicMock) -> None:
    result = await _get(_request(), PROJECT, AsyncMock(), CALLER)

    assert result.ok is True
    assert result.data == _config()
    assert result.trace_id == "trace-1"
    service.read.assert_awaited_once_with(PROJECT, CALLER)


async def test_put_config_handler_commits_and_returns(service: MagicMock) -> None:
    db = AsyncMock()

    body = ScreeningConfigUpdate(reviewer_count=2, full_text_reviewer_count=1)

    result = await _put(_request(), PROJECT, body, db, CALLER)

    assert result.data == _config()
    service.set_config.assert_awaited_once_with(PROJECT, CALLER, body)
    db.commit.assert_awaited_once()


async def test_put_config_handler_missing_project_is_404(service: MagicMock) -> None:
    service.set_config.side_effect = ProjectNotFoundError()

    with pytest.raises(HTTPException) as exc:
        await _put(
            _request(), PROJECT, ScreeningConfigUpdate(reviewer_count=2), AsyncMock(), CALLER
        )

    assert exc.value.status_code == 404


async def test_enroll_handler_commits_and_returns(service: MagicMock) -> None:
    db = AsyncMock()

    result = await _enroll(_request(), PROJECT, db, ScreeningEnrollRequest(), CALLER)

    assert result.data == ScreeningEnrollResult(enrolled=3, already_enrolled=0)
    service.enroll.assert_awaited_once_with(PROJECT, CALLER, None, "title_abstract")
    db.commit.assert_awaited_once()


async def test_enroll_handler_passes_the_phase(service: MagicMock) -> None:
    await _enroll(
        _request(), PROJECT, AsyncMock(), ScreeningEnrollRequest(phase="full_text"), CALLER
    )

    service.enroll.assert_awaited_once_with(PROJECT, CALLER, None, "full_text")


def test_enroll_request_refuses_ids_at_full_text() -> None:
    with pytest.raises(ValidationError):
        ScreeningEnrollRequest(phase="full_text", article_ids=[uuid4()])
    assert ScreeningEnrollRequest(phase="full_text").article_ids is None


def test_update_distinguishes_absent_from_null_full_text_count() -> None:
    assert (
        "full_text_reviewer_count" not in ScreeningConfigUpdate(reviewer_count=2).model_fields_set
    )
    off = ScreeningConfigUpdate.model_validate(
        {"reviewer_count": 2, "full_text_reviewer_count": None}
    )
    assert off.full_text_reviewer_count is None
    assert "full_text_reviewer_count" in off.model_fields_set


async def test_enroll_handler_without_a_body_enrolls_all(service: MagicMock) -> None:
    await _enroll(_request(), PROJECT, AsyncMock(), None, CALLER)

    service.enroll.assert_awaited_once_with(PROJECT, CALLER, None, "title_abstract")


async def test_enroll_handler_foreign_article_is_404(service: MagicMock) -> None:
    service.enroll.side_effect = ArticleNotFoundError("nope")
    db = AsyncMock()

    with pytest.raises(HTTPException) as exc:
        await _enroll(
            _request(), PROJECT, db, ScreeningEnrollRequest(article_ids=[uuid4()]), CALLER
        )

    assert exc.value.status_code == 404
    db.commit.assert_not_awaited()


async def test_enroll_handler_missing_project_is_404(service: MagicMock) -> None:
    service.enroll.side_effect = ProjectNotFoundError()
    db = AsyncMock()

    with pytest.raises(HTTPException) as exc:
        await _enroll(_request(), PROJECT, db, ScreeningEnrollRequest(phase="full_text"), CALLER)

    assert exc.value.status_code == 404
    db.commit.assert_not_awaited()
