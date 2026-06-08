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

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.extraction import ExtractionRun, ExtractionRunStage
from app.models.extraction_workflow import (
    ExtractionConsensusDecision,
    ExtractionProposalRecord,
    ExtractionProposalSource,
    ExtractionPublishedState,
    ExtractionReviewerDecision,
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
from app.repositories.project_repository import ProjectMemberRepository
from app.schemas.extraction_run import (
    ConsensusDecisionResponse,
    ProposalRecordResponse,
    PublishedStateResponse,
    ReviewerDecisionResponse,
    RunDetailResponse,
    RunReviewerProfile,
    RunSummaryResponse,
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
    is_arbitrator: bool,
) -> RunDetailResponse:
    """Aggregate the full read-side view of a Run: header + every workflow
    row (proposals, reviewer decisions, consensus decisions, published
    states). Returns the response schema directly so the endpoint just wraps
    it in ApiResponse.success.

    Blind-review enforcement (API path): the backend reaches these tables as
    ``service_role`` (RLS bypassed), so this filter — not RLS — guards the
    server read. Unless the caller is an arbitrator (manager/consensus) or the
    run is ``finalized``, a reviewer sees only their OWN human proposals and
    reviewer decisions; AI/system proposals, consensus rulings and published
    states stay visible (shared, post-divergence artifacts). The predicate is
    identical to the reviewer-scoped RLS policies in migration
    ``0025_reviewer_scoped_select_rls`` so the two read paths never diverge.
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

    unblinded = is_arbitrator or run.stage == ExtractionRunStage.FINALIZED.value
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
