"""Read-side service for AI suggestion data (proposal records + evidence + status).

Owns the three queries the frontend's AISuggestionService currently issues
directly via Supabase PostgREST:

  load_suggestions       — latest AI proposal per (instance, field), with
                           caller-scoped status derived from the caller's
                           reviewer_states. NEVER reads another reviewer's
                           states — this is the blind boundary (Constraint 3).
  get_suggestion_history — all AI proposals for a single coord, newest first.
  get_article_instance_ids — extraction_instances for an article.

The status overlay reads ONLY reviewer_states.reviewer_id == caller_id.
A test in test_suggestion_read.py pins this invariant explicitly.
"""

from __future__ import annotations

from uuid import UUID

from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.extraction import ExtractionEvidence, ExtractionInstance
from app.models.extraction_workflow import (
    ExtractionProposalRecord,
    ExtractionProposalSource,
    ExtractionReviewerDecision,
    ExtractionReviewerDecisionType,
    ExtractionReviewerState,
)
from app.schemas.extraction_suggestion import (
    AISuggestionHistoryItem,
    AISuggestionItem,
    AISuggestionsResponse,
    EvidenceResponse,
)


async def get_article_instance_ids(db: AsyncSession, article_id: UUID) -> list[UUID]:
    """Return all extraction_instance ids for an article."""
    rows = (
        (
            await db.execute(
                select(ExtractionInstance.id).where(ExtractionInstance.article_id == article_id)
            )
        )
        .scalars()
        .all()
    )
    return list(rows)


def _resolve_status(decision: str | None) -> str:
    """Map a reviewer decision string to a suggestion status string."""
    if decision is None:
        return "pending"
    if decision == ExtractionReviewerDecisionType.REJECT.value:
        return "rejected"
    return "accepted"


async def load_suggestions(
    db: AsyncSession,
    instance_ids: list[UUID],
    *,
    caller_id: UUID,
    run_id: UUID | None = None,
) -> AISuggestionsResponse:
    """Return the latest AI proposal per (instance, field) with caller-scoped status.

    Mirrors AISuggestionService.loadSuggestions:
    1. Read ExtractionProposalRecord WHERE source='ai', instance_id IN instance_ids,
       optional run_id, ORDER BY created_at DESC.
    2. Dedup: first-per-(instance_id, field_id) wins (desc order → latest wins).
    3. Load evidence for the deduplicated proposal_ids.
    4. Load ExtractionReviewerState WHERE reviewer_id == caller_id (blind boundary)
       joined to ExtractionReviewerDecision via the composite FK for `.decision`.
    5. Derive status per (instance, field): reject → 'rejected', other → 'accepted', else 'pending'.
    """
    if not instance_ids:
        return AISuggestionsResponse(suggestions=[], count=0)

    # --- Step 1: fetch AI proposals ordered newest-first ---
    proposal_stmt = (
        select(ExtractionProposalRecord)
        .where(
            ExtractionProposalRecord.instance_id.in_(instance_ids),
            ExtractionProposalRecord.source == ExtractionProposalSource.AI.value,
        )
        .order_by(ExtractionProposalRecord.created_at.desc())
    )
    if run_id is not None:
        proposal_stmt = proposal_stmt.where(ExtractionProposalRecord.run_id == run_id)

    proposals = (await db.execute(proposal_stmt)).scalars().all()

    # --- Step 2: dedup to latest-per-(instance_id, field_id) ---
    seen: set[tuple[UUID, UUID]] = set()
    deduped: list[ExtractionProposalRecord] = []
    for p in proposals:
        key = (p.instance_id, p.field_id)
        if key in seen:
            continue
        seen.add(key)
        deduped.append(p)

    if not deduped:
        return AISuggestionsResponse(suggestions=[], count=0)

    # --- Step 3: load evidence keyed by proposal_record_id ---
    proposal_ids = [p.id for p in deduped]
    evidence_rows = (
        (
            await db.execute(
                select(ExtractionEvidence).where(
                    ExtractionEvidence.proposal_record_id.in_(proposal_ids)
                )
            )
        )
        .scalars()
        .all()
    )
    evidence_by_proposal: dict[UUID, ExtractionEvidence] = {}
    for ev in evidence_rows:
        if ev.proposal_record_id and ev.proposal_record_id not in evidence_by_proposal:
            evidence_by_proposal[ev.proposal_record_id] = ev

    # --- Step 4: load CALLER's reviewer_states → decisions (blind boundary) ---
    state_stmt = (
        select(ExtractionReviewerState, ExtractionReviewerDecision)
        .join(
            ExtractionReviewerDecision,
            and_(
                ExtractionReviewerDecision.run_id == ExtractionReviewerState.run_id,
                ExtractionReviewerDecision.id == ExtractionReviewerState.current_decision_id,
            ),
        )
        .where(
            ExtractionReviewerState.instance_id.in_(instance_ids),
            ExtractionReviewerState.reviewer_id == caller_id,  # BLIND BOUNDARY
        )
    )
    if run_id is not None:
        state_stmt = state_stmt.where(ExtractionReviewerState.run_id == run_id)

    state_rows = (await db.execute(state_stmt)).all()

    # Map (instance_id, field_id) → decision string
    decision_by_coord: dict[tuple[UUID, UUID], str] = {}
    for state, decision in state_rows:
        coord = (state.instance_id, state.field_id)
        decision_by_coord[coord] = decision.decision

    # --- Step 5: build response items ---
    items: list[AISuggestionItem] = []
    for p in deduped:
        ev = evidence_by_proposal.get(p.id)
        evidence_resp = (
            EvidenceResponse(
                proposal_record_id=p.id,
                text_content=ev.text_content,
                page_number=ev.page_number,
            )
            if ev is not None
            else None
        )
        coord = (p.instance_id, p.field_id)
        status = _resolve_status(decision_by_coord.get(coord))
        items.append(
            AISuggestionItem(
                id=p.id,
                run_id=p.run_id,
                instance_id=p.instance_id,
                field_id=p.field_id,
                proposed_value=p.proposed_value,
                confidence_score=float(p.confidence_score)
                if p.confidence_score is not None
                else None,
                rationale=p.rationale,
                created_at=p.created_at,
                evidence=evidence_resp,
                status=status,
            )
        )

    return AISuggestionsResponse(suggestions=items, count=len(items))


