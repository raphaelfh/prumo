"""Integration tests for evaluation run endpoints."""

from unittest.mock import AsyncMock, patch
from uuid import uuid4

import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_create_evaluation_run_returns_201(client: AsyncClient) -> None:
    with patch("app.api.v1.endpoints.evaluation_runs.EvaluationRunService") as mock_service_cls:
        mock_service = mock_service_cls.return_value
        run_id = uuid4()
        mock_service.create_run = AsyncMock(
            return_value=type(
                "RunObj",
                (),
                {
                    "id": run_id,
                    "project_id": uuid4(),
                    "schema_version_id": uuid4(),
                    "status": "pending",
                    "current_stage": "proposal",
                },
            )()
        )

        response = await client.post(
            "/api/v1/evaluation-runs",
            json={
                "project_id": str(uuid4()),
                "schema_version_id": str(uuid4()),
                "target_ids": [str(uuid4())],
            },
        )

    assert response.status_code == 201
    payload = response.json()
    assert payload["ok"] is True
    assert payload["data"]["id"] == str(run_id)


@pytest.mark.asyncio
async def test_get_evaluation_run_returns_200(client: AsyncClient) -> None:
    with patch("app.api.v1.endpoints.evaluation_runs.EvaluationRunService") as mock_service_cls:
        mock_service = mock_service_cls.return_value
        run_id = uuid4()
        mock_service.get_run_or_404 = AsyncMock(
            return_value=type(
                "RunObj",
                (),
                {
                    "id": run_id,
                    "project_id": uuid4(),
                    "schema_version_id": uuid4(),
                    "status": "active",
                    "current_stage": "proposal",
                },
            )()
        )

        response = await client.get(f"/api/v1/evaluation-runs/{run_id}")

    assert response.status_code == 200
    assert response.json()["ok"] is True
