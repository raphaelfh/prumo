"""Screening review: the decision body, the scope signatures, and the handlers called directly.

Handler lines driven through httpx ASGITransport register no coverage, so each
branch of the review endpoints is called here with the service and guard patched.
"""

from __future__ import annotations

import inspect
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import pytest
from fastapi import HTTPException
from pydantic import ValidationError

from app.api.v1.endpoints import screening as endpoint
from app.repositories.screening_repository import ScreeningRepository
from app.schemas.screening import (
    ScreeningArticle,
    ScreeningAssignmentRead,
    ScreeningAssignmentRef,
    ScreeningDecisionCreate,
    ScreeningQueueRead,
)
from app.services.screening_review_service import AssignmentNotFoundError, assignment_states

PROJECT = uuid4()
CALLER = uuid4()
ASSIGNMENT = uuid4()
ARTICLE = uuid4()

_queue = endpoint.get_screening_queue.__wrapped__
_assignment = endpoint.get_screening_assignment.__wrapped__
_decide = endpoint.post_screening_decision.__wrapped__


def _article() -> ScreeningArticle:
    return ScreeningArticle(
        id=ARTICLE,
        title="T",
        abstract=None,
        authors=None,
        journal_title=None,
        publication_year=None,
        pmid=None,
        doi=None,
    )


def _read() -> ScreeningAssignmentRead:
    return ScreeningAssignmentRead(
        id=ASSIGNMENT,
        project_id=PROJECT,
        article=_article(),
        status="awaiting_me",
        my_decision=None,
        outcome=None,
        peer_decisions=[],
        exclusion_reasons=["Not ML"],
    )


def _queue_read() -> ScreeningQueueRead:
    return ScreeningQueueRead(items=[], awaiting_me=0, awaiting_others=0, exclusion_reasons=[])


@pytest.fixture
def service(monkeypatch: pytest.MonkeyPatch) -> MagicMock:
    instance = MagicMock()
    instance.queue = AsyncMock(return_value=_queue_read())
    instance.get_assignment = AsyncMock(return_value=_read())
    instance.decide = AsyncMock(return_value=_read())
    monkeypatch.setattr(endpoint, "ScreeningReviewService", MagicMock(return_value=instance))
    return instance


@pytest.fixture
def guards(monkeypatch: pytest.MonkeyPatch) -> SimpleNamespace:
    ref = ScreeningAssignmentRef(id=ASSIGNMENT, project_id=PROJECT, article_id=uuid4())
    load = AsyncMock(return_value=ref)
    reviewer = AsyncMock()
    monkeypatch.setattr(endpoint, "load_assignment_for_member", load)
    monkeypatch.setattr(endpoint, "ensure_project_reviewer", reviewer)
    return SimpleNamespace(load=load, reviewer=reviewer)


def _request() -> SimpleNamespace:
    return SimpleNamespace(state=SimpleNamespace(trace_id="trace-1"))


def test_reason_only_on_exclude() -> None:
    with pytest.raises(ValidationError):
        ScreeningDecisionCreate(decision="include", exclusion_reason="R1")
    assert ScreeningDecisionCreate(decision="exclude", exclusion_reason="R1").exclusion_reason == (
        "R1"
    )
    with pytest.raises(ValidationError):
        ScreeningDecisionCreate.model_validate({"decision": "include", "ai_suggestion_id": "x"})


@pytest.mark.parametrize(
    "method",
    [
        "live_assignment_ids",
        "current_decisions",
        "latest_rulings",
        "assignments_with_articles",
        "queue_page",
        "count_awaiting_me",
    ],
)
def test_screening_reads_require_a_project_scope(method: str) -> None:
    param = inspect.signature(getattr(ScreeningRepository, method)).parameters["project_id"]

    assert param.kind is inspect.Parameter.KEYWORD_ONLY
    assert param.default is inspect.Parameter.empty


def test_assignment_states_requires_a_project_scope() -> None:
    param = inspect.signature(assignment_states).parameters["project_id"]

    assert param.kind is inspect.Parameter.KEYWORD_ONLY
    assert param.default is inspect.Parameter.empty


async def test_queue_handler_returns_the_queue(service: MagicMock, guards: SimpleNamespace) -> None:
    db = AsyncMock()

    result = await _queue(_request(), PROJECT, db, CALLER)

    assert result.ok is True
    assert result.data == _queue_read()
    assert result.trace_id == "trace-1"
    guards.reviewer.assert_awaited_once_with(db, PROJECT, CALLER)
    service.queue.assert_awaited_once_with(PROJECT, CALLER)


async def test_assignment_handler_returns_the_assignment(
    service: MagicMock, guards: SimpleNamespace
) -> None:
    db = AsyncMock()

    result = await _assignment(_request(), ASSIGNMENT, db, CALLER)

    assert result.data == _read()
    guards.load.assert_awaited_once_with(db, ASSIGNMENT, CALLER)
    service.get_assignment.assert_awaited_once_with(ASSIGNMENT, CALLER)


@pytest.mark.usefixtures("guards")
async def test_assignment_handler_missing_article_is_404(service: MagicMock) -> None:
    service.get_assignment.side_effect = AssignmentNotFoundError()

    with pytest.raises(HTTPException) as exc:
        await _assignment(_request(), ASSIGNMENT, AsyncMock(), CALLER)

    assert exc.value.status_code == 404


async def test_decision_handler_commits_and_returns(
    service: MagicMock, guards: SimpleNamespace
) -> None:
    db = AsyncMock()
    body = ScreeningDecisionCreate(decision="include")

    result = await _decide(_request(), ASSIGNMENT, body, db, CALLER)

    assert result.data == _read()
    guards.reviewer.assert_awaited_once_with(db, PROJECT, CALLER)
    service.decide.assert_awaited_once_with(ASSIGNMENT, CALLER, body)
    db.commit.assert_awaited_once()


@pytest.mark.usefixtures("guards")
async def test_decision_handler_missing_article_is_404(service: MagicMock) -> None:
    service.decide.side_effect = AssignmentNotFoundError()
    db = AsyncMock()

    with pytest.raises(HTTPException) as exc:
        await _decide(_request(), ASSIGNMENT, ScreeningDecisionCreate(decision="maybe"), db, CALLER)

    assert exc.value.status_code == 404
    db.commit.assert_not_awaited()
