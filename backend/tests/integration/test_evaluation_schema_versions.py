"""Integration tests for schema version create/publish flow."""

from unittest.mock import AsyncMock, patch
from uuid import uuid4

import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_create_schema_version_returns_201(client: AsyncClient) -> None:
    with patch(
        "app.api.v1.endpoints.evaluation_schema_versions.EvaluationSchemaVersionService"
    ) as mock_service_cls:
        mock_service = mock_service_cls.return_value
        schema_id = uuid4()
        version_id = uuid4()
        mock_service.create_draft = AsyncMock(
            return_value=type(
                "SchemaVersion",
                (),
                {
                    "id": version_id,
                    "schema_id": schema_id,
                    "version_number": 1,
                    "status": "draft",
                    "published_at": None,
                    "published_by": None,
                },
            )()
        )
        response = await client.post(
            "/api/v1/evaluation-schema-versions",
            json={"schema_id": str(schema_id)},
        )

    assert response.status_code == 201
    payload = response.json()
    assert payload["ok"] is True
    assert payload["data"]["status"] == "draft"


@pytest.mark.asyncio
async def test_publish_schema_version_returns_200(client: AsyncClient) -> None:
    with patch(
        "app.api.v1.endpoints.evaluation_schema_versions.EvaluationSchemaVersionService"
    ) as mock_service_cls:
        mock_service = mock_service_cls.return_value
        version_id = uuid4()
        mock_service.publish = AsyncMock(
            return_value=type(
                "SchemaVersion",
                (),
                {
                    "id": version_id,
                    "schema_id": uuid4(),
                    "version_number": 1,
                    "status": "published",
                    "published_at": None,
                    "published_by": uuid4(),
                },
            )()
        )
        response = await client.post(f"/api/v1/evaluation-schema-versions/{version_id}/publish")

    assert response.status_code == 200
    payload = response.json()
    assert payload["ok"] is True
    assert payload["data"]["status"] == "published"
