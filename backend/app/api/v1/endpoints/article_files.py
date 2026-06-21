"""Article-file ingest + recovery endpoints.

The browser uploads the bytes to Supabase Storage under its own JWT; these
endpoints create/recover the DB row server-side (via ArticleFileService) so
membership is enforced and the parse is scheduled — the direct PostgREST
insert that bypassed parsing is retired.
"""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, status

from app.api.deps.security import ensure_project_member, get_current_user_sub
from app.core.deps import DbSession
from app.schemas.article import (
    ArticleFileListItem,
    ArticleFileResponse,
    ConfirmUploadRequest,
)
from app.schemas.common import ApiResponse
from app.services.article_file_service import ArticleFileService, ParseEnqueueError
from app.services.article_text_block_read_service import (
    ArticleFileNotFoundError,
    get_article_file_project_id,
)
from app.services.citation_read_service import ArticleNotFoundError, get_article_project_id

router = APIRouter(tags=["article-files"])

_ENQUEUE_FAILED_DETAIL = "Failed to schedule parsing; please retry"


def _trace(request: Request) -> str | None:
    return getattr(request.state, "trace_id", None)


@router.post("/articles/{article_id}/files", status_code=status.HTTP_201_CREATED)
async def confirm_article_file_upload(
    article_id: UUID,
    body: ConfirmUploadRequest,
    request: Request,
    db: DbSession,
    current_user_sub: UUID = Depends(get_current_user_sub),
) -> ApiResponse[ArticleFileResponse]:
    """Register an already-uploaded object and enqueue its parse."""
    trace_id = _trace(request)
    if body.article_id != article_id:
        raise HTTPException(status_code=400, detail="article_id mismatch")
    try:
        project_id = await get_article_project_id(db, article_id)
    except ArticleNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    await ensure_project_member(db, project_id, current_user_sub)

    # The service role bypasses RLS, so the storage key must be proven to
    # live under the resolved project/article prefix (not a client claim).
    expected_prefix = f"{project_id}/{article_id}/"
    if not body.storage_key.startswith(expected_prefix):
        raise HTTPException(status_code=400, detail="storage_key outside article path")

    try:
        article_file = await ArticleFileService(db).register_uploaded_file(
            project_id=project_id,
            article_id=article_id,
            storage_key=body.storage_key,
            file_type=body.content_type,
            original_filename=body.original_filename,
            bytes_=body.bytes,
            file_role=body.file_role,
            user_id=str(current_user_sub),
            trace_id=trace_id,
        )
    except ParseEnqueueError as e:
        raise HTTPException(status_code=503, detail=_ENQUEUE_FAILED_DETAIL) from e

    return ApiResponse.success(ArticleFileResponse.model_validate(article_file), trace_id=trace_id)


@router.get("/articles/{article_id}/files")
async def list_article_files(
    article_id: UUID,
    request: Request,
    db: DbSession,
    current_user_sub: UUID = Depends(get_current_user_sub),
) -> ApiResponse[list[ArticleFileListItem]]:
    """List an article's files (MAIN first) — the document switcher's source."""
    trace_id = _trace(request)
    try:
        project_id = await get_article_project_id(db, article_id)
    except ArticleNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    await ensure_project_member(db, project_id, current_user_sub)

    files = await ArticleFileService(db).list_for_article(article_id)
    return ApiResponse.success(
        [ArticleFileListItem.model_validate(f) for f in files], trace_id=trace_id
    )


@router.post("/article-files/{article_file_id}/reparse")
async def reparse_article_file(
    article_file_id: UUID,
    request: Request,
    db: DbSession,
    current_user_sub: UUID = Depends(get_current_user_sub),
) -> ApiResponse[ArticleFileResponse]:
    """Re-enqueue a parse for an existing ArticleFile (recovery)."""
    trace_id = _trace(request)
    try:
        project_id = await get_article_file_project_id(db, article_file_id)
    except ArticleFileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    await ensure_project_member(db, project_id, current_user_sub)

    try:
        article_file = await ArticleFileService(db).reparse(
            article_file_id=article_file_id,
            project_id=project_id,
            user_id=str(current_user_sub),
            trace_id=trace_id,
        )
    except ParseEnqueueError as e:
        raise HTTPException(status_code=503, detail=_ENQUEUE_FAILED_DETAIL) from e
    if article_file is None:  # defensive — gate already resolved the project
        raise HTTPException(status_code=404, detail="Article file not found")

    return ApiResponse.success(ArticleFileResponse.model_validate(article_file), trace_id=trace_id)
