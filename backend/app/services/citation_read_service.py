"""Read-side service for ExtractionEvidence rows in v1 citation wire format.

Owns the inline SQL + position-parsing logic that `citations.py` used
to do directly, so the endpoint module stops importing from
`app.models.*`.
"""

from __future__ import annotations

from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.llm.validators import anchor_kind, evidence_is_grounded
from app.models.article import Article
from app.models.extraction import ExtractionEvidence
from app.schemas.extraction import parse_position


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

    Every evidence row is returned — unanchored rows (empty or unparseable
    ``position``) are included with ``verified=False`` and ``anchorKind=None``
    rather than skipped. This surfaces hallucination / no-blocks-yet signals
    to callers without ever raising in the read path.

    Wire shape per item:
    - ``id``         — UUID string
    - ``verified``   — True iff position parses to a valid PositionV1 anchor
    - ``anchorKind`` — "text" | "region" | "hybrid" when verified, else None
    - ``anchor``     — camelCase anchor dict when verified, else None (always present; check ``c["anchor"] is None`` for unanchored rows)
    - ``metadata``   — pageNumber / textContent / source (always present)
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
        verified = evidence_is_grounded(position)
        kind = anchor_kind(position)

        metadata: dict[str, Any] = {}
        if row.page_number is not None:
            metadata["pageNumber"] = row.page_number
        if row.text_content is not None:
            metadata["textContent"] = row.text_content
        # Source attribution — at least one of proposal/reviewer/consensus is set
        # (workflow_target_present CHECK enforces an OR, not exactly-one);
        # the if/elif picks the first by priority.
        if row.proposal_record_id is not None:
            metadata["source"] = "ai"
        elif row.reviewer_decision_id is not None:
            metadata["source"] = "human"
        elif row.consensus_decision_id is not None:
            metadata["source"] = "review"

        item: dict[str, Any] = {
            "id": str(row.id),
            "verified": verified,
            "anchorKind": kind,
            "metadata": metadata,
        }
        if verified:
            # parse_position is safe here: evidence_is_grounded already confirmed it parses.
            parsed = parse_position(position)
            if parsed is None:
                # Defensive guard: logic regression — treat as unanchored.
                item["anchor"] = None
                item["verified"] = False
                item["anchorKind"] = None
            else:
                item["anchor"] = parsed.anchor.model_dump(by_alias=True, exclude_none=True)
        else:
            item["anchor"] = None

        citations.append(item)

    return citations
