"""``start_extraction_export`` — the shape passthrough, on both dispatch paths.

The coroutine is called DIRECTLY rather than through httpx: handler lines
executed via the ASGI transport do not register on coverage (this repo's
diff-cover blind spot), so an integration hit would leave the passthrough
uncovered. ``__wrapped__`` unwraps slowapi's ``@limiter.limit`` decorator,
which needs a real ``Request``.

The async branch is the one that matters most: ``_should_run_sync`` sends
all-users, AI-metadata and >50-article exports to Celery — all ordinary
quality-assessment cases — so a shape that only reached the sync path would
silently produce a complete workbook for most QA exports.
"""

from __future__ import annotations

import json
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import pytest

from app.api.v1.endpoints.extraction_export import start_extraction_export
from app.core.error_handler import AuthorizationError, NotFoundError, ValidationError
from app.schemas.extraction_export import (
    ExtractionExportMode,
    ExtractionExportRequest,
    ExtractionExportShape,
)
from app.services.exports.extraction.run import EmptyExportError, ExportFile
from app.services.exports.extraction.workbook import ExportShape

_EP = "app.api.v1.endpoints.extraction_export"

_start = getattr(start_extraction_export, "__wrapped__", start_extraction_export)


def _request() -> MagicMock:
    request = MagicMock()
    request.headers = {"x-trace-id": "trace-export"}
    return request


def _payload(**overrides) -> ExtractionExportRequest:
    return ExtractionExportRequest(
        template_id=uuid4(),
        article_ids=[uuid4()],
        **overrides,
    )


async def _call_sync(
    payload: ExtractionExportRequest,
    *,
    build_side_effect: Exception | None = None,
) -> tuple[MagicMock, object]:
    """Drive the sync branch; return (build_export mock, response)."""
    with (
        patch(f"{_EP}.authorize_export", new=AsyncMock()),
        patch(
            f"{_EP}.build_export",
            new=AsyncMock(
                return_value=ExportFile(b"xlsx", "f.xlsx"), side_effect=build_side_effect
            ),
        ) as build,
    ):
        response = await _start(
            request=_request(),
            project_id=uuid4(),
            payload=payload,
            db=AsyncMock(),
            user=MagicMock(sub="user-1"),
        )
    return build, response


async def _call_async(payload: ExtractionExportRequest) -> tuple[MagicMock, object]:
    """Drive the Celery branch; return (patched ``.delay`` mock, response)."""
    with (
        patch(f"{_EP}.authorize_export", new=AsyncMock()),
        patch("app.worker.queue_health.is_queue_available", return_value=True),
        patch(f"{_EP}._remember_export_owner"),
        patch(f"{_EP}.export_extraction_task") as task,
    ):
        task.delay.return_value = MagicMock(id="job-1")
        response = await _start(
            request=_request(),
            project_id=uuid4(),
            payload=payload,
            db=AsyncMock(),
            user=MagicMock(sub="user-1"),
        )
    return task.delay, response


async def _call_refused(payload: ExtractionExportRequest, exc: Exception) -> tuple:
    """``authorize_export`` raises; return (build mock, delay mock, response)."""
    with (
        patch(f"{_EP}.authorize_export", new=AsyncMock(side_effect=exc)),
        patch(f"{_EP}.build_export", new=AsyncMock()) as build,
        patch("app.worker.queue_health.is_queue_available", return_value=True),
        patch(f"{_EP}.export_extraction_task") as task,
    ):
        response = await _start(
            request=_request(),
            project_id=uuid4(),
            payload=payload,
            db=AsyncMock(),
            user=MagicMock(sub="user-1"),
        )
    return build, task.delay, response


def _error(response) -> dict:
    return json.loads(response.body)["error"]


@pytest.mark.asyncio
async def test_sync_path_passes_the_requested_shape_to_the_builder() -> None:
    build, _ = await _call_sync(_payload(shape=ExtractionExportShape.PUBLICATION))
    assert build.call_args.args[1].shape is ExportShape.PUBLICATION


@pytest.mark.asyncio
async def test_sync_path_defaults_to_the_complete_workbook() -> None:
    build, _ = await _call_sync(_payload())
    assert build.call_args.args[1].shape is ExportShape.COMPLETE


@pytest.mark.asyncio
async def test_sync_path_returns_the_file_with_its_disposition() -> None:
    _, response = await _call_sync(_payload())
    assert response.status_code == 200
    assert response.body == b"xlsx"
    assert response.headers["content-disposition"] == 'attachment; filename="f.xlsx"'
    assert response.headers["x-trace-id"] == "trace-export"
    assert "access-control-expose-headers" not in response.headers


@pytest.mark.asyncio
async def test_async_path_carries_the_shape_into_the_celery_kwargs() -> None:
    """all_users always queues — the QA export that would silently lose shape."""
    delay, response = await _call_async(
        _payload(
            mode=ExtractionExportMode.ALL_USERS,
            shape=ExtractionExportShape.DICTIONARY,
        )
    )
    assert response.status_code == 202
    assert delay.call_args.kwargs["shape"] == "dictionary"


@pytest.mark.asyncio
async def test_async_path_defaults_to_the_complete_workbook() -> None:
    delay, _ = await _call_async(_payload(mode=ExtractionExportMode.ALL_USERS))
    assert delay.call_args.kwargs["shape"] == "complete"


# ---------------------------------------------------------------------------
# authorize_export runs before the sync/async split.
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("exc", "status_code", "code"),
    [
        (AuthorizationError("not a member"), 403, "FORBIDDEN"),
        (NotFoundError("Article"), 404, "NOT_FOUND"),
        (
            ValidationError("reviewer_id is required when mode=single_user."),
            400,
            "VALIDATION_ERROR",
        ),
    ],
    ids=["forbidden", "not_found", "validation"],
)
@pytest.mark.parametrize(
    "mode",
    [ExtractionExportMode.CONSENSUS, ExtractionExportMode.ALL_USERS],
    ids=["sync", "async"],
)
async def test_authorize_refusal_maps_to_its_status_on_both_paths(
    exc: Exception, status_code: int, code: str, mode: ExtractionExportMode
) -> None:
    build, delay, response = await _call_refused(_payload(mode=mode), exc)
    assert response.status_code == status_code
    assert _error(response)["code"] == code
    build.assert_not_awaited()
    delay.assert_not_called()


# ---------------------------------------------------------------------------
# An article-reading shape with no eligible articles is refused.
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_empty_export_is_422_with_the_stable_code() -> None:
    _, response = await _call_sync(_payload(), build_side_effect=EmptyExportError())
    assert response.status_code == 422
    error = _error(response)
    assert error["code"] == "EMPTY_ELIGIBLE_ARTICLES"
    assert error["message"].startswith("EMPTY_ELIGIBLE_ARTICLES: ")
