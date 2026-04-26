"""Integration tests for rate-limit/contract security expectations."""

from unittest.mock import AsyncMock, patch
from uuid import uuid4

import pytest
from httpx import AsyncClient

from tests.integration.helpers.api_contract_assertions import assert_api_response_contract


@pytest.mark.asyncio
async def test_api_response_envelope_and_trace_id_for_evaluation_endpoints(client: AsyncClient) -> None:
    with patch("app.api.v1.endpoints.evaluation_runs.EvaluationRunService") as mock_run_service_cls:
        mock_run_service = mock_run_service_cls.return_value
        mock_run_service.get_run_or_404 = AsyncMock(
            return_value=type(
                "RunObj",
                (),
                {
                    "id": uuid4(),
                    "project_id": uuid4(),
                    "schema_version_id": uuid4(),
                    "status": "active",
                    "current_stage": "proposal",
                },
            )()
        )
        response = await client.get(f"/api/v1/evaluation-runs/{uuid4()}")

    assert response.status_code == 200
    payload = assert_api_response_contract(response.json(), expect_ok=True)
    assert payload.get("trace_id")
