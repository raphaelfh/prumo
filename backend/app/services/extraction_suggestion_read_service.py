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

from typing import Any
from uuid import UUID

from pydantic import ValidationError
from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.extraction import (
    ExtractionEvidence,
    ExtractionInstance,
    ExtractionRun,
    ExtractionRunStage,
)
from app.models.extraction_workflow import (
    ExtractionProposalRecord,
    ExtractionProposalSource,
    ExtractionReviewerDecision,
    ExtractionReviewerDecisionType,
    ExtractionReviewerState,
)
from app.models.user import Profile
from app.schemas.extraction import parse_position
from app.schemas.extraction_suggestion import (
    AISuggestionHistoryItem,
    AISuggestionItem,
    AISuggestionsResponse,
    EvidenceResponse,
)
from app.services.extraction_run_read_service import (
    caller_can_see_peers,
    is_run_arbitrator,
)
from app.services.value_semantics import is_value_empty


def _extract_block_ids(ev: ExtractionEvidence) -> list[int]:
    """Return block_ids from the stored PositionV1 anchor, or [] on missing/invalid position."""
    if not ev.position:
        return []
    try:
        pos = parse_position(ev.position)
    except (ValidationError, ValueError):
        return []
    if pos is None:
        return []
    return list(pos.anchor.block_ids)


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


async def _load_run_provenance(
    db: AsyncSession,
    run_ids: set[UUID],
    *,
    caller_id: UUID,
    resolve_names: bool = False,
) -> tuple[dict[UUID, dict[str, Any] | None], set[UUID]]:
    """Fetch each run's provenance snapshot (extraction_runs.results['provenance'])
    in one query, so suggestions can show how they were generated without an
    N+1 — plus the set of runs whose ran-by IDENTITY the caller may see
    (D8-d). Legacy runs without provenance map to None.

    Reveal mirrors ``/view``'s unblind rules, applied PER RUN (the endpoint is
    article-scoped but reveal is run-scoped):
      finalized -> everyone (project membership was gated at the endpoint);
      consensus -> arbitrators (``is_run_arbitrator``);
      otherwise -> ``caller_can_see_peers`` (consensus role always; managers
      per ``settings.managers_see_reviewers[kind]``; reviewers/viewers never).

    When ``resolve_names`` is set, ``ran_by_user_id`` -> ``ran_by_name``
    injection runs ONLY for revealed runs — no profile lookup for names that
    would be scrubbed. Off by default: only the on-demand history path pays
    the extra lookup; the hot ``load_suggestions`` path stays query-lean.
    """
    if not run_ids:
        return {}, set()
    rows = (
        await db.execute(
            select(
                ExtractionRun.id,
                ExtractionRun.results,
                ExtractionRun.stage,
                ExtractionRun.project_id,
                ExtractionRun.kind,
            ).where(ExtractionRun.id.in_(run_ids))
        )
    ).all()
    prov_by_run: dict[UUID, dict[str, Any] | None] = {
        row.id: (row.results or {}).get("provenance") for row in rows
    }

    # One membership/setting probe per distinct (project, kind); one
    # arbitrator probe per project — an article's runs share both in practice.
    can_peers_cache: dict[tuple[UUID, str], bool] = {}
    arbitrator_cache: dict[UUID, bool] = {}
    revealed: set[UUID] = set()
    for row in rows:
        if row.stage == ExtractionRunStage.FINALIZED.value:
            revealed.add(row.id)
            continue
        peers_key = (row.project_id, row.kind)
        if peers_key not in can_peers_cache:
            can_peers_cache[peers_key] = await caller_can_see_peers(
                db, project_id=row.project_id, user_id=caller_id, kind=row.kind
            )
        if can_peers_cache[peers_key]:
            revealed.add(row.id)
            continue
        if row.stage == ExtractionRunStage.CONSENSUS.value:
            if row.project_id not in arbitrator_cache:
                arbitrator_cache[row.project_id] = await is_run_arbitrator(
                    db, row.project_id, caller_id
                )
            if arbitrator_cache[row.project_id]:
                revealed.add(row.id)

    if resolve_names and revealed:
        await _inject_ran_by_names(db, {rid: prov_by_run[rid] for rid in revealed})
    return prov_by_run, revealed


