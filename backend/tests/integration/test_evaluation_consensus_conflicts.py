"""Integration tests for optimistic concurrency conflict responses."""

from unittest.mock import AsyncMock, patch
from uuid import uuid4

import pytest
from fastapi import HTTPException, status
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_consensus_conflict_returns_409(client: AsyncClient) -> None:
    with patch("app.api.v1.endpoints.evaluation_consensus.EvaluationConsensusService") as mock_service_cls:
        mock_service = mock_service_cls.return_value
        mock_service.publish = AsyncMock(
            side_effect=HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Consensus publication conflict",
            )
        )
        response = await client.post(
            "/api/v1/consensus-decisions",
            json={
                "project_id": str(uuid4()),
                "target_id": str(uuid4()),
                "item_id": str(uuid4()),
                "schema_version_id": str(uuid4()),
                "mode": "select_existing",
                "selected_reviewer_decision_id": str(uuid4()),
            },
        )

    assert response.status_code == 409
