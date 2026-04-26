"""Integration tests for reviewer decision submission endpoint."""

from unittest.mock import AsyncMock, patch
from uuid import uuid4

import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_submit_reviewer_decision_returns_201(client: AsyncClient) -> None:
    with patch("app.api.v1.endpoints.evaluation_review.EvaluationReviewService") as mock_service_cls:
        mock_service = mock_service_cls.return_value
        mock_service.submit_decision = AsyncMock(
            return_value=type(
                "DecisionObj",
                (),
                {
                    "id": uuid4(),
                    "reviewer_id": uuid4(),
                    "decision": "accept",
                },
            )()
        )

        response = await client.post(
            "/api/v1/reviewer-decisions",
            json={
                "project_id": str(uuid4()),
                "run_id": str(uuid4()),
                "target_id": str(uuid4()),
                "item_id": str(uuid4()),
                "schema_version_id": str(uuid4()),
                "decision": "accept",
            },
        )

    assert response.status_code == 201
    payload = response.json()
    assert payload["ok"] is True
    assert payload["data"]["decision"] == "accept"
