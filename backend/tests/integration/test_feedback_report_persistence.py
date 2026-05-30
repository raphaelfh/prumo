"""Integration test: the slimmed feedback_reports table persists an
outbox row with the expected server-side defaults. Uses user_id=None to
avoid the auth.users FK (the column is nullable by design)."""

import pytest
from sqlalchemy import select

from app.models.feedback import FeedbackAttachment, FeedbackReport

pytestmark = pytest.mark.integration


async def test_persist_report_with_defaults(db_session) -> None:
    report = FeedbackReport(
        user_id=None,
        type="bug",
        severity="high",
        description="The PDF viewer renders blank on the extraction screen.",
        url="https://app.example/projects/p/extraction",
        route="/projects/:id/extraction",
    )
    db_session.add(report)
    await db_session.flush()

    attachment = FeedbackAttachment(
        feedback_report_id=report.id,
        kind="image",
        storage_key=f"{report.id}/shot.webp",
        content_type="image/webp",
        size_bytes=2048,
    )
    db_session.add(attachment)
    await db_session.flush()

    fetched = (
        await db_session.execute(
            select(FeedbackReport).where(FeedbackReport.id == report.id)
        )
    ).scalar_one()
    assert fetched.forward_status == "pending"
    assert len(fetched.attachments) == 1
    assert fetched.attachments[0].forward_status == "pending"
