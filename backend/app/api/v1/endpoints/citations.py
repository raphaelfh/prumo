"""Citations API — list ExtractionEvidence rows for an article in v1 wire format.

Read-side of Phase 3 (Citation API + ExtractionEvidence integration).
Writes still flow through the existing extraction services
(``section_extraction_service``, ``ExtractionProposalService``);
this endpoint surfaces the rows with their ``position`` JSONB, adding
``verified`` + ``anchorKind`` derived fields so callers can distinguish
confirmed-present quotes from hallucinated / not-yet-verifiable ones.

All evidence rows are returned — unanchored rows (empty or unparseable
``position``) are included with ``verified=False`` and ``anchorKind=None``
rather than skipped.  The read path never raises on a bad position.
"""

from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, status

from app.api.deps.security import ensure_project_member, get_current_user_sub
from app.core.deps import DbSession
from app.schemas.common import ApiResponse
from app.services.citation_read_service import (
    ArticleNotFoundError,
    get_article_project_id,
    list_article_citations,
)

router = APIRouter()


def _trace(request: Request) -> str | None:
    return getattr(request.state, "trace_id", None)


@router.get("/{article_id}/citations")
async def list_article_citations_endpoint(
    article_id: UUID,
    request: Request,
    db: DbSession,
    current_user_sub: UUID = Depends(get_current_user_sub),
) -> ApiResponse[list[dict[str, Any]]]:
    """Return all v1-shape citations attached to ``article_id``.

    Unanchored rows (hallucinated or pre-ingestion) are included with
    ``verified=False``; anchored rows carry ``verified=True`` + ``anchorKind``.
    """
    try:
        project_id = await get_article_project_id(db, article_id)
    except ArticleNotFoundError as e:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(e),
        ) from e
    await ensure_project_member(db, project_id, current_user_sub)
    citations = await list_article_citations(db, article_id)
    return ApiResponse.success(citations, trace_id=_trace(request))
