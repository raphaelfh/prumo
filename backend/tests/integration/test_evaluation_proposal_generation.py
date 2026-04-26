"""Integration tests for async proposal kickoff endpoint."""

from unittest.mock import AsyncMock, patch
from uuid import uuid4

import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_trigger_proposal_generation_returns_202(client: AsyncClient) -> None:
    run_id = uuid4()
    with patch("app.api.v1.endpoints.evaluation_runs.EvaluationProposalService") as mock_service_cls:
        mock_service = mock_service_cls.return_value
        mock_service.kickoff_for_run = AsyncMock(return_value=True)

        response = await client.post(f"/api/v1/evaluation-runs/{run_id}/proposal-generation")

    assert response.status_code == 202
    payload = response.json()
    assert payload["ok"] is True
    assert payload["data"]["accepted"] is True
