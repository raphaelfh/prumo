"""Per-proposal facts projected onto one ``AI proposals`` export row.

Lives directly under ``exports/`` rather than ``exports/extraction/`` for the
import-cycle reason ``descriptors`` gives. Both facts belong to the proposal
itself: its immutable engine, read through the shared allowlisted serializer
(never the mutable run), and its own citations.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.extraction import ExtractionEvidence
from app.models.extraction_workflow import ExtractionProposalRecord
from app.services.proposal_generation_read import (
    ProposalRevealContext,
    serialize_proposal_generation,
)


@dataclass(frozen=True, slots=True)
class EngineFacts:
    """The engine one proposal records; ``""`` for a fact it does not record."""

    provider: str
    model: str
    prompt_version: str


def _text(facts: Mapping[str, object], key: str) -> str:
    value = facts.get(key)
    return value if isinstance(value, str) else ""


def proposal_engine(proposal: ExtractionProposalRecord, *, had_snapshot: bool) -> EngineFacts:
    """The proposal's own engine, read through the allowlisted serializer.

    ``had_snapshot`` is whether the row stored a ``generation_snapshot`` before
    the loader stripped its prompt payload: such a row names its engine from the
    snapshot only, never from ``provenance``. The export reveals no runner
    identity, so the reveal context is empty.
    """
    generation = serialize_proposal_generation(proposal, ProposalRevealContext({}))
    snapshot = generation["generation_snapshot"] or {}
    engine = snapshot if had_snapshot else (generation["provenance"] or {})
    return EngineFacts(
        provider=_text(engine, "provider"),
        model=_text(engine, "model"),
        prompt_version=_text(snapshot, "prompt_version"),
    )


async def load_evidence_summaries(
    db: AsyncSession, proposal_ids: Sequence[UUID]
) -> dict[UUID, tuple[str, str]]:
    """``(text joined ' | ', pages joined ', ')`` per proposal that has evidence.

    One bulk query. Each proposal gets one ordered (text, page) list, deduped on
    the pair; pages sort numerically with None last so "2" < "10" regardless of
    driver, and the ORDER BY id tiebreak survives for pairs sharing a page.
    """
    rows = (
        await db.execute(
            select(
                ExtractionEvidence.proposal_record_id,
                ExtractionEvidence.text_content,
                ExtractionEvidence.page_number,
            )
            .where(ExtractionEvidence.proposal_record_id.in_(proposal_ids))
            .order_by(
                ExtractionEvidence.proposal_record_id,
                ExtractionEvidence.page_number.asc().nulls_last(),
                ExtractionEvidence.id.asc(),
            )
        )
    ).all()
    pairs_by_pid: dict[UUID, list[tuple[str | None, int | None]]] = {}
    for pid, text, page in rows:
        pairs = pairs_by_pid.setdefault(pid, [])
        if (text, page) not in pairs:
            pairs.append((text, page))
    summaries: dict[UUID, tuple[str, str]] = {}
    for pid, pairs in pairs_by_pid.items():
        pairs.sort(key=lambda tp: (tp[1] is None, tp[1] if tp[1] is not None else 0))
        summaries[pid] = (
            " | ".join(t for t, _p in pairs if t),
            ", ".join(str(p) for p in sorted({pg for _t, pg in pairs if pg is not None})),
        )
    return summaries
