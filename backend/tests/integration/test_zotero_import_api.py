from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_sync_collection_rejects_non_member(client: AsyncClient) -> None:
    with patch("app.api.v1.endpoints.zotero_import.UnitOfWork") as uow_cls:
        uow = AsyncMock()
        uow.project_members.is_member = AsyncMock(return_value=False)
        uow_cls.return_value.__aenter__.return_value = uow

        response = await client.post(
            "/api/v1/zotero/sync-collection",
            json={"projectId": str(uuid4()), "collectionKey": "ABC"},
        )
    assert response.status_code == 403


@pytest.mark.asyncio
async def test_sync_status_returns_404_for_unknown_run(client: AsyncClient) -> None:
    with patch("app.api.v1.endpoints.zotero_import.ZoteroImportService") as service_cls:
        service = MagicMock()
        service.get_sync_status = AsyncMock(return_value=None)
        service_cls.return_value = service

        response = await client.post(
            "/api/v1/zotero/sync-status",
            json={"syncRunId": str(uuid4())},
        )
    assert response.status_code == 404


@pytest.mark.asyncio
async def test_sync_item_result_returns_items(client: AsyncClient) -> None:
    run = MagicMock()
    run.id = uuid4()
    run.status = "completed"
    run.total_received = 1
    run.persisted = 1
    run.updated = 0
    run.skipped = 0
    run.failed = 0
    run.removed_at_source = 0
    run.reactivated = 0
    run.started_at = None
    run.completed_at = None

    event = MagicMock()
    event.zotero_item_key = "A"
    event.article_id = uuid4()
    event.status = "success"
    event.error_code = None
    event.error_message = None
    event.authority_rule_applied = "source_parity_wins"
    event.processed_at = "2026-03-28T00:00:00Z"

    with patch("app.api.v1.endpoints.zotero_import.ZoteroImportService") as service_cls:
        service = MagicMock()
        service.get_sync_status = AsyncMock(return_value=run)
        service.get_sync_item_results = AsyncMock(return_value=([event], 1))
        service_cls.return_value = service

        response = await client.post(
            "/api/v1/zotero/sync-item-result",
            json={"syncRunId": str(uuid4()), "offset": 0, "limit": 10},
        )
    assert response.status_code == 200
    data = response.json()
    assert data["ok"] is True
    assert data["data"]["total"] == 1
