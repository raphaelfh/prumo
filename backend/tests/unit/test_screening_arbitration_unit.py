"""Screening arbitration: the ruling body, and the arbitration handler called directly.

Handler lines driven through httpx ASGITransport register no coverage, so each
branch of the arbitration endpoints is called here with the service and guards patched.
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
    ScreeningArbitrationCreate,
    ScreeningArticle,
    ScreeningAssignmentRead,
    ScreeningAssignmentRef,
)
from app.services.screening_review_service import AssignmentNotFoundError, DecisionNotFoundError

PROJECT = uuid4()
CALLER = uuid4()
ASSIGNMENT = uuid4()
ARTICLE = uuid4()
D1 = uuid4()
D2 = uuid4()

_arbitrate = endpoint.post_screening_arbitration.__wrapped__


def _read() -> ScreeningAssignmentRead:
    return ScreeningAssignmentRead(
        id=ASSIGNMENT,
        project_id=PROJECT,
        article=ScreeningArticle(
            id=ARTICLE,
            title="T",
            abstract=None,
            authors=None,
            journal_title=None,
            publication_year=None,
            pmid=None,
            doi=None,
        ),
        status="decided",
        my_decision=None,
        outcome=None,
        peer_decisions=[],
        exclusion_reasons=["Not ML"],
    )


def _body() -> ScreeningArbitrationCreate:
    return ScreeningArbitrationCreate(ruled_on_decision_ids=[D1, D2], selected_decision_id=D2)


@pytest.fixture
def service(monkeypatch: pytest.MonkeyPatch) -> MagicMock:
    instance = MagicMock()
    instance.arbitrate = AsyncMock(return_value=_read())
    monkeypatch.setattr(endpoint, "ScreeningReviewService", MagicMock(return_value=instance))
    return instance


@pytest.fixture
def guards(monkeypatch: pytest.MonkeyPatch) -> SimpleNamespace:
    ref = ScreeningAssignmentRef(
        id=ASSIGNMENT, project_id=PROJECT, article_id=uuid4(), phase="title_abstract"
    )
    load = AsyncMock(return_value=ref)
    arbitrator = AsyncMock()
    monkeypatch.setattr(endpoint, "load_assignment_for_member", load)
    monkeypatch.setattr(endpoint, "ensure_project_arbitrator", arbitrator)
    return SimpleNamespace(load=load, arbitrator=arbitrator)


def _request() -> SimpleNamespace:
    return SimpleNamespace(state=SimpleNamespace(trace_id="trace-1"))


def test_exactly_one_of_selected_or_decision() -> None:
    with pytest.raises(ValidationError):
        ScreeningArbitrationCreate(ruled_on_decision_ids=[D1, D2])
    with pytest.raises(ValidationError):
        ScreeningArbitrationCreate(
            ruled_on_decision_ids=[D1, D2], selected_decision_id=D1, decision="include"
        )
    assert ScreeningArbitrationCreate(ruled_on_decision_ids=[D1], decision="maybe").decision == (
        "maybe"
    )


def test_selected_decision_must_be_ruled_on() -> None:
    with pytest.raises(ValidationError):
        ScreeningArbitrationCreate(ruled_on_decision_ids=[D1], selected_decision_id=D2)


def test_exclusion_reason_only_with_an_exclude_override() -> None:
    with pytest.raises(ValidationError):
        ScreeningArbitrationCreate(
            ruled_on_decision_ids=[D1], decision="include", exclusion_reason="Not ML"
        )
    with pytest.raises(ValidationError):
        ScreeningArbitrationCreate(
            ruled_on_decision_ids=[D1], selected_decision_id=D1, exclusion_reason="Not ML"
        )
    body = ScreeningArbitrationCreate(
        ruled_on_decision_ids=[D1], decision="exclude", exclusion_reason="Not ML"
    )
    assert body.exclusion_reason == "Not ML"


def test_ruled_on_ids_are_bounded_and_extra_fields_refused() -> None:
    with pytest.raises(ValidationError):
        ScreeningArbitrationCreate(ruled_on_decision_ids=[], decision="include")
    with pytest.raises(ValidationError):
        ScreeningArbitrationCreate(
            ruled_on_decision_ids=[uuid4() for _ in range(4)], decision="include"
        )
    with pytest.raises(ValidationError):
        ScreeningArbitrationCreate.model_validate(
            {"ruled_on_decision_ids": [str(D1)], "decision": "include", "decided_by": str(CALLER)}
        )


async def test_arbitration_handler_commits_and_returns(
    service: MagicMock, guards: SimpleNamespace
) -> None:
    db = AsyncMock()
    body = _body()

    result = await _arbitrate(_request(), ASSIGNMENT, body, db, CALLER)

    assert result.data == _read()
    guards.load.assert_awaited_once_with(db, ASSIGNMENT, CALLER)
    guards.arbitrator.assert_awaited_once_with(db, PROJECT, CALLER)
    service.arbitrate.assert_awaited_once_with(ASSIGNMENT, CALLER, body)
    db.commit.assert_awaited_once()


@pytest.mark.usefixtures("guards")
async def test_arbitration_handler_foreign_decision_is_404(service: MagicMock) -> None:
    service.arbitrate.side_effect = DecisionNotFoundError("Decision not found")
    db = AsyncMock()

    with pytest.raises(HTTPException) as exc:
        await _arbitrate(_request(), ASSIGNMENT, _body(), db, CALLER)

    assert exc.value.status_code == 404
    db.commit.assert_not_awaited()


@pytest.mark.usefixtures("guards")
async def test_arbitration_handler_missing_article_is_404(service: MagicMock) -> None:
    service.arbitrate.side_effect = AssignmentNotFoundError()
    db = AsyncMock()

    with pytest.raises(HTTPException) as exc:
        await _arbitrate(_request(), ASSIGNMENT, _body(), db, CALLER)

    assert exc.value.status_code == 404
    db.commit.assert_not_awaited()
