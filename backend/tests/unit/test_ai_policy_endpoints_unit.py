"""Direct endpoint-coroutine unit tests for the ai-policy endpoints.

The ASGI transport's handler lines do not register on coverage, so the
coroutines are called directly with the service patched in the endpoint
module's namespace. Role enforcement (``Depends``) is asserted in
``tests/integration/test_ai_policy_api.py``.
"""

from __future__ import annotations

from datetime import UTC, datetime
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import pytest
from fastapi import HTTPException

from app.api.v1.endpoints.ai_policy import read_ai_policy, update_ai_policy
from app.schemas.ai_policy import AiPolicyStored, AiPolicyUpdateRequest
from app.services.ai_policy_service import ProjectNotFoundError

_EP = "app.api.v1.endpoints.ai_policy"

_get = getattr(read_ai_policy, "__wrapped__", read_ai_policy)
_put = getattr(update_ai_policy, "__wrapped__", update_ai_policy)


def _request() -> MagicMock:
    request = MagicMock()
    request.state.trace_id = "trace-ai-policy"
    return request


@pytest.mark.asyncio
async def test_get_wraps_the_stored_policy_in_the_envelope() -> None:
    stored = AiPolicyStored(agent_runs="managers", max_articles_per_run=7)
    with patch(f"{_EP}.ai_policy_service.read", AsyncMock(return_value=stored)) as svc:
        res = await _get(project_id=(pid := uuid4()), request=_request(), db=AsyncMock())

    assert res.ok is True
    assert res.trace_id == "trace-ai-policy"
    assert res.data.agent_runs == "managers"
    assert res.data.max_articles_per_run == 7
    assert res.data.daily_agent_article_cap == 100
    assert svc.await_args.args[1] == pid


@pytest.mark.asyncio
async def test_get_maps_a_missing_project_to_404() -> None:
    with (
        patch(f"{_EP}.ai_policy_service.read", AsyncMock(side_effect=ProjectNotFoundError("x"))),
        pytest.raises(HTTPException) as exc,
    ):
        await _get(project_id=uuid4(), request=_request(), db=AsyncMock())

    assert exc.value.status_code == 404


@pytest.mark.asyncio
async def test_put_writes_as_the_manager_commits_and_returns_the_stored_policy() -> None:
    manager, pid = uuid4(), uuid4()
    body = AiPolicyUpdateRequest(
        agent_runs="reviewers", max_articles_per_run=10, daily_agent_article_cap=50
    )
    stored = AiPolicyStored(
        agent_runs="reviewers",
        max_articles_per_run=10,
        daily_agent_article_cap=50,
        updated_by=manager,
        updated_at=datetime(2026, 10, 18, tzinfo=UTC),
    )
    db = AsyncMock()
    with patch(f"{_EP}.ai_policy_service.set_for_project", AsyncMock(return_value=stored)) as svc:
        res = await _put(project_id=pid, body=body, request=_request(), db=db, manager=manager)

    assert svc.await_args.kwargs == {"project_id": pid, "update": body, "user_id": manager}
    db.commit.assert_awaited_once()
    assert res.data.agent_runs == "reviewers"
    assert res.data.updated_by == manager
    assert res.trace_id == "trace-ai-policy"


@pytest.mark.asyncio
async def test_put_maps_a_missing_project_to_404_without_committing() -> None:
    body = AiPolicyUpdateRequest(
        agent_runs="off", max_articles_per_run=1, daily_agent_article_cap=1
    )
    db = AsyncMock()
    with (
        patch(
            f"{_EP}.ai_policy_service.set_for_project",
            AsyncMock(side_effect=ProjectNotFoundError("x")),
        ),
        pytest.raises(HTTPException) as exc,
    ):
        await _put(project_id=uuid4(), body=body, request=_request(), db=db, manager=uuid4())

    assert exc.value.status_code == 404
    db.commit.assert_not_awaited()
