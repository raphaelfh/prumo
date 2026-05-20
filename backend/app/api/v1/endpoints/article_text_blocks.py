"""Article text blocks API — read-side for the reader-view mode.

Surfaces ``article_text_blocks`` rows ordered by ``(page_number,
block_index)`` so the frontend can render a typography-first view of
the document without rasterizing pages. Population of the table is
Phase 6's responsibility (see
``docs/superpowers/plans/2026-04-29-pdf-viewer-phase6-text-blocks-backfill.md``);
this endpoint returns ``[]`` for unprocessed article files, which the
viewer renders as an EmptyState.
"""

from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, status

from app.api.deps.security import ensure_project_member, get_current_user_sub
from app.core.deps import DbSession
from app.schemas.common import ApiResponse
from app.services.article_text_block_read_service import (
    ArticleFileNotFoundError,
    get_article_file_project_id,
    list_text_blocks,
)

router = APIRouter()


def _trace(request: Request) -> str | None:
    return getattr(request.state, "trace_id", None)


@router.get("/{article_file_id}/text-blocks")
async def list_article_text_blocks(
    article_file_id: UUID,
    request: Request,
    db: DbSession,
    current_user_sub: UUID = Depends(get_current_user_sub),
) -> ApiResponse[list[dict[str, Any]]]:
    """Return all text blocks for ``article_file_id`` in reading order."""
    try:
        project_id = await get_article_file_project_id(db, article_file_id)
    except ArticleFileNotFoundError as e:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(e),
        ) from e
    await ensure_project_member(db, project_id, current_user_sub)
    blocks = await list_text_blocks(db, article_file_id)
    return ApiResponse.success(blocks, trace_id=_trace(request))
