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
from sqlalchemy import select, text

from app.api.deps.security import get_current_user_sub
from app.core.deps import DbSession
from app.models.article import ArticleFile, ArticleTextBlock
from app.schemas.common import ApiResponse

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
    """Return all text blocks for ``article_file_id`` in reading order.

    Each row mirrors the persisted shape (camelCase JSON keys, mirroring
    ``frontend/pdf-viewer/core/coordinates.ts``):

    ```jsonc
    {
      "id": "<uuid>",
      "pageNumber": 5,
      "blockIndex": 3,
      "text": "the methodology used was…",
      "charStart": 1234,
      "charEnd": 1287,
      "bbox": {"x": 100.5, "y": 200.0, "width": 412.0, "height": 14.0},
      "blockType": "paragraph"
    }
    ```
    """
    article_file = (
        await db.execute(select(ArticleFile).where(ArticleFile.id == article_file_id))
    ).scalar_one_or_none()
    if article_file is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Article file not found",
        )

    is_member = (
        await db.execute(
            text("SELECT public.is_project_member(:pid, :uid) AS ok"),
            {"pid": article_file.project_id, "uid": current_user_sub},
        )
    ).scalar_one()
    if not is_member:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Caller is not a member of this article's project",
        )

    rows = (
        await db.execute(
            select(ArticleTextBlock)
            .where(ArticleTextBlock.article_file_id == article_file_id)
            .order_by(
                ArticleTextBlock.page_number.asc(),
                ArticleTextBlock.block_index.asc(),
            )
        )
    ).scalars().all()

    blocks = [
        {
            "id": str(row.id),
            "pageNumber": row.page_number,
            "blockIndex": row.block_index,
            "text": row.text,
            "charStart": row.char_start,
            "charEnd": row.char_end,
            "bbox": row.bbox,
            "blockType": row.block_type,
        }
        for row in rows
    ]

    return ApiResponse.success(blocks, trace_id=_trace(request))