async def get_suggestion_history(
    db: AsyncSession,
    instance_id: UUID,
    field_id: UUID,
    *,
    limit: int = 10,
) -> list[AISuggestionHistoryItem]:
    """Return AI proposals for a single (instance, field) coord, newest first.

    No status — history is the proposal trail only.
    Mirrors AISuggestionService.getHistory.
    """
    proposals = (
        (
            await db.execute(
                select(ExtractionProposalRecord)
                .where(
                    ExtractionProposalRecord.instance_id == instance_id,
                    ExtractionProposalRecord.field_id == field_id,
                    ExtractionProposalRecord.source == ExtractionProposalSource.AI.value,
                )
                .order_by(ExtractionProposalRecord.created_at.desc())
                .limit(limit)
            )
        )
        .scalars()
        .all()
    )

    if not proposals:
        return []

    proposal_ids = [p.id for p in proposals]
    evidence_rows = (
        (
            await db.execute(
                select(ExtractionEvidence).where(
                    ExtractionEvidence.proposal_record_id.in_(proposal_ids)
                )
            )
        )
        .scalars()
        .all()
    )
    evidence_by_proposal: dict[UUID, ExtractionEvidence] = {}
    for ev in evidence_rows:
        if ev.proposal_record_id and ev.proposal_record_id not in evidence_by_proposal:
            evidence_by_proposal[ev.proposal_record_id] = ev

    items: list[AISuggestionHistoryItem] = []
    for p in proposals:
        ev = evidence_by_proposal.get(p.id)
        evidence_resp = (
            EvidenceResponse(
                proposal_record_id=p.id,
                text_content=ev.text_content,
                page_number=ev.page_number,
            )
            if ev is not None
            else None
        )
        items.append(
            AISuggestionHistoryItem(
                id=p.id,
                run_id=p.run_id,
                instance_id=p.instance_id,
                field_id=p.field_id,
                proposed_value=p.proposed_value,
                confidence_score=float(p.confidence_score)
                if p.confidence_score is not None
                else None,
                rationale=p.rationale,
                created_at=p.created_at,
                evidence=evidence_resp,
            )
        )

    return items
