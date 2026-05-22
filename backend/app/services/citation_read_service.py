"""Read-side service for ExtractionEvidence rows in v1 citation wire format.

Owns the inline SQL + position-parsing logic that `citations.py` used
to do directly, so the endpoint module stops importing from
`app.models.*`.
"""

from __future__ import annotations

from typing import Any
from uuid import UUID

from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.article import Article
from app.models.extraction import ExtractionEvidence
from app.schemas.extraction import PositionV1, parse_position


class ArticleNotFoundError(Exception):
    """Raised when an Article lookup returns no row. HTTP translation in router."""


async def get_article_project_id(db: AsyncSession, article_id: UUID) -> UUID:
    """Return the project_id of an Article or raise.

    The endpoint uses this for membership enforcement via
    `ensure_project_member`, without loading the ORM row.
    """
    project_id = (
        await db.execute(select(Article.project_id).where(Article.id == article_id))
    ).scalar_one_or_none()
    if project_id is None:
        raise ArticleNotFoundError(f"Article {article_id} not found")
    return project_id


async def list_article_citations(db: AsyncSession, article_id: UUID) -> list[dict[str, Any]]:
    """Return all v1-shape citations attached to the article (chronological).

    Rows without a parseable PositionV1 anchor are skipped — they predate
    the citation contract (legacy empty `{}` position) or fail schema
    validation. Skipping (rather than 500-ing) preserves list semantics
    for partial-failure cases.
    """
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
            continue
        try:
            parsed: PositionV1 | None = parse_position(position)
        except ValidationError:
            continue
        if parsed is None:
            continue

        metadata: dict[str, Any] = {}
        if row.page_number is not None:
            metadata["pageNumber"] = row.page_number
        if row.text_content is not None:
            metadata["textContent"] = row.text_content
        # Source attribution — exactly one of these is set (CHECK constraint).
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

    return citations
