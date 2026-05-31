"""Persist a feedback report (outbox).

Forwarding to Linear is enqueued by the caller (the API layer) AFTER the
row is committed — this keeps the service free of any api/worker-layer
imports and guarantees the worker never races an uncommitted row.
"""

from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.logging import get_logger
from app.models.feedback import FeedbackAttachment, FeedbackReport
from app.schemas.feedback import FeedbackCreate

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
        # Defense-in-depth: a caller may only reference blobs under their
        # own storage prefix (mirrors the feedback-media bucket RLS), and
        # attachments must respect the configured size caps. The endpoint
        # maps the resulting ValueError to a 400.
        uid_prefix = f"{self._user_uuid}/" if self._user_uuid is not None else None
        size_cap = {
            "image": settings.FEEDBACK_MAX_IMAGE_BYTES,
            "video": settings.FEEDBACK_MAX_VIDEO_BYTES,
        }
        for att in payload.attachments:
            if uid_prefix is not None and not att.storage_key.startswith(uid_prefix):
                raise ValueError("attachment storage_key must live under the caller's own prefix")
            cap = size_cap.get(att.kind)
            if att.size_bytes is not None and cap is not None and att.size_bytes > cap:
                raise ValueError(f"attachment exceeds the {att.kind} size limit")
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
            project_id=ctx.project_id,
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
        logger.info(
            "feedback_report_created",
            report_id=str(report.id),
            type=report.type,
            # Count the input payload, not report.attachments: the latter is a
            # lazy relationship and reading it post-flush triggers a sync IO
            # load that raises MissingGreenlet under the async session when the
            # collection wasn't initialized (i.e. no attachments).
            attachments=len(payload.attachments),
        )
        return report
