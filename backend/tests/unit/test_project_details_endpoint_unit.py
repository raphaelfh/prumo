"""The PATCH /projects/{id}/details handler coroutine, called directly.

httpx ASGITransport registers no coverage for handler lines, so the gate
order and the single commit are driven here with patched collaborators;
``test_project_details_api`` covers the same route end to end.
"""

from __future__ import annotations

from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest
from fastapi import HTTPException

from app.api.v1.endpoints import project_details as pd
from app.schemas.project_details import ProjectDetailsRead, ProjectDetailsUpdate
from app.services.project_details_service import ProjectDetailsChange, StaleProjectValueError

#: The handler without ``@limiter.limit``'s wrapper, which refuses a non-starlette request.
_handler = pd.update_project_details.__wrapped__

_BODY = ProjectDetailsUpdate.model_validate(
    {"fields": {"description": "n"}, "expected": {"description": "o"}}
)
_DETAILS = ProjectDetailsRead(
    name="P",
    description="n",
    review_type=None,
    review_title=None,
    condition_studied=None,
    review_rationale=None,
    search_strategy=None,
    eligibility_criteria={},
    study_design={},
    review_keywords=[],
    review_context=None,
    updated_at=datetime(2026, 9, 24, tzinfo=UTC),
)


@pytest.fixture
def collaborators(monkeypatch: pytest.MonkeyPatch) -> SimpleNamespace:
    ns = SimpleNamespace(
        member=AsyncMock(return_value=True),
        manager=AsyncMock(return_value=True),
        update=AsyncMock(
            return_value=ProjectDetailsChange(
                before={"description": "o"}, after={"description": "n"}, details=_DETAILS
            )
        ),
        db=SimpleNamespace(commit=AsyncMock()),
    )
    monkeypatch.setattr(pd, "is_project_member", ns.member)
    monkeypatch.setattr(pd, "is_project_manager", ns.manager)
    monkeypatch.setattr(pd, "update_details", ns.update)
    return ns


async def _call(ns: SimpleNamespace, request: object | None = None) -> object:
    request = request or SimpleNamespace(state=SimpleNamespace(trace_id="t1"))
    return await _handler(uuid4(), _BODY, request, ns.db, uuid4())


@pytest.mark.asyncio
async def test_non_member_is_404_and_nothing_else_runs(collaborators: SimpleNamespace) -> None:
    collaborators.member.return_value = False

    with pytest.raises(HTTPException) as info:
        await _call(collaborators)

    assert info.value.status_code == 404
    collaborators.manager.assert_not_awaited()
    collaborators.update.assert_not_awaited()
    collaborators.db.commit.assert_not_awaited()


@pytest.mark.asyncio
async def test_member_non_manager_is_403(collaborators: SimpleNamespace) -> None:
    collaborators.manager.return_value = False

    with pytest.raises(HTTPException) as info:
        await _call(collaborators)

    assert info.value.status_code == 403
    collaborators.update.assert_not_awaited()
    collaborators.db.commit.assert_not_awaited()


@pytest.mark.asyncio
async def test_manager_commits_once_and_returns_details(collaborators: SimpleNamespace) -> None:
    res = await _call(collaborators)

    assert res.data == _DETAILS
    assert res.trace_id == "t1"
    collaborators.db.commit.assert_awaited_once()

    bare = await _call(collaborators, SimpleNamespace(state=SimpleNamespace()))
    assert bare.trace_id is None


@pytest.mark.asyncio
async def test_stale_value_propagates_without_commit(collaborators: SimpleNamespace) -> None:
    collaborators.update.side_effect = StaleProjectValueError(current={"description": "x"})

    with pytest.raises(StaleProjectValueError):
        await _call(collaborators)

    collaborators.db.commit.assert_not_awaited()
