"""Endpoints for the unified extraction HITL flow at /v1/runs/...

Every error path here logs once with a structured event name + run_id +
trace_id context so SRE can grep for the failure mode without parsing
HTTP response bodies. The success paths log at info level for the
state-transition events (run created, stage advanced) since those are
the ones that drive consensus + publish later.
"""

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import select

from app.api.deps.security import get_current_user_sub
from app.core.deps import DbSession
from app.core.logging import get_logger
from app.models.extraction import ExtractionRun
from app.models.extraction_workflow import (
    ExtractionConsensusDecision,
    ExtractionProposalRecord,
    ExtractionPublishedState,
    ExtractionReviewerDecision,
)
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
from app.schemas.common import ApiResponse
from app.schemas.extraction_run import (
    AdvanceStageRequest,
    ConsensusDecisionResponse,
    ConsensusResultResponse,
    CreateConsensusRequest,
    CreateDecisionRequest,
    CreateProposalRequest,
    CreateRunRequest,
    ProposalRecordResponse,
    PublishedStateResponse,
    ReviewerDecisionResponse,
    RunDetailResponse,
    RunReviewerProfile,
    RunReviewersResponse,
    RunSummaryResponse,
)
from app.services.coordinate_coherence import CoordinateMismatchError
from app.services.extraction_consensus_service import (
    ExtractionConsensusService,
    InvalidConsensusError,
    OptimisticConcurrencyError,
)
from app.services.extraction_proposal_service import (
    ExtractionProposalService,
    InvalidProposalError,
)
from app.services.extraction_review_service import (
    ExtractionReviewService,
    InvalidDecisionError,
)
from app.services.run_lifecycle_service import (
    CannotReopenRunError,
    InvalidStageTransitionError,
    RunLifecycleService,
    TemplateNotFoundError,
    TemplateVersionNotFoundError,
)

logger = get_logger(__name__)

router = APIRouter()


def _trace(request: Request) -> str | None:
    return getattr(request.state, "trace_id", None)


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_run(
    body: CreateRunRequest,
    request: Request,
    db: DbSession,
    current_user_sub: UUID = Depends(get_current_user_sub),
) -> ApiResponse[RunSummaryResponse]:
    service = RunLifecycleService(db)
    trace_id = _trace(request)
    try:
        run = await service.create_run(
            project_id=body.project_id,
            article_id=body.article_id,
            project_template_id=body.project_template_id,
            user_id=current_user_sub,
            parameters=body.parameters,
        )
    except (TemplateNotFoundError, TemplateVersionNotFoundError) as e:
        logger.warning(
            "hitl_run_create_template_missing",
            trace_id=trace_id,
            project_template_id=str(body.project_template_id),
            article_id=str(body.article_id),
            error=str(e),
        )
        raise HTTPException(status_code=404, detail=str(e)) from e
    await db.commit()
    logger.info(
        "hitl_run_created",
        trace_id=trace_id,
        run_id=str(run.id),
        kind=run.kind,
        stage=run.stage,
        project_template_id=str(body.project_template_id),
        article_id=str(body.article_id),
    )
    return ApiResponse.success(
        RunSummaryResponse.model_validate(run),
        trace_id=trace_id,
    )


@router.get("/{run_id}")
async def get_run(
    run_id: UUID,
    request: Request,
    db: DbSession,
    current_user_sub: UUID = Depends(get_current_user_sub),  # noqa: ARG001
) -> ApiResponse[RunDetailResponse]:
    run = await db.get(ExtractionRun, run_id)
    if run is None:
        raise HTTPException(status_code=404, detail=f"Run {run_id} not found")
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

    return ApiResponse.success(
        RunDetailResponse(
            run=RunSummaryResponse.model_validate(run),
            proposals=[ProposalRecordResponse.model_validate(p) for p in proposals],
            decisions=[ReviewerDecisionResponse.model_validate(d) for d in decisions],
            consensus_decisions=[ConsensusDecisionResponse.model_validate(c) for c in consensus],
            published_states=[PublishedStateResponse.model_validate(ps) for ps in published_rows],
        ),
        trace_id=getattr(request.state, "trace_id", None),
    )


