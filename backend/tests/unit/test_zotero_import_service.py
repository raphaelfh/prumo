from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.zotero_import_service import ZoteroImportService


@pytest.fixture
def service() -> ZoteroImportService:
    db = AsyncMock(spec=AsyncSession)
    storage = MagicMock()
    svc = ZoteroImportService(
        db=db,
        user_id=str(uuid4()),
        storage=storage,
        trace_id="trace-test",
    )
    return svc


@pytest.mark.asyncio
async def test_import_collection_counts_created_items(service: ZoteroImportService) -> None:
    run = MagicMock()
    run.id = uuid4()
    run.status = "pending"
    service._ensure_run = AsyncMock(return_value=run)  # type: ignore[method-assign]
    service._sync_runs.update_counts = AsyncMock()  # type: ignore[attr-defined]
    service._mark_removed_items = AsyncMock(return_value=0)  # type: ignore[method-assign]
    service._zotero.fetch_items = AsyncMock(
        return_value={"items": [{"key": "A", "data": {"title": "A"}}]}
    )  # type: ignore[attr-defined]
    service._process_item = AsyncMock(  # type: ignore[method-assign]
        return_value=MagicMock(success=True, error=None, zotero_key="A")
    )

    result = await service.import_collection(
        project_id=uuid4(),
        collection_key="COLL",
        max_items=10,
        import_pdfs=False,
    )
    assert result.total_items == 1
    assert result.imported == 1
    assert result.failed == 0


@pytest.mark.asyncio
async def test_import_collection_skips_removal_on_truncated_fetch(
    service: ZoteroImportService,
) -> None:
    """A truncated (paged) fetch must NOT drive the removal reconciliation.

    Zotero pages at 100 items regardless of ``max_items``; the returned page is
    not the full collection, so ``_mark_removed_items`` would falsely tombstone
    every previously-imported article that fell off the page window. Guard: skip
    reconciliation whenever ``fetch_items`` reports ``has_more``.
    """
    run = MagicMock()
    run.id = uuid4()
    run.status = "pending"
    service._ensure_run = AsyncMock(return_value=run)  # type: ignore[method-assign]
    service._sync_runs.update_counts = AsyncMock()  # type: ignore[attr-defined]
    service._mark_removed_items = AsyncMock(return_value=0)  # type: ignore[method-assign]
    service._process_item = AsyncMock(  # type: ignore[method-assign]
        return_value=MagicMock(success=True, error=None, zotero_key="A")
    )

    # Truncated page (has_more=True): reconciliation must be skipped.
    service._zotero.fetch_items = AsyncMock(  # type: ignore[attr-defined]
        return_value={"items": [{"key": "A", "data": {"title": "A"}}], "has_more": True}
    )
    await service.import_collection(
        project_id=uuid4(),
        collection_key="COLL",
        max_items=1,
        import_pdfs=False,
    )
    service._mark_removed_items.assert_not_called()

    # Complete page (no has_more): reconciliation still runs.
    service._zotero.fetch_items = AsyncMock(  # type: ignore[attr-defined]
        return_value={"items": [{"key": "A", "data": {"title": "A"}}], "has_more": False}
    )
    await service.import_collection(
        project_id=uuid4(),
        collection_key="COLL",
        max_items=10,
        import_pdfs=False,
    )
    service._mark_removed_items.assert_called_once()


@pytest.mark.asyncio
async def test_retry_failed_items_requires_failed_events(service: ZoteroImportService) -> None:
    source_run = MagicMock()
    source_run.source_collection_key = "COLL"
    source_run.id = uuid4()
    service._sync_runs.get_owned_run = AsyncMock(return_value=source_run)  # type: ignore[attr-defined]
    service._sync_events.list_failed_by_run = AsyncMock(return_value=[])  # type: ignore[attr-defined]

    with pytest.raises(ValueError, match="no failed items"):
        await service.retry_failed_items(
            project_id=uuid4(),
            source_run_id=uuid4(),
            limit=10,
        )
