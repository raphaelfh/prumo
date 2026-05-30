"""Persist a feedback report (outbox) and enqueue Linear forwarding."""

from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps.security import ensure_project_member
from app.core.logging import get_logger
from app.models.feedback import FeedbackAttachment, FeedbackReport
from app.schemas.feedback import FeedbackCreate
from app.worker.tasks.feedback_tasks import forward_feedback_to_linear_task

logger = get_logger(__name__)


class FeedbackService:
    def __init__(self, db: AsyncSession, user_id: str | UUID):
        self.db = db
        self._user_uuid: UUID | None = None
        if isinstance(user_id, UUID):
            self._user_uuid = user_id
        else:
            try:
                self._user_uuid = UUID(str(user_id))
            except ValueError:
                self._user_uuid = None  # test tokens like "test-user-id"

    async def create_report(self, payload: FeedbackCreate) -> FeedbackReport:
        ctx = payload.context

        project_id = ctx.project_id
        if project_id is not None and self._user_uuid is not None:
            # Only store a project reference the caller is actually a member of.
            await ensure_project_member(self.db, project_id, self._user_uuid)

        report = FeedbackReport(
            user_id=self._user_uuid,
            type=payload.type,
            severity=payload.severity,
            summary=payload.summary,
            description=payload.description.strip(),
            url=ctx.url,
            route=ctx.route,
            user_agent=ctx.user_agent,
            viewport_size=ctx.viewport_size,
            project_id=project_id,
            article_id=ctx.article_id,
            app_version=ctx.app_version,
            forward_status="pending",
        )
        for att in payload.attachments:
            report.attachments.append(
                FeedbackAttachment(
                    kind=att.kind,
                    storage_key=att.storage_key,
                    content_type=att.content_type,
                    size_bytes=att.size_bytes,
                    forward_status="pending",
                )
            )

        self.db.add(report)
        await self.db.flush()  # populate report.id

        forward_feedback_to_linear_task.delay(str(report.id))
        logger.info(
            "feedback_report_created",
            report_id=str(report.id),
            type=report.type,
            attachments=len(report.attachments),
        )
        return report