_RANBY_KEYS = ("ran_by_user_id", "ran_by_name")


def _scrub_ranby(provenance: dict[str, Any] | None) -> dict[str, Any] | None:
    """Strip ran-by identity from a RESOLVED snapshot for an unrevealed run.

    Operates on ``_resolve_section_provenance`` output, which is always a
    single leaf (it never returns a ``sections`` map — pinned by the
    section-provenance tests). Copy-on-scrub: the input aliases the run row's
    ``results`` payload and must not be mutated.
    """
    if not provenance or not any(k in provenance for k in _RANBY_KEYS):
        return provenance
    return {k: v for k, v in provenance.items() if k not in _RANBY_KEYS}


# Flat-snapshot marker keys — their presence on a run's provenance means it
# carries a legacy (or mixed-era) flat snapshot alongside any `sections` map.
_FLAT_SNAPSHOT_KEYS = ("model", "provider", "prompt_version", "prompt_text")


def _provenance_leaves(prov: dict[str, Any] | None) -> list[dict[str, Any]]:
    """The snapshot dicts on a run's provenance that can carry ``ran_by_user_id``:
    every per-section snapshot, plus the flat snapshot itself when present (legacy
    or the flat portion of a mixed-era run)."""
    if not prov:
        return []
    leaves: list[dict[str, Any]] = []
    sections = prov.get("sections")
    if isinstance(sections, dict):
        leaves.extend(s for s in sections.values() if isinstance(s, dict))
    if any(k in prov for k in _FLAT_SNAPSHOT_KEYS) or "ran_by_user_id" in prov:
        leaves.append(prov)
    return leaves


def _resolve_section_provenance(
    provenance: dict[str, Any] | None, entity_type_id: UUID | None
) -> dict[str, Any] | None:
    """Per-section snapshot for sectioned runs; the flat snapshot for legacy runs.

    - No provenance → None.
    - No ``sections`` map (legacy flat run) → the snapshot verbatim.
    - Sectioned run with a snapshot for this entity type → that snapshot.
    - Mixed-era run (flat keys + sections) with NO snapshot for this entity type
      → the flat snapshot (minus ``sections``), so a section extracted before this
      shipped keeps the display it had.
    - Pure-sectioned run with no snapshot for this entity type → None (never a
      sibling section's snapshot — that would mis-attribute provenance).
    """
    if not provenance:
        return None
    sections = provenance.get("sections")
    if not isinstance(sections, dict):
        return provenance
    snap: dict[str, Any] | None = sections.get(str(entity_type_id)) if entity_type_id else None
    if snap is not None:
        return snap
    if any(k in provenance for k in _FLAT_SNAPSHOT_KEYS):
        return {k: v for k, v in provenance.items() if k != "sections"}
    return None


async def _inject_ran_by_names(
    db: AsyncSession, prov_by_run: dict[UUID, dict[str, Any] | None]
) -> None:
    """Resolve each snapshot's ``ran_by_user_id`` to a ``ran_by_name`` in place.

    Walks both flat snapshots and every per-section snapshot. One batched
    ``profiles`` lookup for the distinct runner ids. A snapshot whose runner has
    no profile (or a malformed id) is left untouched — the "Ran by" row stays
    absent rather than showing a bare uuid.
    """
    leaves: list[dict[str, Any]] = []
    for prov in prov_by_run.values():
        leaves.extend(_provenance_leaves(prov))
    uuid_by_raw: dict[str, UUID] = {}
    for leaf in leaves:
        raw = leaf.get("ran_by_user_id")
        if raw is None or str(raw) in uuid_by_raw:
            continue
        try:
            uuid_by_raw[str(raw)] = UUID(str(raw))
        except (ValueError, TypeError):
            continue
    if not uuid_by_raw:
        return
    rows = (
        await db.execute(
            select(Profile.id, Profile.full_name).where(Profile.id.in_(list(uuid_by_raw.values())))
        )
    ).all()
    name_by_id = {str(pid): full_name for pid, full_name in rows if full_name}
    for leaf in leaves:
        name = name_by_id.get(str(leaf.get("ran_by_user_id")))
        if name:
            leaf["ran_by_name"] = name


