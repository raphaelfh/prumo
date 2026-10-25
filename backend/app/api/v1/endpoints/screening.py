"""Title/abstract screening: project config, enrollment, the blind queue, decisions, arbitration."""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, status

from app.api.deps.scope import load_assignment_for_member
from app.api.deps.security import (
    ensure_project_arbitrator,
    ensure_project_reviewer,
    get_current_user_sub,
    require_project_manager,
    require_project_scope,
)
from app.core.deps import DbSession
from app.schemas.common import ApiResponse
from app.schemas.screening import (
    ScreeningArbitrationCreate,
    ScreeningAssignmentRead,
    ScreeningConfigRead,
    ScreeningConfigUpdate,
    ScreeningConflictsRead,
    ScreeningDecisionCreate,
    ScreeningEnrollRequest,
    ScreeningEnrollResult,
    ScreeningQueueRead,
)
from app.services.article_read_service import ArticleNotFoundError
from app.services.screening_config_service import ProjectNotFoundError, ScreeningConfigService
from app.services.screening_review_service import (
    AssignmentNotFoundError,
    DecisionNotFoundError,
    ScreeningReviewService,
)
from app.utils.rate_limiter import limiter

router = APIRouter()

_ASSIGNMENT_NOT_FOUND = "Screening assignment not found"


@router.get("/projects/{project_id}/screening/config")
@limiter.limit("60/minute")
async def get_screening_config(
    request: Request,
    project_id: UUID,
    db: DbSession,
    user_sub: UUID = Depends(require_project_scope),
) -> ApiResponse[ScreeningConfigRead]:
    config = await ScreeningConfigService(db).read(project_id, user_sub)
    return ApiResponse.success(config, trace_id=getattr(request.state, "trace_id", None))


@router.put(
    "/projects/{project_id}/screening/config",
    responses={
        404: {"description": "Project not found"},
        409: {"description": "Config frozen by a decision, or fewer reviewers than requested"},
    },
)
@limiter.limit("30/minute")
async def put_screening_config(
    request: Request,
    project_id: UUID,
    body: ScreeningConfigUpdate,
    db: DbSession,
    user_sub: UUID = Depends(require_project_manager),
) -> ApiResponse[ScreeningConfigRead]:
    try:
        config = await ScreeningConfigService(db).set_reviewer_count(
            project_id, user_sub, body.reviewer_count
        )
    except ProjectNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Project not found"
        ) from exc
    await db.commit()
    return ApiResponse.success(config, trace_id=getattr(request.state, "trace_id", None))


@router.post(
    "/projects/{project_id}/screening/enroll",
    responses={404: {"description": "An article is not in this project"}},
)
@limiter.limit("10/minute")
async def enroll_screening(
    request: Request,
    project_id: UUID,
    db: DbSession,
    body: ScreeningEnrollRequest | None = None,
    user_sub: UUID = Depends(require_project_manager),
) -> ApiResponse[ScreeningEnrollResult]:
    try:
        result = await ScreeningConfigService(db).enroll(
            project_id, user_sub, body.article_ids if body else None
        )
    except ArticleNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Article not found"
        ) from exc
    await db.commit()
    return ApiResponse.success(result, trace_id=getattr(request.state, "trace_id", None))


@router.get(
    "/projects/{project_id}/screening/queue",
    responses={
        403: {"description": "Reviewer role required"},
        409: {"description": "Screening is not set up for this project"},
    },
)
@limiter.limit("120/minute")
async def get_screening_queue(
    request: Request,
    project_id: UUID,
    db: DbSession,
    user_sub: UUID = Depends(get_current_user_sub),
) -> ApiResponse[ScreeningQueueRead]:
    await ensure_project_reviewer(db, project_id, user_sub)
    queue = await ScreeningReviewService(db).queue(project_id, user_sub)
    return ApiResponse.success(queue, trace_id=getattr(request.state, "trace_id", None))


