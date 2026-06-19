"""Read-side service for ExtractionRun + its workflow rows.

Owns the queries the API layer was doing inline (3 repository
instantiations in `get_run`, 4 raw `select(Model).where(...)` in
`list_run_reviewers`, the `db.get(ExtractionRun, run_id)` in
`_load_run_and_check_member`). The endpoint module now imports from
this service only — never directly from models or repositories.

Errors are domain exceptions; HTTP translation happens in the router.
"""

from __future__ import annotations

from uuid import UUID

from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.extraction import ExtractionEntityType, ExtractionRun, ExtractionRunStage
from app.models.extraction_versioning import ExtractionTemplateVersion
from app.models.extraction_workflow import (
    ExtractionConsensusDecision,
    ExtractionProposalRecord,
    ExtractionProposalSource,
    ExtractionPublishedState,
    ExtractionReviewerDecision,
    ExtractionReviewerState,
)
from app.models.project import ProjectMemberRole
from app.models.user import Profile
from app.repositories.extraction_consensus_decision_repository import (
    ExtractionConsensusDecisionRepository,
)
from app.repositories.extraction_proposal_repository import (
    ExtractionProposalRepository,
)
from app.repositories.extraction_reviewer_decision_repository import (
    ExtractionReviewerDecisionRepository,
)
from app.repositories.project_repository import ProjectMemberRepository, ProjectRepository
from app.schemas.extraction_run import (
    ArticleRunRef,
    ConsensusDecisionResponse,
    ProposalRecordResponse,
    PublishedStateResponse,
    ReviewerDecisionResponse,
    RunDetailResponse,
    RunReviewerProfile,
    RunSummaryResponse,
    RunViewCurrentValue,
    RunViewEntityType,
    RunViewResponse,
)


class RunNotFoundError(Exception):
    """Raised when a Run lookup returns no row. HTTP translation in router."""


async def get_run_or_raise(db: AsyncSession, run_id: UUID) -> RunSummaryResponse:
    """Load a Run by id and return it as a RunSummaryResponse schema.

    Raises RunNotFoundError when no row matches. The schema (not the ORM)
    is returned so the endpoint module never touches `app.models.*`.
    """
    run = await db.get(ExtractionRun, run_id)
    if run is None:
        raise RunNotFoundError(f"Run {run_id} not found")
    return RunSummaryResponse.model_validate(run)


async def get_run_with_workflow_history(
    db: AsyncSession,
    run_id: UUID,
    *,
    caller_id: UUID,
    can_see_peers: bool,
) -> RunDetailResponse:
    """Aggregate the full read-side view of a Run: header + every workflow
    row (proposals, reviewer decisions, consensus decisions, published
    states). Returns the response schema directly so the endpoint just wraps
    it in ApiResponse.success.

    Blind-review enforcement (API path): the backend reaches these tables as
    ``service_role`` (RLS bypassed), so this filter — not RLS — guards the
    server read. Unless the caller can see peers (consensus member, or a
    manager with the live per-kind setting on) or the run is ``finalized``,
    a reviewer sees only their OWN human proposals and reviewer decisions;
    AI/system proposals, consensus rulings and published states stay visible
    (shared, post-divergence artifacts).

    NOTE on the deliberate API-stricter-than-RLS split for managers: the
    reviewer↔reviewer boundary is enforced identically here AND in RLS
    migration ``0025_reviewer_scoped_select_rls`` AND in
    ``resolve_caller_current_values`` (lockstep copies). The MANAGER case is
    intentionally handled ONLY at the API/app layer via the live per-kind
    ``managers_see_reviewers`` project setting — RLS 0025 still allows
    managers through (it only restricts the ``reviewer`` role), so the
    stricter gate lives here via ``can_see_peers``. Do NOT move the manager
    check into RLS or ``resolve_caller_current_values``.
    """
    run = await db.get(ExtractionRun, run_id)
    if run is None:
        raise RunNotFoundError(f"Run {run_id} not found")

    proposals = await ExtractionProposalRepository(db).list_by_run(run_id)
    decisions = await ExtractionReviewerDecisionRepository(db).list_by_run(run_id)
    consensus = await ExtractionConsensusDecisionRepository(db).list_by_run(run_id)
    published_rows = (
        (
            await db.execute(
                select(ExtractionPublishedState).where(ExtractionPublishedState.run_id == run_id)
            )
        )
        .scalars()
        .all()
    )

    unblinded = can_see_peers or run.stage == ExtractionRunStage.FINALIZED.value
    if unblinded:
        visible_proposals = proposals
        visible_decisions = decisions
    else:
        visible_proposals = [
            p
            for p in proposals
            if p.source != ExtractionProposalSource.HUMAN.value or p.source_user_id == caller_id
        ]
        visible_decisions = [d for d in decisions if d.reviewer_id == caller_id]

    return RunDetailResponse(
        run=RunSummaryResponse.model_validate(run),
        proposals=[ProposalRecordResponse.model_validate(p) for p in visible_proposals],
        decisions=[ReviewerDecisionResponse.model_validate(d) for d in visible_decisions],
        consensus_decisions=[ConsensusDecisionResponse.model_validate(c) for c in consensus],
        published_states=[PublishedStateResponse.model_validate(ps) for ps in published_rows],
    )