@router.post("/{run_id}/proposals", status_code=status.HTTP_201_CREATED)
async def create_proposal(
    run_id: UUID,
    body: CreateProposalRequest,
    request: Request,
    db: DbSession,
    current_user_sub: UUID = Depends(get_current_user_sub),
) -> ApiResponse[ProposalRecordResponse]:
    service = ExtractionProposalService(db)
    trace_id = _trace(request)
    # source='human' requires a user attribution. Default to the
    # authenticated caller so clients don't have to thread it through.
    source_user_id = body.source_user_id
    if body.source == "human" and source_user_id is None:
        source_user_id = current_user_sub
    try:
        record = await service.record_proposal(
            run_id=run_id,
            instance_id=body.instance_id,
            field_id=body.field_id,
            source=body.source,
            proposed_value=body.proposed_value,
            source_user_id=source_user_id,
            confidence_score=body.confidence_score,
            rationale=body.rationale,
        )
    except CoordinateMismatchError as e:
        logger.warning(
            "hitl_proposal_coord_mismatch",
            trace_id=trace_id,
            run_id=str(run_id),
            instance_id=str(body.instance_id),
            field_id=str(body.field_id),
            error=str(e),
        )
        raise HTTPException(status_code=422, detail=str(e)) from e
    except InvalidProposalError as e:
        logger.warning(
            "hitl_proposal_rejected",
            trace_id=trace_id,
            run_id=str(run_id),
            instance_id=str(body.instance_id),
            field_id=str(body.field_id),
            source=str(body.source),
            error=str(e),
        )
        raise HTTPException(status_code=400, detail=str(e)) from e
    await db.commit()
    return ApiResponse.success(
        ProposalRecordResponse.model_validate(record),
        trace_id=trace_id,
    )


@router.post("/{run_id}/decisions", status_code=status.HTTP_201_CREATED)
async def create_decision(
    run_id: UUID,
    body: CreateDecisionRequest,
    request: Request,
    db: DbSession,
    current_user_sub: UUID = Depends(get_current_user_sub),
) -> ApiResponse[ReviewerDecisionResponse]:
    service = ExtractionReviewService(db)
    trace_id = _trace(request)
    try:
        record = await service.record_decision(
            run_id=run_id,
            instance_id=body.instance_id,
            field_id=body.field_id,
            reviewer_id=current_user_sub,
            decision=body.decision,
            proposal_record_id=body.proposal_record_id,
            value=body.value,
            rationale=body.rationale,
        )
    except CoordinateMismatchError as e:
        logger.warning(
            "hitl_decision_coord_mismatch",
            trace_id=trace_id,
            run_id=str(run_id),
            instance_id=str(body.instance_id),
            field_id=str(body.field_id),
            error=str(e),
        )
        raise HTTPException(status_code=422, detail=str(e)) from e
    except InvalidDecisionError as e:
        logger.warning(
            "hitl_decision_rejected",
            trace_id=trace_id,
            run_id=str(run_id),
            decision=str(body.decision),
            instance_id=str(body.instance_id),
            field_id=str(body.field_id),
            error=str(e),
        )
        raise HTTPException(status_code=400, detail=str(e)) from e
    await db.commit()
    return ApiResponse.success(
        ReviewerDecisionResponse.model_validate(record),
        trace_id=trace_id,
    )


@router.post("/{run_id}/consensus", status_code=status.HTTP_201_CREATED)
async def create_consensus(
    run_id: UUID,
    body: CreateConsensusRequest,
    request: Request,
    db: DbSession,
    current_user_sub: UUID = Depends(get_current_user_sub),
) -> ApiResponse[ConsensusResultResponse]:
    service = ExtractionConsensusService(db)
    trace_id = _trace(request)
    try:
        consensus, published = await service.record_consensus(
            run_id=run_id,
            instance_id=body.instance_id,
            field_id=body.field_id,
            consensus_user_id=current_user_sub,
            mode=body.mode,
            selected_decision_id=body.selected_decision_id,
            value=body.value,
            rationale=body.rationale,
        )
    except CoordinateMismatchError as e:
        logger.warning(
            "hitl_consensus_coord_mismatch",
            trace_id=trace_id,
            run_id=str(run_id),
            instance_id=str(body.instance_id),
            field_id=str(body.field_id),
            error=str(e),
        )
        raise HTTPException(status_code=422, detail=str(e)) from e
    except InvalidConsensusError as e:
        logger.warning(
            "hitl_consensus_rejected",
            trace_id=trace_id,
            run_id=str(run_id),
            mode=str(body.mode),
            error=str(e),
        )
        raise HTTPException(status_code=400, detail=str(e)) from e
    except OptimisticConcurrencyError as e:
        logger.warning(
            "hitl_consensus_optimistic_conflict",
            trace_id=trace_id,
            run_id=str(run_id),
            instance_id=str(body.instance_id),
            field_id=str(body.field_id),
            error=str(e),
        )
        raise HTTPException(status_code=409, detail=str(e)) from e
    await db.commit()
    logger.info(
        "hitl_consensus_published",
        trace_id=trace_id,
        run_id=str(run_id),
        instance_id=str(body.instance_id),
        field_id=str(body.field_id),
        mode=str(body.mode),
        published_version=published.version,
    )
    return ApiResponse.success(
        ConsensusResultResponse(
            consensus=ConsensusDecisionResponse.model_validate(consensus),
            published=PublishedStateResponse.model_validate(published),
        ),
        trace_id=trace_id,
    )


