"""Endpoints for the unified extraction HITL flow at /v1/runs/...

Every error path here logs once with a structured event name + run_id +
trace_id context so SRE can grep for the failure mode without parsing
HTTP response bodies. The success paths log at info level for the
state-transition events (run created, stage advanced) since those are
the ones that drive consensus + publish later.
"""

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps.security import (
    ensure_project_arbitrator,
    ensure_project_member,
    ensure_project_reviewer,
    get_current_user_sub,
)
from app.core.deps import DbSession
from app.core.logging import get_logger
from app.schemas.common import ApiResponse
from app.schemas.extraction_run import (
    AdvanceStageRequest,
    ApproveFinalizeResponse,
    ConsensusDecisionResponse,
    ConsensusResultResponse,
    CreateConsensusRequest,
    CreateDecisionRequest,
    CreateProposalRequest,
    CreateRunRequest,
    MarkReadyRequest,
    ProposalRecordResponse,
    PublishedStateResponse,
    ReviewerDecisionResponse,
    RunDetailResponse,
    RunReadyStateResponse,
    RunReviewersResponse,
    RunSummaryResponse,
    RunViewResponse,
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
from app.services.extraction_reviewer_ready_service import (
    ExtractionReviewerReadyService,
)
from app.services.extraction_run_read_service import (
    RunNotFoundError,
    build_run_view,
    caller_can_see_peers,
    get_run_or_raise,
    get_run_with_workflow_history,
    is_run_arbitrator,
    list_run_participants,
)
from app.services.run_lifecycle_service import (
    CannotReopenRunError,
    CreateRunInputError,
    InvalidStageTransitionError,
    RunLifecycleService,
    TemplateNotFoundError,
    TemplateVersionNotFoundError,
)

logger = get_logger(__name__)

router = APIRouter()


def _trace(request: Request) -> str | None:
    return getattr(request.state, "trace_id", None)


async def _load_run_and_check_member(
    db: AsyncSession, run_id: UUID, user_sub: UUID
) -> RunSummaryResponse:
    """Load a Run by id, 404 when missing, 403 when caller is not a member.

    Returns the Run as a RunSummaryResponse schema (not the ORM type) so
    the endpoint module avoids importing from app.models.* — see the
    extraction_run_read_service docstring + the check_layered_arch
    fitness function.
    """
    try:
        run = await get_run_or_raise(db, run_id)
    except RunNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    await ensure_project_member(db, run.project_id, user_sub)
    return run


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_run(
    body: CreateRunRequest,
    request: Request,
    db: DbSession,
    current_user_sub: UUID = Depends(get_current_user_sub),
) -> ApiResponse[RunSummaryResponse]:
    await ensure_project_member(db, body.project_id, current_user_sub)
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
    except CreateRunInputError as e:
        logger.warning(
            "hitl_run_create_bola_rejected",
            trace_id=trace_id,
            project_id=str(body.project_id),
            article_id=str(body.article_id),
            error=str(e),
        )
        raise HTTPException(status_code=400, detail=str(e)) from e
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
    current_user_sub: UUID = Depends(get_current_user_sub),
) -> ApiResponse[RunDetailResponse]:
    run = await _load_run_and_check_member(db, run_id, current_user_sub)
    can_see_peers = await caller_can_see_peers(
        db, project_id=run.project_id, user_id=current_user_sub, kind=run.kind
    )
    is_arbitrator = await is_run_arbitrator(db, run.project_id, current_user_sub)
    detail = await get_run_with_workflow_history(
        db,
        run_id,
        caller_id=current_user_sub,
        can_see_peers=can_see_peers,
        caller_is_arbitrator=is_arbitrator,
    )
    return ApiResponse.success(
        detail,
        trace_id=getattr(request.state, "trace_id", None),
    )


