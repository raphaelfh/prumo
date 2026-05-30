"""User feedback intake — persists an outbox row and forwards to Linear."""

from fastapi import APIRouter, HTTPException, Request, status

from app.api.deps.security import ensure_project_member
from app.core.deps import CurrentUser, DbSession
from app.core.logging import get_logger
from app.schemas.common import ApiResponse
from app.schemas.feedback import FeedbackCreate, FeedbackCreated
from app.services.feedback_service import FeedbackService
from app.utils.rate_limiter import limiter
from app.worker.tasks.feedback_tasks import forward_feedback_to_linear_task

router = APIRouter()
logger = get_logger(__name__)


@router.post(
    "",
    response_model=ApiResponse,
    status_code=status.HTTP_202_ACCEPTED,
    summary="Submit user feedback",
    description="Persists a feedback report and forwards it to Linear asynchronously.",
)
@limiter.limit("10/minute")
async def submit_feedback(
    request: Request,  # noqa: ARG001 — slowapi requirement
    db: DbSession,
    user: CurrentUser,
    payload: FeedbackCreate,
) -> ApiResponse[FeedbackCreated]:
    # Authorization belongs in the API layer: only let a caller attach a
    # project reference they are actually a member of.
    project_id = payload.context.project_id
    if project_id is not None:
        await ensure_project_member(db, project_id, user.sub)

    service = FeedbackService(db=db, user_id=user.sub)
    try:
        report = await service.create_report(payload)
        await db.commit()
    except HTTPException:
        raise
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    # Enqueue AFTER commit so the worker is guaranteed to see the row.
    forward_feedback_to_linear_task.delay(str(report.id))
    logger.info("feedback_submitted", report_id=str(report.id), user_id=user.sub)
    return ApiResponse(ok=True, data=FeedbackCreated(report_id=report.id))
