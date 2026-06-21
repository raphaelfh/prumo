"""Unit tests for ArticleFileService + the article-file endpoint handlers.

These call the service methods and the endpoint coroutines directly (with
mocked collaborators) so every branch — including the error paths the
integration tests cannot exercise through the ASGI transport — is covered.
"""

from datetime import UTC, datetime
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import pytest
from fastapi import HTTPException

from app.api.v1.endpoints.article_files import (
    confirm_article_file_upload,
    reparse_article_file,
)
from app.models.article import ArticleFile
from app.schemas.article import ConfirmUploadRequest
from app.services.article_file_service import ArticleFileService, ParseEnqueueError
from app.services.article_text_block_read_service import ArticleFileNotFoundError
from app.services.citation_read_service import ArticleNotFoundError

_INGEST = "app.services.article_file_service.ArticleFileIngestService"
_EP = "app.api.v1.endpoints.article_files"


def _fake_article_file(article_id, project_id, *, status="pending"):
    af = ArticleFile(
        project_id=project_id,
        article_id=article_id,
        file_type="PDF",
        storage_key=f"{project_id}/{article_id}/f.pdf",
        original_filename="f.pdf",
        bytes=1,
        file_role="MAIN",
    )
    af.id = uuid4()
    af.extraction_status = status
    af.extraction_error = None
    now = datetime(2026, 1, 1, tzinfo=UTC)
    af.created_at = now
    af.updated_at = now
    return af


def _make_service():
    db = AsyncMock()
    svc = ArticleFileService(db)
    svc._repo = AsyncMock()
    return svc, db


# --------------------------------------------------------------------------
# ArticleFileService
# --------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_register_uploaded_file_commits_before_enqueue() -> None:
    svc, db = _make_service()
    with patch(_INGEST) as ingest:
        result = await svc.register_uploaded_file(
            project_id=uuid4(),
            article_id=uuid4(),
            storage_key="p/a/f.pdf",
            file_type="PDF",
            original_filename="f.pdf",
            bytes_=1,
            file_role="MAIN",
            user_id="u",
            trace_id=None,
        )
    assert isinstance(result, ArticleFile)
    svc._repo.create.assert_awaited_once()
    db.commit.assert_awaited()
    db.refresh.assert_awaited_with(result)
    ingest.return_value.enqueue_parse_at_ingest.assert_called_once()


@pytest.mark.asyncio
async def test_register_uploaded_file_enqueue_failure_marks_parse_failed() -> None:
    svc, db = _make_service()
    with patch(_INGEST) as ingest:
        ingest.return_value.enqueue_parse_at_ingest.side_effect = RuntimeError("broker down")
        with pytest.raises(ParseEnqueueError):
            await svc.register_uploaded_file(
                project_id=uuid4(),
                article_id=uuid4(),
                storage_key="p/a/f.pdf",
                file_type="PDF",
                original_filename="f.pdf",
                bytes_=1,
                file_role="MAIN",
                user_id="u",
                trace_id="t",
            )
    # commit happened twice: once before enqueue, once after marking parse_failed
    assert db.commit.await_count == 2


@pytest.mark.asyncio
async def test_reparse_resets_and_enqueues() -> None:
    svc, db = _make_service()
    af = _fake_article_file(uuid4(), uuid4(), status="parse_failed")
    af.extraction_error = "boom"
    svc._repo.get_by_id = AsyncMock(return_value=af)
    with patch(_INGEST) as ingest:
        result = await svc.reparse(
            article_file_id=af.id, project_id=uuid4(), user_id="u", trace_id=None
        )
    assert result is af
    assert af.extraction_status == "pending"
    assert af.extraction_error is None
    ingest.return_value.enqueue_parse_at_ingest.assert_called_once()


@pytest.mark.asyncio
async def test_reparse_returns_none_when_missing() -> None:
    svc, _ = _make_service()
    svc._repo.get_by_id = AsyncMock(return_value=None)
    result = await svc.reparse(
        article_file_id=uuid4(), project_id=uuid4(), user_id="u", trace_id=None
    )
    assert result is None


@pytest.mark.asyncio
async def test_reparse_enqueue_failure_raises() -> None:
    svc, _ = _make_service()
    af = _fake_article_file(uuid4(), uuid4())
    svc._repo.get_by_id = AsyncMock(return_value=af)
    with patch(_INGEST) as ingest:
        ingest.return_value.enqueue_parse_at_ingest.side_effect = RuntimeError("x")
        with pytest.raises(ParseEnqueueError):
            await svc.reparse(article_file_id=af.id, project_id=uuid4(), user_id="u", trace_id="t")
    assert af.extraction_status == "parse_failed"


# --------------------------------------------------------------------------
# confirm_article_file_upload endpoint
# --------------------------------------------------------------------------


def _confirm_body(article_id, project_id, *, key=None):
    return ConfirmUploadRequest(
        article_id=article_id,
        storage_key=key or f"{project_id}/{article_id}/f.pdf",
        original_filename="f.pdf",
        content_type="PDF",
        bytes=1,
        file_role="MAIN",
    )


def _request():
    req = MagicMock()
    req.state.trace_id = "trace"
    return req


@pytest.mark.asyncio
async def test_confirm_endpoint_rejects_article_id_mismatch() -> None:
    aid, pid = uuid4(), uuid4()
    body = _confirm_body(uuid4(), pid)  # body.article_id != path aid
    with pytest.raises(HTTPException) as exc:
        await confirm_article_file_upload(
            article_id=aid, body=body, request=_request(), db=AsyncMock(), current_user_sub=uuid4()
        )
    assert exc.value.status_code == 400


