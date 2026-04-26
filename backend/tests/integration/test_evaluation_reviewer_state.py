"""Integration tests for reviewer queue state materialization endpoint."""

from unittest.mock import AsyncMock, patch
from uuid import uuid4

import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_list_review_queue_returns_items(client: AsyncClient) -> None:
    with patch("app.api.v1.endpoints.evaluation_review.EvaluationReviewService") as mock_service_cls:
        mock_service = mock_service_cls.return_value
        mock_service.list_review_queue = AsyncMock(
            return_value=[
                {
                    "run_id": uuid4(),
                    "target_id": uuid4(),
                    "item_id": uuid4(),
                    "latest_proposal_id": uuid4(),
                    "reviewer_state": "pending",
                }
            ]
        )

        response = await client.get("/api/v1/review-queue")

    assert response.status_code == 200
    payload = response.json()
    assert payload["ok"] is True
    assert len(payload["data"]["items"]) == 1