def _snapshot_is_narrow(entity_types: list[dict]) -> bool:
    """A pre-0026 snapshot is detected by its first entity_type lacking 'role'.
    Empty trees are treated as narrow so the live fallback repopulates them —
    a legitimately empty template just round-trips to an empty live read, which
    is the correct (if marginally wasteful) recovery, not a structural read to
    'optimize away'."""
    return not entity_types or "role" not in entity_types[0]


async def _entity_types_for_run(
    db: AsyncSession, run: RunSummaryResponse
) -> list[RunViewEntityType]:
    """Frozen entity_types tree from the run's version snapshot, with a live
    read fallback for pre-0026 narrow snapshots (belt-and-suspenders: migration
    0026 backfills these, but the fallback turns a 'silent broken study/model
    partition' into a correct live render if any narrow snapshot slips through).
    Both paths produce the same shape via ``model_validate``."""
    version = await db.get(ExtractionTemplateVersion, run.version_id)
    snapshot_types: list[dict] = (version.schema_ or {}).get("entity_types", []) if version else []
    if not _snapshot_is_narrow(snapshot_types):
        return [RunViewEntityType.model_validate(et) for et in snapshot_types]

    # Live fallback — one statement, fields eager-loaded (selectinload), then
    # model_validate straight off the ORM (RunViewEntityType/RunViewField carry
    # from_attributes=True). The relationship is not guaranteed field-ordered,
    # so sort the validated fields by sort_order to match the snapshot path.
    et_rows = (
        (
            await db.execute(
                select(ExtractionEntityType)
                .where(ExtractionEntityType.project_template_id == run.template_id)
                .options(selectinload(ExtractionEntityType.fields))
                .order_by(ExtractionEntityType.sort_order)
            )
        )
        .scalars()
        .all()
    )
    result: list[RunViewEntityType] = []
    for et in et_rows:
        view_et = RunViewEntityType.model_validate(et)
        view_et.fields.sort(key=lambda f: f.sort_order)
        result.append(view_et)
    return result