async def load_suggestions(
    db: AsyncSession,
    instance_ids: list[UUID],
    *,
    article_id: UUID,
    caller_id: UUID,
    run_id: UUID | None = None,
) -> AISuggestionsResponse:
    """Return the latest AI proposal per (instance, field) with caller-scoped status.

    Mirrors AISuggestionService.loadSuggestions:
    1. Read ExtractionProposalRecord WHERE source='ai', instance_id IN instance_ids,
       optional run_id, ORDER BY created_at DESC.
       Scoped to article_id via JOIN on ExtractionInstance — instances that do not
       belong to the path article are silently dropped (cross-project IDOR guard).
    2. Dedup per (instance_id, field_id): the latest proposal wins, EXCEPT a
       later "no information" (null) proposal never buries an earlier real
       value — the most recent value-bearing proposal is preferred, falling
       back to the latest no-info only when no run found a value.
    3. Load evidence for the deduplicated proposal_ids.
    4. Load ExtractionReviewerState WHERE reviewer_id == caller_id (blind boundary)
       joined to ExtractionReviewerDecision via the composite FK for `.decision`.
    5. Derive status per (instance, field): reject → 'rejected', other → 'accepted', else 'pending'.
    """
    if not instance_ids:
        return AISuggestionsResponse(suggestions=[], count=0)

    # --- Step 1: fetch AI proposals ordered newest-first ---
    # JOIN through ExtractionInstance to enforce article_id scope.
    # Any instance_id that does not belong to this article is excluded
    # at the database level — no second round-trip needed.
    proposal_stmt = (
        select(ExtractionProposalRecord)
        .join(
            ExtractionInstance,
            and_(
                ExtractionInstance.id == ExtractionProposalRecord.instance_id,
                ExtractionInstance.article_id == article_id,
            ),
        )
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
    # Value-vs-value recency: the newest proposal that CARRIES A VALUE wins.
    # "Carries a value" is the shared emptiness oracle (``is_value_empty``), so a
    # coded ``no_information`` marker (ADR-0016) counts as a genuine answer and
    # may win by recency like any real value — only a *bare* ``{"value": null}``
    # abstention (no marker) is buryable and must NOT overwrite an earlier
    # resolved value. So: prefer the newest non-empty proposal (real value OR
    # marker); fall back to the newest bare-null only when no run ever resolved
    # the coord. The full trail stays available via get_suggestion_history.
    # ``proposals`` is ordered newest-first, so dict insertion order keeps the
    # latest per coord.
    chosen: dict[tuple[UUID, UUID], ExtractionProposalRecord] = {}
    for p in proposals:
        key = (p.instance_id, p.field_id)
        existing = chosen.get(key)
        if existing is None:
            chosen[key] = p
        elif is_value_empty(existing.proposed_value) and not is_value_empty(p.proposed_value):
            # The newer pick is a bare-null abstention; this older one resolved
            # the coord (a real value OR a coded marker) → keep the resolved one.
            chosen[key] = p
    deduped = list(chosen.values())

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
    evidence_by_proposal: dict[UUID, list[ExtractionEvidence]] = {}
    for ev in evidence_rows:
        if ev.proposal_record_id:
            evidence_by_proposal.setdefault(ev.proposal_record_id, []).append(ev)
    for rows in evidence_by_proposal.values():
        rows.sort(key=lambda e: (e.rank, str(e.id)))

    # --- Step 4: load CALLER's reviewer_states → decisions (blind boundary) ---
    # NOTE: this query is intentionally NOT filtered by article — article scope is
    # enforced transitively: the resulting decision_by_coord map is only consulted
    # for proposals that passed the article-scoped dedup above, so a status row
    # for a foreign instance can never attach to a returned item.  Do NOT add an
    # article join here; the intersection IS the guard.
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
    prov_by_run, ranby_revealed = await _load_run_provenance(
        db, {p.run_id for p in deduped}, caller_id=caller_id
    )
    # Map each deduped proposal's instance → entity type so per-section
    # provenance resolves to the right section snapshot.
    et_rows = (
        await db.execute(
            select(ExtractionInstance.id, ExtractionInstance.entity_type_id).where(
                ExtractionInstance.id.in_({p.instance_id for p in deduped})
            )
        )
    ).all()
    et_by_instance: dict[UUID, UUID] = {}
    for iid, etid in et_rows:
        et_by_instance[iid] = etid
    for p in deduped:
        evidence_list = [
            EvidenceResponse(
                proposal_record_id=p.id,
                text_content=ev.text_content,
                page_number=ev.page_number,
                blockIds=_extract_block_ids(ev),
                rank=ev.rank,
                attributionLabel=ev.attribution_label,
            )
            for ev in evidence_by_proposal.get(p.id, [])
        ]
        coord = (p.instance_id, p.field_id)
        status = _resolve_status(decision_by_coord.get(coord))
        provenance = _resolve_section_provenance(
            prov_by_run.get(p.run_id), et_by_instance.get(p.instance_id)
        )
        if p.run_id not in ranby_revealed:
            provenance = _scrub_ranby(provenance)
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
                evidence=evidence_list,
                status=status,
                provenance=provenance,
            )
        )

    return AISuggestionsResponse(suggestions=items, count=len(items))