@router.get("/{run_id}/view")
async def get_run_view(
    run_id: UUID,
    request: Request,
    db: DbSession,
    current_user_sub: UUID = Depends(get_current_user_sub),
) -> ApiResponse[RunViewResponse]:
    """One-round-trip run-open view: blind-filtered run detail + the frozen
    entity_types tree + the caller's current_values."""
    run = await _load_run_and_check_member(db, run_id, current_user_sub)
    can_see_peers = await caller_can_see_peers(
        db, project_id=run.project_id, user_id=current_user_sub, kind=run.kind
    )
    is_arbitrator = await is_run_arbitrator(db, run.project_id, current_user_sub)
    view = await build_run_view(
        db,
        run_id,
        caller_id=current_user_sub,
        can_see_peers=can_see_peers,
        caller_is_arbitrator=is_arbitrator,
    )
    return ApiResponse.success(view, trace_id=_trace(request))


@router.post("/{run_id}/proposals", status_code=status.HTTP_201_CREATED)
async def create_proposal(
    run_id: UUID,
    body: CreateProposalRequest,
    request: Request,
    db: DbSession,
    current_user_sub: UUID = Depends(get_current_user_sub),
) -> ApiResponse[ProposalRecordResponse]:
    await _load_run_and_check_member(db, run_id, current_user_sub)
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
    await _load_run_and_check_member(db, run_id, current_user_sub)
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


@router.post("/{run_id}/ready")
async def mark_run_ready(
    run_id: UUID,
    body: MarkReadyRequest,
    request: Request,
    db: DbSession,
    current_user_sub: UUID = Depends(get_current_user_sub),
) -> ApiResponse[RunReadyStateResponse]:
    """Toggle the caller's per-reviewer "ready" signal for a run.

    Advisory only — it never advances the run (the manager opens consensus
    manually). Membership-gated AND reviewer-role-gated (a read-only viewer
    cannot mark ready). Returns the "N/M reviewers ready" hint.
    """
    run = await _load_run_and_check_member(db, run_id, current_user_sub)
    await ensure_project_reviewer(db, run.project_id, current_user_sub)
    service = ExtractionReviewerReadyService(db)
    await service.mark_ready(run_id=run_id, reviewer_id=current_user_sub, is_ready=body.ready)
    summary = await service.ready_summary_from(
        run_id=run_id, hitl_config_snapshot=run.hitl_config_snapshot
    )
    await db.commit()
    return ApiResponse.success(RunReadyStateResponse(**summary), trace_id=_trace(request))


@router.post("/{run_id}/consensus", status_code=status.HTTP_201_CREATED)
async def create_consensus(
    run_id: UUID,
    body: CreateConsensusRequest,
    request: Request,
    db: DbSession,
    current_user_sub: UUID = Depends(get_current_user_sub),
) -> ApiResponse[ConsensusResultResponse]:
    # Publishing a consensus decision (and its canonical PublishedState) is a
    # privileged write. The gate lives at the API layer because the service-role
    # session bypasses RLS (which already excludes viewers via is_project_reviewer);
    # without it any project member — including a read-only viewer — could publish
    # consensus + canonical values.
    #
    # The gate is kind-aware because this endpoint backs two flows:
    #   · extraction → arbitrator-only (manager / consensus), matching ADR-0015 and
    #     approve-finalize: resolving divergence / publishing values is an adjudicator
    #     action, not a reviewer one.
    #   · quality_assessment → reviewer-level: QA "Publish assessment" routes through
    #     here per filled field and is, by design, available to any reviewer
    #     (single-reviewer self-publish; see frontend lib/qa/qaTransition). Gating at
    #     reviewer level keeps that flow working while still excluding viewers.
    run_summary = await _load_run_and_check_member(db, run_id, current_user_sub)
    if run_summary.kind == "extraction":
        await ensure_project_arbitrator(db, run_summary.project_id, current_user_sub)
    else:
        await ensure_project_reviewer(db, run_summary.project_id, current_user_sub)
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
    await _load_run_and_check_member(db, run_id, current_user_sub)
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