async def resolve_caller_current_values(
    db: AsyncSession, run_id: UUID, *, caller_id: UUID
) -> list[RunViewCurrentValue]:
    """The caller's current value per (instance, field) coordinate.

    Mirrors the frontend ``loadValuesForUser`` it replaces, value-for-value:
      Layer 1 (base): the caller's own human proposals, newest-per-coord;
      Layer 2 (override): the caller's current reviewer decision per coord,
        resolved through the materialized ``extraction_reviewer_states`` pointer
        (``current_decision_id`` -> the live ``extraction_reviewer_decisions`` row).
    ``reject`` decisions are kept (the client clears the coord but the audit row
    stays). Caller-scoped: only ``reviewer_id == caller_id`` /
    ``source_user_id == caller_id`` rows — this is the 4th lockstep copy of the
    blind predicate and MUST stay identical to migration 0025 + the service
    filter in get_run_with_workflow_history.

    NOTE: ``ExtractionExportService._build_single_user_value_map`` looks similar
    but encodes a DIFFERENT contract (it sources ``accept_proposal`` from the
    accepted proposal and drops ``reject``, with no human-proposal base layer).
    This resolver mirrors the FRONTEND ``loadValuesForUser`` it replaces, not the
    export contract — do NOT DRY them together, or run-open values diverge from
    the form's current behavior (Invariant 6). The two reads below are
    independent but run sequentially on the shared AsyncSession (a single
    asyncpg connection cannot multiplex, so ``asyncio.gather`` here is unsafe);
    this matches the sequential read pattern of the composed
    get_run_with_workflow_history. Merging them into one CTE is a possible future
    optimization, deliberately not taken here to keep this security-sensitive
    resolver simple.
    """
    merged: dict[tuple[UUID, UUID], RunViewCurrentValue] = {}

    # Layer 1 — caller's own human proposals, newest-first; first-per-coord wins
    # (ties on created_at are skipped by the `key in merged` guard below).
    proposal_rows = (
        (
            await db.execute(
                select(ExtractionProposalRecord)
                .where(
                    ExtractionProposalRecord.run_id == run_id,
                    ExtractionProposalRecord.source == ExtractionProposalSource.HUMAN.value,
                    ExtractionProposalRecord.source_user_id == caller_id,
                )
                .order_by(ExtractionProposalRecord.created_at.desc())
            )
        )
        .scalars()
        .all()
    )
    for p in proposal_rows:
        key = (p.instance_id, p.field_id)
        if key in merged:
            continue
        merged[key] = RunViewCurrentValue(
            instance_id=p.instance_id,
            field_id=p.field_id,
            value=p.proposed_value,
            decision="human_proposal",
        )

    # Layer 2 — caller's current reviewer decision per coord (overrides Layer 1).
    state_rows = (
        await db.execute(
            select(ExtractionReviewerState, ExtractionReviewerDecision)
            .join(
                ExtractionReviewerDecision,
                and_(
                    ExtractionReviewerDecision.run_id == ExtractionReviewerState.run_id,
                    ExtractionReviewerDecision.id == ExtractionReviewerState.current_decision_id,
                ),
            )
            .where(
                ExtractionReviewerState.run_id == run_id,
                ExtractionReviewerState.reviewer_id == caller_id,
            )
        )
    ).all()
    for state, decision in state_rows:
        merged[(state.instance_id, state.field_id)] = RunViewCurrentValue(
            instance_id=state.instance_id,
            field_id=state.field_id,
            value=decision.value,
            decision=decision.decision,
        )

    return list(merged.values())


# Stages whose form hydrates from the materialized reviewer_states + decisions
# (current_values). In 'proposal' the client uses proposals[]; pending/cancelled
# show nothing.
_CURRENT_VALUE_STAGES = frozenset(
    {
        ExtractionRunStage.REVIEW.value,
        ExtractionRunStage.CONSENSUS.value,
        ExtractionRunStage.FINALIZED.value,
    }
)


async def build_run_view(
    db: AsyncSession, run_id: UUID, *, caller_id: UUID, can_see_peers: bool
) -> RunViewResponse:
    """The one-round-trip run-open view: the blind-filtered run detail plus the
    frozen entity_types tree and the caller's current_values. COMPOSES
    get_run_with_workflow_history (the single blind filter) — it never re-queries
    the workflow tables, so the blind boundary cannot drift. The composed
    ``detail.run`` (a RunSummaryResponse) already carries ``version_id`` /
    ``template_id`` / ``stage`` / ``article_id``, so there is no second ORM
    fetch of the run here."""
    detail = await get_run_with_workflow_history(
        db, run_id, caller_id=caller_id, can_see_peers=can_see_peers
    )

    entity_types = await _entity_types_for_run(db, detail.run)
    current_values = (
        await resolve_caller_current_values(db, run_id, caller_id=caller_id)
        if detail.run.stage in _CURRENT_VALUE_STAGES
        else []
    )

    return RunViewResponse(
        run=detail.run,
        proposals=detail.proposals,
        decisions=detail.decisions,
        consensus_decisions=detail.consensus_decisions,
        published_states=detail.published_states,
        entity_types=entity_types,
        current_values=current_values,
    )


