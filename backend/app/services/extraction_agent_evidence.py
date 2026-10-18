"""Evidence for the researcher MCP `get_extractions` read, batched once per
page: one evidence select for every visible proposal and decision, one
`article_files` version read, then a pure per-row mapping.

Locators are derived from the parsed anchor only (`p{page}·b{block}`, the
`get_article_text` block reference); a bare `page_number` -- which an older
model call may have supplied -- never becomes a locator. `grounded` and
`stale` follow the one predicate every evidence read uses.
"""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Mapping
from dataclasses import dataclass, field
from typing import Any, Protocol
from uuid import UUID

from sqlalchemy import and_, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.domain.evidence_block_refs import evidence_is_stale
from app.models.extraction import ExtractionEvidence
from app.schemas.extraction import PositionV1, RegionCitationAnchor, stored_anchor
from app.schemas.mcp_article_text import block_locator
from app.schemas.mcp_extractions import McpEvidence
from app.services.evidence_reanchor import file_versions

EVIDENCE_QUOTE_CAP = 300
EVIDENCE_PER_ROW_CAP = 3


class _ResolvedSource(Protocol):
    """The two ids of a resolved value's own source row (the read service's
    `_Resolved`), typed structurally to avoid an import cycle."""

    @property
    def decision_id(self) -> UUID | None: ...

    @property
    def proposal_id(self) -> UUID | None: ...


@dataclass
class EvidenceBatch:
    by_proposal: dict[UUID, list[ExtractionEvidence]] = field(default_factory=dict)
    by_decision: dict[UUID, list[ExtractionEvidence]] = field(default_factory=dict)
    file_versions: dict[UUID, int] = field(default_factory=dict)


async def load_evidence_batch(
    db: AsyncSession, *, project_id: UUID, details: Mapping[UUID, Any]
) -> EvidenceBatch:
    """Every evidence row of the visible proposals and decisions of *details*
    (run id -> the caller's blind-filtered run detail), plus the current
    content version of each file those rows cite."""
    by_proposal: dict[UUID, list[ExtractionEvidence]] = defaultdict(list)
    by_decision: dict[UUID, list[ExtractionEvidence]] = defaultdict(list)
    visible_proposal_ids = {p.id for d in details.values() for p in d.proposals}
    visible_decision_ids = {rd.id for d in details.values() for rd in d.decisions}
    # M1 (fix round 1): a row can carry BOTH a proposal_record_id and a
    # reviewer_decision_id (the CHECK constraint permits it) -- must
    # never surface via a visible proposal id when its decision id
    # belongs to a hidden peer, so a SET decision id alone decides
    # visibility; only a row with none falls back to the proposal id
    # (an AI proposal's own evidence never carries a decision id).
    conditions = []
    if visible_proposal_ids:
        conditions.append(
            and_(
                ExtractionEvidence.reviewer_decision_id.is_(None),
                ExtractionEvidence.proposal_record_id.in_(visible_proposal_ids),
            )
        )
    if visible_decision_ids:
        conditions.append(ExtractionEvidence.reviewer_decision_id.in_(visible_decision_ids))
    if not conditions:
        return EvidenceBatch()
    ev_rows = (
        (
            await db.execute(
                select(ExtractionEvidence)
                .where(
                    ExtractionEvidence.project_id == project_id,
                    ExtractionEvidence.run_id.in_(list(details.keys())),
                    or_(*conditions),
                )
                .order_by(ExtractionEvidence.rank)
            )
        )
        .scalars()
        .all()
    )
    for ev in ev_rows:
        if ev.proposal_record_id is not None:
            by_proposal[ev.proposal_record_id].append(ev)
        if ev.reviewer_decision_id is not None:
            by_decision[ev.reviewer_decision_id].append(ev)
    versions = await file_versions(
        db, {ev.article_file_id for ev in ev_rows if ev.article_file_id is not None}
    )
    return EvidenceBatch(by_proposal=by_proposal, by_decision=by_decision, file_versions=versions)


def _locator(anchor: PositionV1) -> str | None:
    """`p{page}·b{first block}` from the anchor; `None` for an anchor that
    predates block ids."""
    inner = anchor.anchor
    if not inner.block_ids:
        return None
    page = inner.page if isinstance(inner, RegionCitationAnchor) else inner.range.page
    return block_locator(page, min(inner.block_ids))


def evidence_for(resolved: _ResolvedSource, batch: EvidenceBatch) -> list[McpEvidence]:
    """Evidence for a resolved value's own source row (its decision, or, when
    that decision carries none itself, the proposal it accepted / the AI
    proposal it came from) -- never a second lookup by (instance, field),
    which would surface a DIFFERENT reviewer's evidence at the same
    coordinate."""
    rows = batch.by_decision.get(resolved.decision_id, []) if resolved.decision_id else []
    if not rows and resolved.proposal_id is not None:
        rows = batch.by_proposal.get(resolved.proposal_id, [])
    out: list[McpEvidence] = []
    for ev in rows[:EVIDENCE_PER_ROW_CAP]:
        if not ev.text_content:
            continue
        anchor = stored_anchor(ev.position)
        grounded = anchor is not None
        file_version = batch.file_versions.get(ev.article_file_id) if ev.article_file_id else None
        out.append(
            McpEvidence(
                quote=ev.text_content[:EVIDENCE_QUOTE_CAP],
                quote_truncated=len(ev.text_content) > EVIDENCE_QUOTE_CAP,
                locator=_locator(anchor) if anchor is not None else None,
                grounded=grounded,
                stale=evidence_is_stale(
                    grounded=grounded,
                    evidence_version=ev.content_version,
                    file_version=file_version,
                ),
            )
        )
    return out
