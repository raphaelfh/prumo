"""User feedback intake — persists an outbox row and forwards to Linear."""

from fastapi import APIRouter, HTTPException, Request, status

from app.core.deps import CurrentUser, DbSession
from app.core.logging import get_logger
from app.schemas.common import ApiResponse
from app.schemas.feedback import FeedbackCreate, FeedbackCreated
from app.services.feedback_service import FeedbackService
from app.utils.rate_limiter import limiter

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
    service = FeedbackService(db=db, user_id=user.sub)
    try:
        report = await service.create_report(payload)
        await db.commit()
    except HTTPException:
        raise
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    logger.info("feedback_submitted", report_id=str(report.id), user_id=user.sub)
    return ApiResponse(ok=True, data=FeedbackCreated(report_id=report.id))
