"""Endpoint contract test. The service is patched so this asserts HTTP
shape + status + validation without a DB."""

from types import SimpleNamespace
from unittest.mock import AsyncMock, patch
from uuid import UUID

import pytest


def _body(**kw):
    base = {
        "type": "bug",
        "severity": "high",
        "description": "The PDF viewer renders blank on the extraction screen.",
        "context": {"url": "https://app/x", "route": "/projects/p/extraction"},
        "attachments": [],
    }
    base.update(kw)
    return base


@pytest.mark.asyncio
async def test_post_feedback_returns_202_and_report_id(client) -> None:
    fake_report = SimpleNamespace(id=UUID("11111111-1111-1111-1111-111111111111"))
    with (
        patch(
            "app.api.v1.endpoints.feedback.FeedbackService.create_report",
            new=AsyncMock(return_value=fake_report),
        ),
        patch("app.api.v1.endpoints.feedback.forward_feedback_to_linear_task.delay") as delay,
    ):
        res = await client.post("/api/v1/feedback", json=_body())
    assert res.status_code == 202, res.text
    body = res.json()
    assert body["ok"] is True
    assert body["data"]["report_id"] == "11111111-1111-1111-1111-111111111111"
    delay.assert_called_once_with("11111111-1111-1111-1111-111111111111")


@pytest.mark.asyncio
async def test_post_feedback_validation_error_422(client) -> None:
    res = await client.post("/api/v1/feedback", json=_body(description="short"))
    assert res.status_code == 422
