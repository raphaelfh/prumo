"""Article-file ingest + recovery endpoints.

Every code path that creates an ArticleFile MUST enqueue a parse (the
single sanctioned hook is ArticleFileIngestService). The browser uploads
the bytes to Supabase Storage under its own JWT; this endpoint creates the
DB row server-side so membership is enforced and the parse is scheduled —
the direct PostgREST insert that bypassed parsing is retired.
"""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, status

from app.api.deps.security import ensure_project_member, get_current_user_sub
from app.core.deps import DbSession
from app.core.logging import get_logger
from app.models.article import ArticleFile
from app.repositories.article_repository import ArticleFileRepository
from app.schemas.article import ArticleFileResponse, ConfirmUploadRequest
from app.schemas.common import ApiResponse
from app.services.article_file_ingest_service import ArticleFileIngestService
from app.services.article_text_block_read_service import (
    ArticleFileNotFoundError,
    get_article_file_project_id,
)
from app.services.citation_read_service import ArticleNotFoundError, get_article_project_id

logger = get_logger(__name__)
router = APIRouter(tags=["article-files"])


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

    article_file = ArticleFile(
        project_id=project_id,
        article_id=article_id,
        file_type=body.content_type,
        storage_key=body.storage_key,
        original_filename=body.original_filename,
        bytes=body.bytes,
        file_role=body.file_role,
    )
    article_file = await ArticleFileRepository(db).create(article_file)
    # Commit BEFORE enqueue: the Celery task loads the row in its own session.
    await db.commit()

    try:
        ArticleFileIngestService().enqueue_parse_at_ingest(
            article_file_id=article_file.id,
            project_id=project_id,
            user_id=str(current_user_sub),
            trace_id=trace_id,
        )
    except Exception as exc:  # do NOT swallow — surface so the user can retry
        logger.warning(
            "article_file_enqueue_failed",
            trace_id=trace_id,
            article_file_id=str(article_file.id),
            error=str(exc),
        )
        article_file.extraction_status = "parse_failed"
        article_file.extraction_error = f"enqueue failed: {exc}"[:500]
        await db.commit()
        raise HTTPException(
            status_code=503, detail="Failed to schedule parsing; please retry"
        ) from exc

    return ApiResponse.success(ArticleFileResponse.model_validate(article_file), trace_id=trace_id)


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

    article_file = await ArticleFileRepository(db).get_by_id(article_file_id)
    if article_file is None:  # defensive — gate already resolved the project
        raise HTTPException(status_code=404, detail="Article file not found")
    article_file.extraction_status = "pending"
    article_file.extraction_error = None
    await db.commit()
    await db.refresh(article_file)

    try:
        ArticleFileIngestService().enqueue_parse_at_ingest(
            article_file_id=article_file.id,
            project_id=project_id,
            user_id=str(current_user_sub),
            trace_id=trace_id,
        )
    except Exception as exc:
        logger.warning(
            "article_file_reparse_enqueue_failed",
            trace_id=trace_id,
            article_file_id=str(article_file.id),
            error=str(exc),
        )
        article_file.extraction_status = "parse_failed"
        article_file.extraction_error = f"enqueue failed: {exc}"[:500]
        await db.commit()
        raise HTTPException(
            status_code=503, detail="Failed to schedule parsing; please retry"
        ) from exc

    return ApiResponse.success(ArticleFileResponse.model_validate(article_file), trace_id=trace_id)