@router.post("/{run_id}/approve-finalize")
async def approve_and_finalize_run(
    run_id: UUID,
    request: Request,
    db: DbSession,
    current_user_sub: UUID = Depends(get_current_user_sub),
) -> ApiResponse[ApproveFinalizeResponse]:
    """One-action consensus → finalized for extraction runs.

    Publishes the agreed value for every existing-instance × field coord that is not
    yet published (reusing the per-coord consensus path), then advances to FINALIZED —
    atomically, in one transaction/commit. This makes the finalize gates (EmptyFinalize/
    IncompleteFinalize) satisfiable naturally for a complete run, retiring the
    no-divergence dead-end. Rejects when a field still diverges unresolved.

    Manager / consensus only — this publishes canonical values and finalizes; the
    gate lives at the API layer because the service-role session bypasses RLS.
    """
    run_summary = await _load_run_and_check_member(db, run_id, current_user_sub)
    await ensure_project_arbitrator(db, run_summary.project_id, current_user_sub)
    service = RunLifecycleService(db)
    trace_id = _trace(request)
    try:
        run, published_count = await service.approve_and_finalize(
            run_id=run_id, user_id=current_user_sub
        )
    except CoordinateMismatchError as e:
        raise HTTPException(status_code=422, detail=str(e)) from e
    except InvalidConsensusError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except OptimisticConcurrencyError as e:
        raise HTTPException(status_code=409, detail=str(e)) from e
    except InvalidStageTransitionError as e:
        logger.warning(
            "hitl_approve_finalize_rejected",
            trace_id=trace_id,
            run_id=str(run_id),
            error=str(e),
        )
        raise HTTPException(status_code=400, detail=str(e)) from e
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    await db.commit()
    logger.info(
        "hitl_approve_finalized",
        trace_id=trace_id,
        run_id=str(run.id),
        published_count=published_count,
    )
    return ApiResponse.success(
        ApproveFinalizeResponse(
            run=RunSummaryResponse.model_validate(run),
            published_count=published_count,
        ),
        trace_id=trace_id,
    )


@router.get("/{run_id}/reviewers")
async def list_run_reviewers(
    run_id: UUID,
    request: Request,
    db: DbSession,
    current_user_sub: UUID = Depends(get_current_user_sub),
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
    await _load_run_and_check_member(db, run_id, current_user_sub)
    reviewers = await list_run_participants(db, run_id)
    return ApiResponse.success(
        RunReviewersResponse(reviewers=reviewers),
        trace_id=_trace(request),
    )


@router.post("/{run_id}/reopen", status_code=status.HTTP_201_CREATED)
async def reopen_run(
    run_id: UUID,
    request: Request,
    response: Response,
    db: DbSession,
    current_user_sub: UUID = Depends(get_current_user_sub),
) -> ApiResponse[RunSummaryResponse]:
    """Create a new Run derived from a finalized one.

    Implements the "Option C" reopen flow: previous PublishedState rows
    are seeded into the new Run as ``source='system'`` proposals; the
    new Run lands in stage=EXTRACT so the form picks up where the old
    one left off. Old Run is untouched (audit trail).
    """
    await _load_run_and_check_member(db, run_id, current_user_sub)
    service = RunLifecycleService(db)
    trace_id = _trace(request)
    try:
        new_run, created = await service.reopen_run(run_id=run_id, user_id=current_user_sub)
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
    # 201 when a fresh revision was forked; 200 when an existing live child was
    # resumed idempotently (mirrors POST /hitl/sessions). (#153)
    if not created:
        response.status_code = status.HTTP_200_OK
    logger.info(
        "hitl_run_reopened",
        trace_id=trace_id,
        old_run_id=str(run_id),
        new_run_id=str(new_run.id),
        new_stage=new_run.stage,
        created=created,
    )
    return ApiResponse.success(
        RunSummaryResponse.model_validate(new_run),
        trace_id=trace_id,
    )
