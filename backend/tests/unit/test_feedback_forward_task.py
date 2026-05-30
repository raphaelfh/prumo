"""Unit test the forwarding coroutine with the Linear client + storage +
session all mocked. Asserts idempotency and status transitions."""

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.worker.tasks.feedback_tasks import _forward


def _report(**kw):
    base = {
        "id": "11111111-1111-1111-1111-111111111111",
        "type": "bug",
        "severity": "high",
        "summary": None,
        "description": "blank pdf",
        "url": "https://app/x",
        "route": "/projects/p/extraction",
        "project_id": None,
        "article_id": None,
        "user_agent": "UA",
        "viewport_size": {"width": 1, "height": 2},
        "app_version": "v1",
        "linear_issue_id": None,
        "linear_identifier": None,
        "linear_url": None,
        "forward_status": "pending",
        "forward_error": None,
        "forwarded_at": None,
        "attachments": [],
    }
    base.update(kw)
    return SimpleNamespace(**base)


def _session_with(report):
    session = AsyncMock()
    result = MagicMock()
    result.scalar_one_or_none.return_value = report
    session.execute = AsyncMock(return_value=result)
    session.commit = AsyncMock()
    return session


@pytest.fixture
def linear():
    client = AsyncMock()
    client.resolve_labels = AsyncMock(return_value=["L1", "L2"])
    client.create_issue = AsyncMock(
        return_value={"id": "i1", "identifier": "PRU-9", "url": "https://linear/PRU-9"}
    )
    client.upload_file = AsyncMock(return_value="https://asset/x.webp")
    client.update_issue_description = AsyncMock()
    return client


async def test_creates_issue_and_marks_sent(linear) -> None:
    att = SimpleNamespace(kind="image", storage_key="u/x.webp", content_type="image/webp",
                          linear_asset_url=None, forward_status="pending")
    report = _report(attachments=[att])
    session = _session_with(report)
    storage = MagicMock()
    storage.download = AsyncMock(return_value=b"bytes")

    with (
        patch("app.worker.tasks.feedback_tasks.LinearClient", return_value=linear),
        patch("app.worker.tasks.feedback_tasks._build_storage", return_value=storage),
        patch("app.worker.tasks.feedback_tasks.settings") as s,
    ):
        s.LINEAR_API_KEY = "k"
        s.LINEAR_TEAM_ID = "t"
        s.FEEDBACK_MEDIA_BUCKET = "feedback-media"
        await _forward(session, "11111111-1111-1111-1111-111111111111")

    linear.create_issue.assert_awaited_once()
    assert report.linear_identifier == "PRU-9"
    linear.upload_file.assert_awaited_once()
    assert att.linear_asset_url == "https://asset/x.webp"
    assert att.forward_status == "sent"
    assert report.forward_status == "sent"
    assert report.forwarded_at is not None


async def test_idempotent_when_issue_already_created(linear) -> None:
    report = _report(linear_issue_id="i1", linear_identifier="PRU-9",
                     forward_status="issue_created", attachments=[])
    session = _session_with(report)
    storage = MagicMock()

    with (
        patch("app.worker.tasks.feedback_tasks.LinearClient", return_value=linear),
        patch("app.worker.tasks.feedback_tasks._build_storage", return_value=storage),
        patch("app.worker.tasks.feedback_tasks.settings") as s,
    ):
        s.LINEAR_API_KEY = "k"
        s.LINEAR_TEAM_ID = "t"
        s.FEEDBACK_MEDIA_BUCKET = "feedback-media"
        await _forward(session, "11111111-1111-1111-1111-111111111111")

    linear.create_issue.assert_not_awaited()  # not recreated
    assert report.forward_status == "sent"


async def test_already_sent_is_noop(linear) -> None:
    report = _report(forward_status="sent")
    session = _session_with(report)
    with (
        patch("app.worker.tasks.feedback_tasks.LinearClient", return_value=linear),
        patch("app.worker.tasks.feedback_tasks._build_storage", return_value=MagicMock()),
        patch("app.worker.tasks.feedback_tasks.settings") as s,
    ):
        s.LINEAR_API_KEY = "k"
        s.LINEAR_TEAM_ID = "t"
        await _forward(session, "11111111-1111-1111-1111-111111111111")
    linear.create_issue.assert_not_awaited()


async def test_unconfigured_linear_is_noop_and_leaves_pending(linear) -> None:
    report = _report(forward_status="pending")
    session = _session_with(report)
    with (
        patch("app.worker.tasks.feedback_tasks.LinearClient", return_value=linear),
        patch("app.worker.tasks.feedback_tasks._build_storage", return_value=MagicMock()),
        patch("app.worker.tasks.feedback_tasks.settings") as s,
    ):
        s.LINEAR_API_KEY = None
        s.LINEAR_TEAM_ID = None
        await _forward(session, "11111111-1111-1111-1111-111111111111")
    linear.create_issue.assert_not_awaited()
    assert report.forward_status == "pending"


async def test_partial_attachment_failure_resumes_on_retry(linear) -> None:
    att1 = SimpleNamespace(kind="image", storage_key="u/1.webp", content_type="image/webp",
                           linear_asset_url=None, forward_status="pending")
    att2 = SimpleNamespace(kind="image", storage_key="u/2.webp", content_type="image/webp",
                           linear_asset_url=None, forward_status="pending")
    report = _report(attachments=[att1, att2])
    session = _session_with(report)
    storage = MagicMock()
    storage.download = AsyncMock(return_value=b"bytes")
    # First pass: att1 uploads ok, att2 raises.
    linear.upload_file = AsyncMock(side_effect=["https://asset/1.webp", RuntimeError("boom")])

    with (
        patch("app.worker.tasks.feedback_tasks.LinearClient", return_value=linear),
        patch("app.worker.tasks.feedback_tasks._build_storage", return_value=storage),
        patch("app.worker.tasks.feedback_tasks.settings") as s,
    ):
        s.LINEAR_API_KEY = "k"
        s.LINEAR_TEAM_ID = "t"
        s.FEEDBACK_MEDIA_BUCKET = "b"
        with pytest.raises(RuntimeError):
            await _forward(session, "11111111-1111-1111-1111-111111111111")

    assert report.linear_issue_id == "i1"
    assert report.forward_status == "issue_created"
    assert att1.forward_status == "sent"
    assert att1.linear_asset_url == "https://asset/1.webp"
    assert att2.forward_status == "pending"
    assert linear.create_issue.await_count == 1

    # Retry: att2 now succeeds; issue not recreated, att1 not re-uploaded.
    linear.upload_file = AsyncMock(return_value="https://asset/2.webp")
    with (
        patch("app.worker.tasks.feedback_tasks.LinearClient", return_value=linear),
        patch("app.worker.tasks.feedback_tasks._build_storage", return_value=storage),
        patch("app.worker.tasks.feedback_tasks.settings") as s,
    ):
        s.LINEAR_API_KEY = "k"
        s.LINEAR_TEAM_ID = "t"
        s.FEEDBACK_MEDIA_BUCKET = "b"
        await _forward(session, "11111111-1111-1111-1111-111111111111")

    assert linear.create_issue.await_count == 1  # not recreated
    assert att2.forward_status == "sent"
    assert att2.linear_asset_url == "https://asset/2.webp"
    assert report.forward_status == "sent"
    assert report.forwarded_at is not None
    linear.upload_file.assert_awaited_once()  # only att2 on the retry pass