async def is_run_arbitrator(db: AsyncSession, project_id: UUID, user_id: UUID) -> bool:
    """True when the user is a project ``manager`` or ``consensus`` member —
    the roles allowed to see cross-reviewer divergence before a run is
    finalized. The run-read endpoint uses this to decide whether to blind the
    workflow history. Kept in the service layer so the endpoint imports only
    from ``app.services`` (layered-architecture rule).
    """
    member = await ProjectMemberRepository(db).get_member(project_id, user_id)
    return member is not None and member.role in (
        ProjectMemberRole.MANAGER,
        ProjectMemberRole.CONSENSUS,
    )


async def caller_can_see_peers(
    db: AsyncSession, *, project_id: UUID, user_id: UUID, kind: str
) -> bool:
    """Read-blinding decision (distinct from is_run_arbitrator's resolution role).

    consensus members always see peers; reviewers/viewers never; managers see
    peers only when the project's live, per-kind setting
    ``settings.managers_see_reviewers[kind]`` is true. Finalized-stage opening is
    handled by the run-stage branch in get_run_with_workflow_history, not here.

    Deliberately SEPARATE from is_run_arbitrator: that predicate gates
    consensus-resolution permission (manager+consensus → True). This one gates
    read visibility and has different semantics for managers.
    """
    member = await ProjectMemberRepository(db).get_member(project_id, user_id)
    if member is None:
        return False
    if member.role == ProjectMemberRole.CONSENSUS:
        return True
    if member.role == ProjectMemberRole.MANAGER:
        project = await ProjectRepository(db).get_by_id(project_id)
        settings = (project.settings if project else None) or {}
        per_kind = settings.get("managers_see_reviewers") or {}
        return bool(per_kind.get(kind, False))
    return False


async def list_run_participants(db: AsyncSession, run_id: UUID) -> list[RunReviewerProfile]:
    """Aggregate every user_id that participated in the run (as human
    proposer, reviewer, or arbitrator) and resolve to display profiles.
    """
    user_ids: set[UUID] = set()

    proposal_users = (
        (
            await db.execute(
                select(ExtractionProposalRecord.source_user_id).where(
                    ExtractionProposalRecord.run_id == run_id,
                    ExtractionProposalRecord.source_user_id.is_not(None),
                )
            )
        )
        .scalars()
        .all()
    )
    user_ids.update(uid for uid in proposal_users if uid is not None)

    decision_users = (
        (
            await db.execute(
                select(ExtractionReviewerDecision.reviewer_id).where(
                    ExtractionReviewerDecision.run_id == run_id,
                )
            )
        )
        .scalars()
        .all()
    )
    user_ids.update(decision_users)

    consensus_users = (
        (
            await db.execute(
                select(ExtractionConsensusDecision.consensus_user_id).where(
                    ExtractionConsensusDecision.run_id == run_id,
                )
            )
        )
        .scalars()
        .all()
    )
    user_ids.update(consensus_users)

    if not user_ids:
        return []

    profiles = (
        (await db.execute(select(Profile).where(Profile.id.in_(list(user_ids))))).scalars().all()
    )

    return [
        RunReviewerProfile(
            id=p.id,
            full_name=p.full_name,
            avatar_url=p.avatar_url,
        )
        for p in profiles
    ]


# ---------------------------------------------------------------------------
# Article-scoped run-resolution queries
# ---------------------------------------------------------------------------

