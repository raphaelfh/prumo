"""Integration tests for evidence upload validation constraints."""

from unittest.mock import AsyncMock, patch
from uuid import uuid4

import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_evidence_upload_presign_returns_200(client: AsyncClient) -> None:
    with patch("app.api.v1.endpoints.evaluation_consensus.EvaluationEvidenceService") as mock_service_cls:
        mock_service = mock_service_cls.return_value
        mock_service.create_upload_url = AsyncMock(
            return_value=type(
                "EvidenceResp",
                (),
                {"model_dump": lambda self, mode="json": {"upload_url": "https://u", "storage_path": "p", "expires_at": "2026-01-01T00:00:00Z"}},  # type: ignore[no-any-return]
            )()
        )
        response = await client.post(
            "/api/v1/evidence-attachments/presign",
            json={
                "project_id": str(uuid4()),
                "entity_type": "consensus_decision",
                "entity_id": str(uuid4()),
                "filename": "evidence.pdf",
                "mime_type": "application/pdf",
                "size_bytes": 1000,
            },
        )

    assert response.status_code == 200
    assert response.json()["ok"] is True