async def get_suggestion_history(
    db: AsyncSession,
    instance_id: UUID,
    field_id: UUID,
    *,
    article_id: UUID,
    caller_id: UUID,
    limit: int = 10,
) -> list[AISuggestionHistoryItem]:
    """Return AI proposals for a single (instance, field) coord, newest first.

    No status — history is the proposal trail only.
    Scoped to article_id via JOIN on ExtractionInstance — if the instance does
    not belong to the path article, an empty list is returned (cross-project
    IDOR guard, mirrors the RLS protection the old PostgREST path had).
    ``caller_id`` (required, fail-closed) drives the D8-d ran-by scrub: items
    whose run does not reveal identity to the caller lose
    ``ran_by_user_id``/``ran_by_name`` (see ``_load_run_provenance``).
    Mirrors AISuggestionService.getHistory.
    """
    proposals = (
        (
            await db.execute(
                select(ExtractionProposalRecord)
                .join(
                    ExtractionInstance,
                    and_(
                        ExtractionInstance.id == ExtractionProposalRecord.instance_id,
                        ExtractionInstance.article_id == article_id,
                    ),
                )
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
    evidence_by_proposal: dict[UUID, list[ExtractionEvidence]] = {}
    for ev in evidence_rows:
        if ev.proposal_record_id:
            evidence_by_proposal.setdefault(ev.proposal_record_id, []).append(ev)
    for rows in evidence_by_proposal.values():
        rows.sort(key=lambda e: (e.rank, str(e.id)))

    items: list[AISuggestionHistoryItem] = []
    # History feeds the review popover (the "How this was generated" surface
    # and the run-group "Run by" headers) — resolve the runner's display name
    # for REVEALED runs only, so the frontend needs no profiles join and a
    # blind caller's payload never carries the identity at all.
    prov_by_run, ranby_revealed = await _load_run_provenance(
        db, {p.run_id for p in proposals}, caller_id=caller_id, resolve_names=True
    )
    # All proposals share this coord's instance → one entity-type lookup resolves
    # the per-section snapshot for every item.
    entity_type_id = (
        await db.execute(
            select(ExtractionInstance.entity_type_id).where(ExtractionInstance.id == instance_id)
        )
    ).scalar_one_or_none()
    for p in proposals:
        evidence_list = [
            EvidenceResponse(
                proposal_record_id=p.id,
                text_content=ev.text_content,
                page_number=ev.page_number,
                blockIds=_extract_block_ids(ev),
                rank=ev.rank,
                attributionLabel=ev.attribution_label,
            )
            for ev in evidence_by_proposal.get(p.id, [])
        ]
        provenance = _resolve_section_provenance(prov_by_run.get(p.run_id), entity_type_id)
        if p.run_id not in ranby_revealed:
            provenance = _scrub_ranby(provenance)
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
                evidence=evidence_list,
                provenance=provenance,
            )
        )

    return items
