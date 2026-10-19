"""Evidence and generation provenance for the researcher MCP `get_extractions`
read, batched once per page: one evidence select for every visible proposal
and decision, one `article_files` version read, then a pure per-row mapping;
provenance reads the generation snapshots the run details already carry.

Locators are derived from the parsed anchor only (`p{page}·b{block}`, the
`get_article_text` block reference); a bare `page_number` -- which an older
model call may have supplied -- never becomes a locator. `grounded` and
`stale` follow the one predicate every evidence read uses.
"""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Mapping
from dataclasses import dataclass, field
from typing import Any, Literal, Protocol, cast
from uuid import UUID

from sqlalchemy import and_, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.domain.evidence_block_refs import evidence_is_stale
from app.models.extraction import ExtractionEvidence
from app.models.extraction_workflow import ExtractionProposalSource
from app.schemas.extraction import PositionV1, RegionCitationAnchor, stored_anchor
from app.schemas.mcp_article_text import block_locator
from app.schemas.mcp_extractions import McpEvidence, McpProvenance
from app.services.evidence_reanchor import file_versions
from app.utils.text_caps import cap_text

EVIDENCE_QUOTE_CAP = 300
EVIDENCE_PER_ROW_CAP = 3
_HASH_PREFIX = 12
_MODES = frozenset({"fast", "verified"})


class _ResolvedSource(Protocol):
    """A resolved value's decider and the two ids of its own source row (the
    read service's `_Resolved`), typed structurally to avoid an import cycle."""

    @property
    def decision_id(self) -> UUID | None: ...

    @property
    def proposal_id(self) -> UUID | None: ...

    @property
    def decider(self) -> str: ...


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


def provenance_batch(details: Mapping[UUID, Any]) -> dict[UUID, McpProvenance]:
    """Compact provenance of each AI proposal of *details* (run id -> the
    caller's blind-filtered run detail), computed from the generation snapshot
    each proposal already carries; a proposal whose snapshot predates the
    identity keys is absent from the result."""
    out: dict[UUID, McpProvenance] = {}
    for detail in details.values():
        for proposal in detail.proposals:
            if proposal.source != ExtractionProposalSource.AI.value:
                continue
            provenance = compact_provenance(proposal.generation_snapshot)
            if provenance is not None:
                out[proposal.id] = provenance
    return out


def _str(value: object) -> str | None:
    return value if isinstance(value, str) and value else None


def _int(value: object) -> int | None:
    return value if type(value) is int else None


def compact_provenance(snapshot: Mapping[str, Any] | None) -> McpProvenance | None:
    """The MCP view of a landed generation snapshot, or `None` unless it holds
    every required identity key (`model`, `mode_executed`,
    `template_version.version`, `schema_sha256`, `prompt_version`) -- an older
    snapshot is never a partial object. The article text hash and content
    version may be null."""
    if not isinstance(snapshot, Mapping):
        return None
    model = _str(snapshot.get("model"))
    mode = snapshot.get("mode_executed")
    template_version = snapshot.get("template_version")
    version = (
        _int(template_version.get("version")) if isinstance(template_version, Mapping) else None
    )
    schema_sha256 = _str(snapshot.get("schema_sha256"))
    prompt_version = _str(snapshot.get("prompt_version"))
    if (
        model is None
        or mode not in _MODES
        or version is None
        or schema_sha256 is None
        or prompt_version is None
    ):
        return None
    composition = snapshot.get("prompt_composition")
    ref = composition.get("article_ref") if isinstance(composition, Mapping) else None
    ref = ref if isinstance(ref, Mapping) else {}
    text_sha256 = _str(ref.get("text_sha256"))
    return McpProvenance(
        model=cap_text(model)[0],
        mode=cast(Literal["fast", "verified"], mode),
        template_version=version,
        schema_sha256=schema_sha256[:_HASH_PREFIX],
        text_sha256=text_sha256[:_HASH_PREFIX] if text_sha256 is not None else None,
        content_version=_int(ref.get("content_version")),
        prompt_version=prompt_version,
    )


def provenance_for(
    resolved: _ResolvedSource, provenance: Mapping[UUID, McpProvenance]
) -> McpProvenance | None:
    """A row's provenance: only an AI-decided row carries its proposal's."""
    if resolved.decider != "ai" or resolved.proposal_id is None:
        return None
    return provenance.get(resolved.proposal_id)