@router.get(
    "/screening/assignments/{assignment_id}",
    responses={
        403: {"description": "Not a member of the assignment's project"},
        404: {"description": "Assignment not found, or its article left the project"},
    },
)
@limiter.limit("120/minute")
async def get_screening_assignment(
    request: Request,
    assignment_id: UUID,
    db: DbSession,
    user_sub: UUID = Depends(get_current_user_sub),
) -> ApiResponse[ScreeningAssignmentRead]:
    await load_assignment_for_member(db, assignment_id, user_sub)
    try:
        assignment = await ScreeningReviewService(db).get_assignment(assignment_id, user_sub)
    except AssignmentNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail=_ASSIGNMENT_NOT_FOUND
        ) from exc
    return ApiResponse.success(assignment, trace_id=getattr(request.state, "trace_id", None))


@router.post(
    "/screening/assignments/{assignment_id}/decisions",
    responses={
        403: {"description": "Reviewer role required in the assignment's project"},
        404: {"description": "Assignment not found, or its article left the project"},
        409: {
            "description": (
                "Screening not set up, the caller already decided (a decision is final), "
                "the record has all its reviewers, or the exclusion reason is not in the protocol"
            )
        },
    },
)
@limiter.limit("120/minute")
async def post_screening_decision(
    request: Request,
    assignment_id: UUID,
    body: ScreeningDecisionCreate,
    db: DbSession,
    user_sub: UUID = Depends(get_current_user_sub),
) -> ApiResponse[ScreeningAssignmentRead]:
    ref = await load_assignment_for_member(db, assignment_id, user_sub)
    await ensure_project_reviewer(db, ref.project_id, user_sub)
    try:
        assignment = await ScreeningReviewService(db).decide(assignment_id, user_sub, body)
    except AssignmentNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail=_ASSIGNMENT_NOT_FOUND
        ) from exc
    await db.commit()
    return ApiResponse.success(assignment, trace_id=getattr(request.state, "trace_id", None))


@router.get(
    "/projects/{project_id}/screening/conflicts",
    responses={403: {"description": "Manager or consensus role required"}},
)
@limiter.limit("60/minute")
async def get_screening_conflicts(
    request: Request,
    project_id: UUID,
    db: DbSession,
    user_sub: UUID = Depends(get_current_user_sub),
) -> ApiResponse[ScreeningConflictsRead]:
    await ensure_project_arbitrator(db, project_id, user_sub)
    conflicts = await ScreeningReviewService(db).conflicts(project_id, user_sub)
    return ApiResponse.success(conflicts, trace_id=getattr(request.state, "trace_id", None))


@router.post(
    "/screening/assignments/{assignment_id}/arbitration",
    responses={
        403: {
            "description": (
                "Manager or consensus role required in the assignment's project, "
                "or the caller reviewed this record (no self-arbitration)"
            )
        },
        404: {
            "description": (
                "Assignment not found, its article left the project, "
                "or a decision is not in this assignment"
            )
        },
        409: {
            "description": (
                "Screening not set up, the record is not in conflict, the decisions "
                "changed since it was opened, or the exclusion reason is not in the protocol"
            )
        },
    },
)
@limiter.limit("60/minute")
async def post_screening_arbitration(
    request: Request,
    assignment_id: UUID,
    body: ScreeningArbitrationCreate,
    db: DbSession,
    user_sub: UUID = Depends(get_current_user_sub),
) -> ApiResponse[ScreeningAssignmentRead]:
    ref = await load_assignment_for_member(db, assignment_id, user_sub)
    await ensure_project_arbitrator(db, ref.project_id, user_sub)
    try:
        assignment = await ScreeningReviewService(db).arbitrate(assignment_id, user_sub, body)
    except AssignmentNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail=_ASSIGNMENT_NOT_FOUND
        ) from exc
    except DecisionNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Screening decision not found"
        ) from exc
    await db.commit()
    return ApiResponse.success(assignment, trace_id=getattr(request.state, "trace_id", None))
