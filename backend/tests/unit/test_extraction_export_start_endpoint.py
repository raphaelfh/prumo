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

from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import pytest

from app.api.v1.endpoints.extraction_export import start_extraction_export
from app.schemas.extraction_export import (
    ExtractionExportMode,
    ExtractionExportRequest,
    ExtractionExportShape,
)
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


def _layout() -> MagicMock:
    layout = MagicMock()
    layout.articles = (MagicMock(),)
    layout.project_name = "P"
    layout.template_name = "T"
    layout.notes.generated_at = None
    return layout


async def _call_sync(
    payload: ExtractionExportRequest,
    *,
    articles: tuple = (MagicMock(),),
) -> tuple[MagicMock, object]:
    """Drive the sync branch; return (build_workbook mock, response)."""
    layout = _layout()
    layout.articles = articles
    service = MagicMock()
    service.assert_can_export = AsyncMock()
    service.resolve_layout = AsyncMock(return_value=layout)

    with (
        patch(f"{_EP}.ExtractionExportService", return_value=service),
        patch(f"{_EP}.create_storage_adapter", return_value=MagicMock()),
        patch(f"{_EP}.build_workbook", return_value=b"xlsx") as build,
    ):
        response = await _start(
            request=_request(),
            project_id=uuid4(),
            payload=payload,
            db=AsyncMock(),
            user=MagicMock(sub="user-1"),
            supabase=MagicMock(),
        )
    return build, response


async def _call_async(payload: ExtractionExportRequest) -> MagicMock:
    """Drive the Celery branch; return the patched ``.delay`` mock."""
    service = MagicMock()
    service.assert_can_export = AsyncMock()

    with (
        patch(f"{_EP}.ExtractionExportService", return_value=service),
        patch(f"{_EP}.create_storage_adapter", return_value=MagicMock()),
        patch(f"{_EP}._is_queue_available", return_value=True),
        patch(f"{_EP}._remember_export_owner"),
        patch(f"{_EP}.export_extraction_task") as task,
    ):
        task.delay.return_value = MagicMock(id="job-1")
        await _start(
            request=_request(),
            project_id=uuid4(),
            payload=payload,
            db=AsyncMock(),
            user=MagicMock(sub="user-1"),
            supabase=MagicMock(),
        )
    return task.delay


@pytest.mark.asyncio
async def test_sync_path_passes_the_requested_shape_to_the_builder() -> None:
    build, _ = await _call_sync(_payload(shape=ExtractionExportShape.PUBLICATION))
    assert build.call_args.args[1] is ExportShape.PUBLICATION


@pytest.mark.asyncio
async def test_sync_path_defaults_to_the_complete_workbook() -> None:
    build, _ = await _call_sync(_payload())
    assert build.call_args.args[1] is ExportShape.COMPLETE


@pytest.mark.asyncio
async def test_async_path_carries_the_shape_into_the_celery_kwargs() -> None:
    """all_users always queues — the QA export that would silently lose shape."""
    delay = await _call_async(
        _payload(
            mode=ExtractionExportMode.ALL_USERS,
            shape=ExtractionExportShape.DICTIONARY,
        )
    )
    assert delay.call_args.kwargs["shape"] == "dictionary"


@pytest.mark.asyncio
async def test_async_path_defaults_to_the_complete_workbook() -> None:
    delay = await _call_async(_payload(mode=ExtractionExportMode.ALL_USERS))
    assert delay.call_args.kwargs["shape"] == "complete"


# ---------------------------------------------------------------------------
# A dictionary-only export describes the INSTRUMENT, not the answers.
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_dictionary_export_runs_with_no_finalized_runs() -> None:
    """The field catalogue exists before anyone has assessed anything.

    Its three sheets (README, Data dictionary, Dropdown lists) are all built
    from ``layout.data_dictionary`` — the TEMPLATE snapshot — so gating them on
    eligible articles blocked the one export that is useful on day zero, while
    you are still wiring another tool to the template.
    """
    build, response = await _call_sync(
        _payload(shape=ExtractionExportShape.DICTIONARY), articles=()
    )

    assert response.status_code == 200
    assert build.call_args.args[1] is ExportShape.DICTIONARY


@pytest.mark.asyncio
async def test_complete_export_still_requires_eligible_articles() -> None:
    """The matrix and the tidy tables ARE the answers — an empty one is a lie."""
    build, response = await _call_sync(_payload(), articles=())

    assert response.status_code == 422
    build.assert_not_called()


@pytest.mark.asyncio
async def test_publication_export_still_requires_eligible_articles() -> None:
    build, response = await _call_sync(
        _payload(shape=ExtractionExportShape.PUBLICATION), articles=()
    )

    assert response.status_code == 422
    build.assert_not_called()
