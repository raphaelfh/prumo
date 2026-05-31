"""Integration test for FeedbackService.create_report.

Uses the real db_session; user_id is left null (the test token sub isn't
a real UUID) to avoid the auth.users FK — membership/identity wiring is
covered at the endpoint layer."""

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
        "attachments": [
            {
                "kind": "image",
                "storage_key": "u/x.webp",
                "content_type": "image/webp",
                "size_bytes": 10,
            }
        ],
    }
    base.update(kw)
    return FeedbackCreate(**base)


async def test_create_report_persists(db_session) -> None:
    service = FeedbackService(db=db_session, user_id="not-a-uuid")
    report = await service.create_report(_payload())
    await db_session.flush()

    fetched = (
        await db_session.execute(select(FeedbackReport).where(FeedbackReport.id == report.id))
    ).scalar_one()
    assert fetched.type == "bug"
    assert fetched.route == "/projects/p/extraction"
    assert fetched.forward_status == "pending"
    assert len(fetched.attachments) == 1


async def test_create_report_persists_without_attachments(db_session) -> None:
    """Regression: a report with no attachments must not trigger a post-flush
    lazy-load of the ``attachments`` relationship (raises MissingGreenlet under
    the async session). Reproduces the prod 500 caught by the post-deploy smoke
    test — the common case (text-only feedback) had no test coverage because
    ``_payload`` always carried one attachment.
    """
    service = FeedbackService(db=db_session, user_id="not-a-uuid")
    report = await service.create_report(_payload(attachments=[]))
    await db_session.flush()

    fetched = (
        await db_session.execute(select(FeedbackReport).where(FeedbackReport.id == report.id))
    ).scalar_one()
    assert fetched.type == "bug"
    assert fetched.forward_status == "pending"
    assert len(fetched.attachments) == 0


async def test_rejects_foreign_storage_key(db_session) -> None:
    uid = "11111111-1111-1111-1111-111111111111"
    service = FeedbackService(db=db_session, user_id=uid)
    payload = _payload(
        attachments=[
            {
                "kind": "image",
                "storage_key": "22222222-2222-2222-2222-222222222222/x.webp",
                "content_type": "image/webp",
                "size_bytes": 10,
            },
        ]
    )
    with pytest.raises(ValueError):
        await service.create_report(payload)


async def test_rejects_oversized_attachment(db_session) -> None:
    uid = "11111111-1111-1111-1111-111111111111"
    service = FeedbackService(db=db_session, user_id=uid)
    payload = _payload(
        attachments=[
            {
                "kind": "video",
                "storage_key": f"{uid}/big.webm",
                "content_type": "video/webm",
                "size_bytes": 99_999_999,
            },
        ]
    )
    with pytest.raises(ValueError):
        await service.create_report(payload)
