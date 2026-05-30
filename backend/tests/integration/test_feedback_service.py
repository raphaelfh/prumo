"""Integration test for FeedbackService.create_report.

Uses the real db_session; the Celery enqueue is patched so no broker is
needed. user_id is left null (the test token sub isn't a real UUID) to
avoid the auth.users FK — membership/identity wiring is covered at the
endpoint layer."""

from unittest.mock import patch

import pytest
from sqlalchemy import select

from app.models.feedback import FeedbackReport
from app.schemas.feedback import FeedbackCreate
from app.services.feedback_service import FeedbackService

pytestmark = pytest.mark.integration


def _payload(**kw):
    base = {
        "type": "bug",
        "severity": "high",
        "description": "The PDF viewer renders blank on the extraction screen.",
        "context": {"url": "https://app/x", "route": "/projects/p/extraction"},
        "attachments": [{"kind": "image", "storage_key": "u/x.webp", "content_type": "image/webp", "size_bytes": 10}],
    }
    base.update(kw)
    return FeedbackCreate(**base)


async def test_create_report_persists_and_enqueues(db_session) -> None:
    service = FeedbackService(db=db_session, user_id="not-a-uuid")
    with patch(
        "app.services.feedback_service.forward_feedback_to_linear_task.delay"
    ) as delay:
        report = await service.create_report(_payload())
        await db_session.flush()

    fetched = (
        await db_session.execute(
            select(FeedbackReport).where(FeedbackReport.id == report.id)
        )
    ).scalar_one()
    assert fetched.type == "bug"
    assert fetched.route == "/projects/p/extraction"
    assert fetched.forward_status == "pending"
    assert len(fetched.attachments) == 1
    delay.assert_called_once_with(str(report.id))
