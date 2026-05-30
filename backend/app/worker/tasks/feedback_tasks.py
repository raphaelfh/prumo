"""Forward a feedback report to Linear (idempotent, retrying)."""

from datetime import UTC, datetime
from typing import Any
from uuid import UUID

from celery import Task
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.logging import get_logger
from app.models.feedback import FeedbackReport
from app.services.linear.feedback_mapping import (
    attachments_markdown,
    issue_body,
    issue_title,
    label_names_for,
    priority_for,
)
from app.services.linear.linear_client import LinearClient
from app.worker._runner import run_task
from app.worker._session import worker_session
from app.worker.celery_app import celery_app

logger = get_logger(__name__)


def _build_storage() -> Any:
    """Build a service-role storage adapter (split out for test patching)."""
    from app.core.deps import get_supabase_client
    from app.core.factories import create_storage_adapter

    return create_storage_adapter(get_supabase_client())


def _filename_for(att: Any) -> str:
    return att.storage_key.rsplit("/", 1)[-1]


async def _forward(session: AsyncSession, report_id: str) -> None:
    report = (
        await session.execute(
            select(FeedbackReport).where(FeedbackReport.id == UUID(report_id))
        )
    ).scalar_one_or_none()
    if report is None:
        logger.warning("feedback_forward_report_missing", report_id=report_id)
        return
    if report.forward_status == "sent":
        return

    if not settings.LINEAR_API_KEY or not settings.LINEAR_TEAM_ID:
        logger.warning(
            "feedback_forward_skipped_unconfigured",
            report_id=report_id,
            detail="LINEAR_API_KEY / LINEAR_TEAM_ID not set; leaving report pending.",
        )
        return

    client = LinearClient(api_key=settings.LINEAR_API_KEY, team_id=settings.LINEAR_TEAM_ID)

    # 1. Create the issue (idempotent: only if not already created).
    if not report.linear_issue_id:
        label_ids = await client.resolve_labels(label_names_for(report))
        issue = await client.create_issue(
            title=issue_title(report),
            description=issue_body(report),
            priority=priority_for(report.severity),
            label_ids=label_ids,
        )
        report.linear_issue_id = issue["id"]
        report.linear_identifier = issue["identifier"]
        report.linear_url = issue["url"]
        report.forward_status = "issue_created"
        await session.commit()

    # 2. Upload any not-yet-forwarded attachments.
    if report.attachments:
        storage = _build_storage()
        for att in report.attachments:
            if att.forward_status == "sent":
                continue
            data = await storage.download(settings.FEEDBACK_MEDIA_BUCKET, att.storage_key)
            att.linear_asset_url = await client.upload_file(
                data=data, content_type=att.content_type, filename=_filename_for(att)
            )
            att.forward_status = "sent"
            await session.commit()

        # 3. Re-render the description with the (idempotent) attachment links.
        assets = attachments_markdown(report.attachments)
        if assets:
            await client.update_issue_description(
                report.linear_issue_id, issue_body(report) + assets
            )

    report.forward_status = "sent"
    report.forwarded_at = datetime.now(UTC)
    await session.commit()


@celery_app.task(bind=True, max_retries=5, default_retry_delay=60)
def forward_feedback_to_linear_task(self: Task, report_id: str) -> dict[str, str]:
    """Celery entrypoint: forward one feedback report to Linear."""

    async def run() -> dict[str, str]:
        async with worker_session() as session:
            try:
                await _forward(session, report_id)
                return {"report_id": report_id, "status": "sent"}
            except Exception as exc:
                await session.rollback()
                logger.exception("feedback_forward_failed", report_id=report_id)
                # Best-effort: record the error on the row in a fresh tx.
                # NOTE: `failed` means "last attempt errored" — the task may
                # still retry (a row is re-processed unless already `sent`).
                try:
                    from sqlalchemy import update

                    await session.execute(
                        update(FeedbackReport)
                        .where(FeedbackReport.id == UUID(report_id))
                        .values(forward_status="failed", forward_error=str(exc)[:2000])
                    )
                    await session.commit()
                except Exception:
                    await session.rollback()
                raise

    try:
        return run_task(run)
    except Exception as exc:
        self.retry(exc=exc)