_ACTIVE_STAGES = (
    ExtractionRunStage.PENDING.value,
    ExtractionRunStage.PROPOSAL.value,
    ExtractionRunStage.REVIEW.value,
    ExtractionRunStage.CONSENSUS.value,
)


async def find_active_run(
    db: AsyncSession,
    article_id: UUID,
    *,
    template_id: UUID | None = None,
) -> RunSummaryResponse | None:
    """Return the latest non-terminal extraction run for the article, or None.

    Parity with frontend ``findActiveRun``:
    - kind = 'extraction'
    - stage IN (pending, proposal, review, consensus)
    - optional template_id filter
    - ordered by created_at DESC, newest wins
    """
    stmt = (
        select(ExtractionRun)
        .where(
            ExtractionRun.article_id == article_id,
            ExtractionRun.kind == "extraction",
            ExtractionRun.stage.in_(_ACTIVE_STAGES),
        )
        .order_by(ExtractionRun.created_at.desc())
        .limit(1)
    )
    if template_id is not None:
        stmt = stmt.where(ExtractionRun.template_id == template_id)

    run = (await db.execute(stmt)).scalars().first()
    return RunSummaryResponse.model_validate(run) if run is not None else None


async def find_finalized_run(
    db: AsyncSession,
    article_id: UUID,
    *,
    template_id: UUID | None = None,
) -> RunSummaryResponse | None:
    """Return the latest finalized extraction run for the article, or None.

    Parity with frontend ``findLatestFinalizedRun``:
    - kind = 'extraction'
    - stage = 'finalized'
    - optional template_id filter
    - ordered by created_at DESC, newest wins
    """
    stmt = (
        select(ExtractionRun)
        .where(
            ExtractionRun.article_id == article_id,
            ExtractionRun.kind == "extraction",
            ExtractionRun.stage == ExtractionRunStage.FINALIZED.value,
        )
        .order_by(ExtractionRun.created_at.desc())
        .limit(1)
    )
    if template_id is not None:
        stmt = stmt.where(ExtractionRun.template_id == template_id)

    run = (await db.execute(stmt)).scalars().first()
    return RunSummaryResponse.model_validate(run) if run is not None else None


async def resolve_form_runs(
    db: AsyncSession,
    article_ids: list[UUID],
    *,
    template_id: UUID,
) -> list[ArticleRunRef]:
    """Resolve the latest relevant run per article for the extraction form.

    Parity with frontend ``findFormRunsByArticle``:
    - Per article: latest non-terminal run; else latest finalized run.
    - Cancelled runs are excluded.
    - Returns one ArticleRunRef per input article_id (run_id=None when no run).
    """
    if not article_ids:
        return []

    non_terminal_stages = list(_ACTIVE_STAGES)
    # Fetch all candidate runs in one query, ordered so that non-terminal
    # stages sort before finalized (within each article, newest first).
    stmt = (
        select(ExtractionRun)
        .where(
            ExtractionRun.article_id.in_(article_ids),
            ExtractionRun.template_id == template_id,
            ExtractionRun.kind == "extraction",
            ExtractionRun.stage.in_([*non_terminal_stages, ExtractionRunStage.FINALIZED.value]),
        )
        .order_by(
            ExtractionRun.article_id,
            ExtractionRun.created_at.desc(),
        )
    )
    rows = (await db.execute(stmt)).scalars().all()

    # Build a per-article result: prefer non-terminal over finalized, newest first.
    # The ORDER BY created_at DESC means within each article the newest appears first.
    best: dict[UUID, ExtractionRun] = {}
    for row in rows:
        aid = row.article_id
        if aid not in best:
            best[aid] = row
            continue
        existing = best[aid]
        # Prefer non-terminal over finalized
        existing_active = existing.stage in non_terminal_stages
        row_active = row.stage in non_terminal_stages
        if row_active and not existing_active:
            best[aid] = row

    return [
        ArticleRunRef(article_id=aid, run_id=best[aid].id if aid in best else None)
        for aid in article_ids
    ]
