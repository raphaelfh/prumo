"""The DELETE /projects/{id} handler coroutine, called directly.

httpx ASGITransport registers no coverage for handler lines, so the gate
order and the single commit are driven here with patched collaborators;
``test_project_delete_api`` covers the same route end to end.
"""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest
from fastapi import HTTPException

from app.api.v1.endpoints import project_delete as pdel
from app.core.error_handler import NotFoundError

#: The handler without ``@limiter.limit``'s wrapper, which refuses a non-starlette request.
_handler = pdel.delete_project.__wrapped__


@pytest.fixture
def collaborators(monkeypatch: pytest.MonkeyPatch) -> SimpleNamespace:
    ns = SimpleNamespace(
        member=AsyncMock(return_value=True),
        manager=AsyncMock(return_value=True),
        delete=AsyncMock(return_value=None),
        db=SimpleNamespace(commit=AsyncMock()),
    )
    monkeypatch.setattr(pdel, "is_project_member", ns.member)
    monkeypatch.setattr(pdel, "is_project_manager", ns.manager)
    monkeypatch.setattr(pdel, "delete_project_row", ns.delete)
    return ns


@pytest.mark.asyncio
async def test_non_member_is_404_and_nothing_else_runs(collaborators: SimpleNamespace) -> None:
    collaborators.member.return_value = False

    with pytest.raises(HTTPException) as info:
        await _handler(uuid4(), SimpleNamespace(state=SimpleNamespace()), collaborators.db, uuid4())

    assert info.value.status_code == 404
    collaborators.manager.assert_not_awaited()
    collaborators.delete.assert_not_awaited()
    collaborators.db.commit.assert_not_awaited()


@pytest.mark.asyncio
async def test_member_non_manager_is_403(collaborators: SimpleNamespace) -> None:
    collaborators.manager.return_value = False

    with pytest.raises(HTTPException) as info:
        await _handler(uuid4(), SimpleNamespace(state=SimpleNamespace()), collaborators.db, uuid4())

    assert info.value.status_code == 403
    collaborators.delete.assert_not_awaited()
    collaborators.db.commit.assert_not_awaited()


@pytest.mark.asyncio
async def test_manager_commits_once_and_echoes_the_id(collaborators: SimpleNamespace) -> None:
    pid = uuid4()

    res = await _handler(
        pid, SimpleNamespace(state=SimpleNamespace(trace_id="t1")), collaborators.db, uuid4()
    )

    assert res.data.id == pid
    assert res.trace_id == "t1"
    collaborators.delete.assert_awaited_once_with(collaborators.db, pid)
    collaborators.db.commit.assert_awaited_once()


@pytest.mark.asyncio
async def test_row_gone_between_gate_and_delete_propagates_without_commit(
    collaborators: SimpleNamespace,
) -> None:
    collaborators.delete.side_effect = NotFoundError("Project")

    with pytest.raises(NotFoundError):
        await _handler(uuid4(), SimpleNamespace(state=SimpleNamespace()), collaborators.db, uuid4())

    collaborators.db.commit.assert_not_awaited()