@pytest.mark.asyncio
async def test_confirm_endpoint_404_when_article_missing() -> None:
    aid, pid = uuid4(), uuid4()
    body = _confirm_body(aid, pid)
    with (
        patch(f"{_EP}.get_article_project_id", AsyncMock(side_effect=ArticleNotFoundError("nope"))),
        pytest.raises(HTTPException) as exc,
    ):
        await confirm_article_file_upload(
            article_id=aid,
            body=body,
            request=_request(),
            db=AsyncMock(),
            current_user_sub=uuid4(),
        )
    assert exc.value.status_code == 404


@pytest.mark.asyncio
async def test_confirm_endpoint_rejects_foreign_storage_key() -> None:
    aid, pid = uuid4(), uuid4()
    body = _confirm_body(aid, pid, key=f"{uuid4()}/{uuid4()}/evil.pdf")
    with (
        patch(f"{_EP}.get_article_project_id", AsyncMock(return_value=pid)),
        patch(f"{_EP}.ensure_project_member", AsyncMock()),
        pytest.raises(HTTPException) as exc,
    ):
        await confirm_article_file_upload(
            article_id=aid, body=body, request=_request(), db=AsyncMock(), current_user_sub=uuid4()
        )
    assert exc.value.status_code == 400


@pytest.mark.asyncio
async def test_confirm_endpoint_success_returns_envelope() -> None:
    aid, pid = uuid4(), uuid4()
    body = _confirm_body(aid, pid)
    af = _fake_article_file(aid, pid)
    with (
        patch(f"{_EP}.get_article_project_id", AsyncMock(return_value=pid)),
        patch(f"{_EP}.ensure_project_member", AsyncMock()),
        patch(f"{_EP}.ArticleFileService") as svc,
    ):
        svc.return_value.register_uploaded_file = AsyncMock(return_value=af)
        resp = await confirm_article_file_upload(
            article_id=aid, body=body, request=_request(), db=AsyncMock(), current_user_sub=uuid4()
        )
    assert resp.ok is True
    assert resp.data.extraction_status == "pending"


@pytest.mark.asyncio
async def test_confirm_endpoint_maps_enqueue_failure_to_503() -> None:
    aid, pid = uuid4(), uuid4()
    body = _confirm_body(aid, pid)
    with (
        patch(f"{_EP}.get_article_project_id", AsyncMock(return_value=pid)),
        patch(f"{_EP}.ensure_project_member", AsyncMock()),
        patch(f"{_EP}.ArticleFileService") as svc,
    ):
        svc.return_value.register_uploaded_file = AsyncMock(side_effect=ParseEnqueueError("x"))
        with pytest.raises(HTTPException) as exc:
            await confirm_article_file_upload(
                article_id=aid,
                body=body,
                request=_request(),
                db=AsyncMock(),
                current_user_sub=uuid4(),
            )
    assert exc.value.status_code == 503


# --------------------------------------------------------------------------
# reparse_article_file endpoint
# --------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_reparse_endpoint_404_when_file_missing() -> None:
    with (
        patch(
            f"{_EP}.get_article_file_project_id",
            AsyncMock(side_effect=ArticleFileNotFoundError("nope")),
        ),
        pytest.raises(HTTPException) as exc,
    ):
        await reparse_article_file(
            article_file_id=uuid4(), request=_request(), db=AsyncMock(), current_user_sub=uuid4()
        )
    assert exc.value.status_code == 404


@pytest.mark.asyncio
async def test_reparse_endpoint_success_returns_envelope() -> None:
    aid, pid = uuid4(), uuid4()
    af = _fake_article_file(aid, pid)
    with (
        patch(f"{_EP}.get_article_file_project_id", AsyncMock(return_value=pid)),
        patch(f"{_EP}.ensure_project_member", AsyncMock()),
        patch(f"{_EP}.ArticleFileService") as svc,
    ):
        svc.return_value.reparse = AsyncMock(return_value=af)
        resp = await reparse_article_file(
            article_file_id=af.id, request=_request(), db=AsyncMock(), current_user_sub=uuid4()
        )
    assert resp.ok is True
    assert resp.data.extraction_status == "pending"


@pytest.mark.asyncio
async def test_reparse_endpoint_maps_enqueue_failure_to_503() -> None:
    with (
        patch(f"{_EP}.get_article_file_project_id", AsyncMock(return_value=uuid4())),
        patch(f"{_EP}.ensure_project_member", AsyncMock()),
        patch(f"{_EP}.ArticleFileService") as svc,
    ):
        svc.return_value.reparse = AsyncMock(side_effect=ParseEnqueueError("x"))
        with pytest.raises(HTTPException) as exc:
            await reparse_article_file(
                article_file_id=uuid4(),
                request=_request(),
                db=AsyncMock(),
                current_user_sub=uuid4(),
            )
    assert exc.value.status_code == 503


@pytest.mark.asyncio
async def test_reparse_endpoint_defensive_404_when_service_returns_none() -> None:
    with (
        patch(f"{_EP}.get_article_file_project_id", AsyncMock(return_value=uuid4())),
        patch(f"{_EP}.ensure_project_member", AsyncMock()),
        patch(f"{_EP}.ArticleFileService") as svc,
    ):
        svc.return_value.reparse = AsyncMock(return_value=None)
        with pytest.raises(HTTPException) as exc:
            await reparse_article_file(
                article_file_id=uuid4(),
                request=_request(),
                db=AsyncMock(),
                current_user_sub=uuid4(),
            )
    assert exc.value.status_code == 404