@router.post("/{run_id}/advance")
async def advance_run(
    run_id: UUID,
    body: AdvanceStageRequest,
    request: Request,
    db: DbSession,
    current_user_sub: UUID = Depends(get_current_user_sub),
) -> ApiResponse[RunSummaryResponse]:
    service = RunLifecycleService(db)
    trace_id = _trace(request)
    try:
        run = await service.advance_stage(
            run_id=run_id,
            target_stage=body.target_stage,
            user_id=current_user_sub,
        )
    except InvalidStageTransitionError as e:
        logger.warning(
            "hitl_stage_transition_rejected",
            trace_id=trace_id,
            run_id=str(run_id),
            target_stage=str(body.target_stage),
            error=str(e),
        )
        raise HTTPException(status_code=400, detail=str(e)) from e
    except ValueError as e:
        logger.warning(
            "hitl_stage_transition_run_not_found",
            trace_id=trace_id,
            run_id=str(run_id),
            error=str(e),
        )
        raise HTTPException(status_code=404, detail=str(e)) from e
    await db.commit()
    logger.info(
        "hitl_stage_advanced",
        trace_id=trace_id,
        run_id=str(run.id),
        new_stage=run.stage,
        new_status=run.status,
    )
    return ApiResponse.success(
        RunSummaryResponse.model_validate(run),
        trace_id=getattr(request.state, "trace_id", None),
    )


@router.get("/{run_id}/reviewers")
async def list_run_reviewers(
    run_id: UUID,
    request: Request,
    db: DbSession,
    current_user_sub: UUID = Depends(get_current_user_sub),  # noqa: ARG001
) -> ApiResponse[RunReviewersResponse]:
    """Display profiles for everyone who participated in the run.

    Sources of "participation":
      · ProposalRecord with `source='human'` (the proposer's user id)
      · ReviewerDecision (the reviewer's user id)
      · ConsensusDecision (the arbitrator's user id)

    Returns the union as a list of {id, full_name, avatar_url}. The
    consensus panel and divergence indicators consume this to render
    real names / avatars instead of bare UUIDs.
    """
    run = await db.get(ExtractionRun, run_id)
    if run is None:
        raise HTTPException(status_code=404, detail=f"Run {run_id} not found")

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
        return ApiResponse.success(
            RunReviewersResponse(reviewers=[]),
            trace_id=_trace(request),
        )

    profiles = (
        (await db.execute(select(Profile).where(Profile.id.in_(list(user_ids))))).scalars().all()
    )

    return ApiResponse.success(
        RunReviewersResponse(
            reviewers=[
                RunReviewerProfile(
                    id=p.id,
                    full_name=p.full_name,
                    avatar_url=p.avatar_url,
                )
                for p in profiles
            ]
        ),
        trace_id=_trace(request),
    )


@router.post("/{run_id}/reopen", status_code=status.HTTP_201_CREATED)
async def reopen_run(
    run_id: UUID,
    request: Request,
    db: DbSession,
    current_user_sub: UUID = Depends(get_current_user_sub),
) -> ApiResponse[RunSummaryResponse]:
    """Create a new Run derived from a finalized one.

    Implements the "Option C" reopen flow: previous PublishedState rows
    are seeded into the new Run as ``source='system'`` proposals; the
    new Run lands in stage=REVIEW so the form picks up where the old
    one left off. Old Run is untouched (audit trail).
    """
    service = RunLifecycleService(db)
    trace_id = _trace(request)
    try:
        new_run = await service.reopen_run(run_id=run_id, user_id=current_user_sub)
    except CannotReopenRunError as e:
        logger.warning(
            "hitl_reopen_rejected",
            trace_id=trace_id,
            run_id=str(run_id),
            error=str(e),
        )
        raise HTTPException(status_code=400, detail=str(e)) from e
    except ValueError as e:
        logger.warning(
            "hitl_reopen_run_not_found",
            trace_id=trace_id,
            run_id=str(run_id),
            error=str(e),
        )
        raise HTTPException(status_code=404, detail=str(e)) from e
    await db.commit()
    logger.info(
        "hitl_run_reopened",
        trace_id=trace_id,
        old_run_id=str(run_id),
        new_run_id=str(new_run.id),
        new_stage=new_run.stage,
    )
    return ApiResponse.success(
        RunSummaryResponse.model_validate(new_run),
        trace_id=trace_id,
    )
