"""Citations API — list ExtractionEvidence rows for an article in v1 wire format.

This is the read-side of Phase 3 (Citation API + ExtractionEvidence
integration). Writes still flow through the existing extraction services
(``section_extraction_service``, ``ExtractionProposalService``); this
endpoint surfaces the rows with their ``position`` JSONB validated against
``PositionV1`` so the frontend viewer can render them without a translation
layer.

Rows whose ``position`` is the legacy empty ``{}`` are skipped — they
predate the citation contract and have no anchor to render. Once the AI
extraction pipeline is updated to emit anchors (Phase 6), historical rows
can be backfilled or left as-is.
"""

from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import ValidationError
from sqlalchemy import select, text

from app.api.deps.security import get_current_user_sub
from app.core.deps import DbSession
from app.models.article import Article
from app.models.extraction import ExtractionEvidence
from app.schemas.common import ApiResponse
from app.schemas.extraction import PositionV1, parse_position

router = APIRouter()


def _trace(request: Request) -> str | None:
    return getattr(request.state, "trace_id", None)


@router.get("/{article_id}/citations")
async def list_article_citations(
    article_id: UUID,
    request: Request,
    db: DbSession,
    current_user_sub: UUID = Depends(get_current_user_sub),
) -> ApiResponse[list[dict[str, Any]]]:
    """Return all v1-shape citations attached to ``article_id``.

    The shape mirrors ``frontend/pdf-viewer/core/citation.ts:Citation``
    (sans the optional ``style`` field, which is a UI-only concern):

    ```jsonc
    {
      "id": "<evidence_uuid>",
      "anchor": { "kind": "text" | "region" | "hybrid", ... },
      "metadata": {
        "pageNumber": 5,                  // denormalized; matches anchor's page
        "textContent": "the methodology...",  // denormalized; matches anchor.quote when present
        "source": "ai" | "human" | "review",   // present when derivable from the linking row
        "fieldId": "..."                  // optional; derived from the linking row when known
      }
    }
    ```
    """
    article = (
        await db.execute(select(Article).where(Article.id == article_id))
    ).scalar_one_or_none()
    if article is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Article not found")

    # The DB session runs as service-role (RLS bypassed); enforce project
    # membership manually using the same SQL helper the policies use.
    is_member = (
        await db.execute(
            text("SELECT public.is_project_member(:pid, :uid) AS ok"),
            {"pid": article.project_id, "uid": current_user_sub},
        )
    ).scalar_one()
    if not is_member:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Caller is not a member of this article's project",
        )

    rows = (
        (
            await db.execute(
                select(ExtractionEvidence)
                .where(ExtractionEvidence.article_id == article_id)
                .order_by(ExtractionEvidence.created_at.asc())
            )
        )
        .scalars()
        .all()
    )

    citations: list[dict[str, Any]] = []
    for row in rows:
        position = row.position
        if not position:
            # Legacy rows or rows that haven't had anchor data attached yet.
            continue
        try:
            parsed: PositionV1 | None = parse_position(position)
        except ValidationError:
            # Skip rows that fail validation rather than 500 the whole list.
            continue
        if parsed is None:
            continue

        metadata: dict[str, Any] = {}
        if row.page_number is not None:
            metadata["pageNumber"] = row.page_number
        if row.text_content is not None:
            metadata["textContent"] = row.text_content
        # Source attribution — pick whichever workflow row this evidence is
        # bound to. The constraint guarantees exactly one of these is set.
        if row.proposal_record_id is not None:
            metadata["source"] = "ai"
        elif row.reviewer_decision_id is not None:
            metadata["source"] = "human"
        elif row.consensus_decision_id is not None:
            metadata["source"] = "review"

        citations.append(
            {
                "id": str(row.id),
                "anchor": parsed.anchor.model_dump(by_alias=True, exclude_none=True),
                "metadata": metadata,
            }
        )

    return ApiResponse.success(citations, trace_id=_trace(request))
