"""Re-anchor a file's grounded AI evidence after a reparse.

A grounded evidence row records the ``article_files.content_version`` its
``position`` was anchored against (``extraction_evidence.content_version``;
NULL = unknown, reads current). When a reparse bumps the file's version, each
grounded AI row on that file whose version is NULL or the previous one is
matched again against the new blocks:

* match → ``position`` and ``page_number`` follow the new anchor (the stored
  ``anchor.quote`` is copied back: the quote is history) and the row is stamped
  with the new version;
* no match → ``position`` and ``page_number`` stay; a NULL version is stamped
  with the previous version so the row reads stale.

``text_content``, ``attribution_label``, ``rank`` and the workflow links never
change. Reviewer and consensus evidence (and evidence on a human proposal) is
part of the human audit trail and never moves.

Everything runs in the caller's transaction under :func:`lock_file_blocks`;
nothing here commits.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from uuid import UUID

from pydantic import ValidationError
from sqlalchemy import ColumnElement, and_, exists, func, or_, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.infrastructure.parsing.base import ParsedBlock
from app.models.extraction import ExtractionEvidence
from app.models.extraction_workflow import ExtractionProposalRecord, ExtractionProposalSource
from app.schemas.extraction import PositionV1, parse_position
from app.services.evidence_anchor_service import build_anchor


@dataclass(frozen=True)
class ReanchorOutcome:
    """How many grounded rows followed the reparse and how many read stale."""

    reanchored: int
    stale: int


async def lock_file_blocks(db: AsyncSession, file_id: UUID) -> None:
    """Take the per-file block lock (transaction-scoped, released on commit).

    The one definition of the lock that serializes a file's block rewrite and
    every write that derives from those blocks.
    """
    await db.execute(
        text("SELECT pg_advisory_xact_lock(hashtextextended(:k, 0))"),
        {"k": str(file_id)},
    )


def match_anchor(text_content: str, blocks: Sequence[ParsedBlock]) -> PositionV1 | None:
    """Exact match first; the fuzzy matcher only on an exact miss."""
    return build_anchor(text_content, blocks, fuzz_threshold=1.0) or build_anchor(
        text_content, blocks
    )


def ai_evidence_filter() -> ColumnElement[bool]:
    """Evidence attached to an AI proposal and to no human decision."""
    return and_(
        ExtractionEvidence.proposal_record_id.is_not(None),
        ExtractionEvidence.reviewer_decision_id.is_(None),
        ExtractionEvidence.consensus_decision_id.is_(None),
        exists().where(
            ExtractionProposalRecord.id == ExtractionEvidence.proposal_record_id,
            ExtractionProposalRecord.source == ExtractionProposalSource.AI.value,
        ),
    )


def _page(pos: PositionV1) -> int:
    anchor = pos.anchor
    return anchor.page if anchor.kind == "region" else anchor.range.page


async def reanchor_file(
    db: AsyncSession,
    file_id: UUID,
    old_version: int,
    new_version: int,
    blocks: Sequence[ParsedBlock],
) -> ReanchorOutcome:
    """Re-anchor *file_id*'s grounded AI evidence against the new *blocks*."""
    rows = (
        await db.scalars(
            select(ExtractionEvidence).where(
                ai_evidence_filter(),
                ExtractionEvidence.article_file_id == file_id,
                func.jsonb_typeof(ExtractionEvidence.position) == "object",
                ExtractionEvidence.position.has_key("anchor"),
                or_(
                    ExtractionEvidence.content_version.is_(None),
                    ExtractionEvidence.content_version == old_version,
                ),
            )
        )
    ).all()

    reanchored = stale = 0
    for row in rows:
        try:
            stored = parse_position(row.position)
        except ValidationError:
            continue
        pos = match_anchor(row.text_content or "", blocks)
        if pos is None:
            if row.content_version is None:
                row.content_version = old_version
            stale += 1
            continue
        position = pos.model_dump(by_alias=True, mode="json")
        stored_quote = getattr(stored.anchor, "quote", None) if stored is not None else None
        if stored_quote is not None:
            position["anchor"]["quote"] = stored_quote
        row.position = position
        row.page_number = _page(pos)
        row.content_version = new_version
        reanchored += 1

    await db.flush()
    return ReanchorOutcome(reanchored=reanchored, stale=stale)
