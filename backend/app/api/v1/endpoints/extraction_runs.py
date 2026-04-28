"""Endpoints for the unified extraction HITL flow at /v1/runs/..."""

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import select

from app.api.deps.security import get_current_user_sub
from app.core.deps import DbSession
from app.models.extraction import ExtractionRun
from app.models.extraction_workflow import ExtractionPublishedState
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
    InvalidStageTransitionError,
    RunLifecycleService,
    TemplateNotFoundError,
    TemplateVersionNotFoundError,
)

router = APIRouter()


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_run(
    body: CreateRunRequest,
    request: Request,
    db: DbSession,
    current_user_sub: UUID = Depends(get_current_user_sub),
) -> ApiResponse[RunSummaryResponse]:
    service = RunLifecycleService(db)
    try:
        run = await service.create_run(
            project_id=body.project_id,
            article_id=body.article_id,
            project_template_id=body.project_template_id,
            user_id=current_user_sub,
            parameters=body.parameters,
        )
    except (TemplateNotFoundError, TemplateVersionNotFoundError) as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    await db.commit()
    return ApiResponse.success(
        RunSummaryResponse.model_validate(run),
        trace_id=getattr(request.state, "trace_id", None),
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
    current_user_sub: UUID = Depends(get_current_user_sub),  # noqa: ARG001
) -> ApiResponse[ProposalRecordResponse]:
    service = ExtractionProposalService(db)
    try:
        record = await service.record_proposal(
            run_id=run_id,
            instance_id=body.instance_id,
            field_id=body.field_id,
            source=body.source,
            proposed_value=body.proposed_value,
            source_user_id=body.source_user_id,
            confidence_score=body.confidence_score,
            rationale=body.rationale,
        )
    except CoordinateMismatchError as e:
        raise HTTPException(status_code=422, detail=str(e)) from e
    except InvalidProposalError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    await db.commit()
    return ApiResponse.success(
        ProposalRecordResponse.model_validate(record),
        trace_id=getattr(request.state, "trace_id", None),
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
        raise HTTPException(status_code=422, detail=str(e)) from e
    except InvalidDecisionError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    await db.commit()
    return ApiResponse.success(
        ReviewerDecisionResponse.model_validate(record),
        trace_id=getattr(request.state, "trace_id", None),
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
        raise HTTPException(status_code=422, detail=str(e)) from e
    except InvalidConsensusError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except OptimisticConcurrencyError as e:
        raise HTTPException(status_code=409, detail=str(e)) from e
    await db.commit()
    return ApiResponse.success(
        ConsensusResultResponse(
            consensus=ConsensusDecisionResponse.model_validate(consensus),
            published=PublishedStateResponse.model_validate(published),
        ),
        trace_id=getattr(request.state, "trace_id", None),
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
    try:
        run = await service.advance_stage(
            run_id=run_id,
            target_stage=body.target_stage,
            user_id=current_user_sub,
        )
    except InvalidStageTransitionError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    await db.commit()
    return ApiResponse.success(
        RunSummaryResponse.model_validate(run),
        trace_id=getattr(request.state, "trace_id", None),
    )
