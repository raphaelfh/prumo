"""Direct endpoint-coroutine unit tests for the archive endpoint.

The auth gate is a ``Depends(...)`` — resolved by FastAPI, never called in the
handler body — so role enforcement is asserted in the integration suite
(manager writes, reviewer 403, outsider 403, unknown project 403).
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import pytest
from fastapi import HTTPException

from app.api.v1.endpoints.project_archive import set_archived
from app.schemas.project_archive import ProjectArchiveUpdate
from app.services.project_archive import ProjectNotFoundError

_EP = "app.api.v1.endpoints.project_archive"

_patch = getattr(set_archived, "__wrapped__", set_archived)


def _request() -> MagicMock:
    request = MagicMock()
    request.state.trace_id = "trace-archive"
    return request


@pytest.mark.asyncio
async def test_archiving_forwards_the_flag_and_commits() -> None:
    db = AsyncMock()
    pid = uuid4()

    with patch(
        f"{_EP}.set_project_archived",
        AsyncMock(return_value={"id": pid, "is_active": False}),
    ) as svc:
        res = await _patch(
            project_id=pid,
            body=ProjectArchiveUpdate(archived=True),
            request=_request(),
            db=db,
        )

    assert svc.await_args.args[1] == pid
    # Named kwarg, so a future reorder cannot silently invert the transition.
    assert svc.await_args.kwargs["archived"] is True
    db.commit.assert_awaited_once()
    assert res.ok is True
    assert res.trace_id == "trace-archive"
    assert res.data.is_active is False


@pytest.mark.asyncio
async def test_restoring_forwards_the_opposite_flag() -> None:
    with patch(
        f"{_EP}.set_project_archived",
        AsyncMock(return_value={"id": (pid := uuid4()), "is_active": True}),
    ) as svc:
        res = await _patch(
            project_id=pid,
            body=ProjectArchiveUpdate(archived=False),
            request=_request(),
            db=AsyncMock(),
        )

    assert svc.await_args.kwargs["archived"] is False
    assert res.data.is_active is True


@pytest.mark.asyncio
async def test_a_missing_project_is_404_and_does_not_commit() -> None:
    db = AsyncMock()

    with (
        patch(
            f"{_EP}.set_project_archived",
            AsyncMock(side_effect=ProjectNotFoundError("gone")),
        ),
        pytest.raises(HTTPException) as exc,
    ):
        await _patch(
            project_id=uuid4(),
            body=ProjectArchiveUpdate(archived=True),
            request=_request(),
            db=db,
        )

    assert exc.value.status_code == 404
    db.commit.assert_not_awaited()
