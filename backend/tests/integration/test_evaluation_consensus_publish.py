"""Integration tests for consensus publication success paths."""

from unittest.mock import AsyncMock, patch
from uuid import uuid4

import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_consensus_publish_success(client: AsyncClient) -> None:
    with patch("app.api.v1.endpoints.evaluation_consensus.EvaluationConsensusService") as mock_service_cls:
        mock_service = mock_service_cls.return_value
        mock_service.publish = AsyncMock(
            return_value=type(
                "PublishedObj",
                (),
                {
                    "id": uuid4(),
                    "project_id": uuid4(),
                    "target_id": uuid4(),
                    "item_id": uuid4(),
                    "schema_version_id": uuid4(),
                    "latest_consensus_decision_id": uuid4(),
                },
            )()
        )
        response = await client.post(
            "/api/v1/consensus-decisions",
            json={
                "project_id": str(uuid4()),
                "target_id": str(uuid4()),
                "item_id": str(uuid4()),
                "schema_version_id": str(uuid4()),
                "mode": "manual_override",
                "override_value": {"value": "yes"},
                "override_justification": "Reviewer governance override",
            },
        )

    assert response.status_code == 201
    assert response.json()["ok"] is True
