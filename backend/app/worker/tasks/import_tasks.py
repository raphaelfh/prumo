"""Import Celery tasks.

Celery tasks that import external data (currently Zotero collections
and Zotero library sync) into a project.

The async bridge is via ``app.worker._runner.run_task`` — see that
module's docstring for the event-loop rationale.
"""

from __future__ import annotations

from typing import Any
from uuid import UUID

from app.worker._runner import run_task
from app.worker.celery_app import celery_app


@celery_app.task(
    bind=True,
    max_retries=3,
    default_retry_delay=120,
    rate_limit="2/m",
)
def import_zotero_collection_task(
    self,
    project_id: str,
    collection_key: str,
    user_id: str,
    import_pdfs: bool = True,
    max_items: int = 100,
    update_existing: bool = True,
    sync_run_id: str | None = None,
) -> dict[str, Any]:
    """Import a Zotero collection into the project.

    Args:
        project_id: Project UUID.
        collection_key: Zotero collection key.
        user_id: User UUID owning the import.
        import_pdfs: Whether to also import attached PDFs.
        max_items: Max items to import.
        update_existing: Whether to update items that already exist.
        sync_run_id: Existing sync-run UUID to attach to (optional).

    Returns:
        Dict with the import result summary.
    """

    async def run():
        from app.core.deps import get_supabase_client
        from app.core.factories import create_storage_adapter
        from app.services.zotero_import_service import ZoteroImportService
        from app.worker._session import worker_session

        async with worker_session() as session:
            try:
                supabase = get_supabase_client()
                storage = create_storage_adapter(supabase)
                service = ZoteroImportService(
                    db=session,
                    user_id=user_id,
                    storage=storage,
                    trace_id=self.request.id,
                )

                result = await service.import_collection(
                    project_id=UUID(project_id),
                    collection_key=collection_key,
                    max_items=max_items,
                    import_pdfs=import_pdfs,
                    update_existing=update_existing,
                    sync_run_id=UUID(sync_run_id) if sync_run_id else None,
                )

                await session.commit()

                result_payload = {
                    "sync_run_id": result.sync_run_id,
                    "total_items": result.total_items,
                    "imported": result.imported,
                    "updated": result.updated,
                    "failed": result.failed,
                    "skipped": result.skipped,
                    "removed_at_source": result.removed_at_source,
                    "reactivated": result.reactivated,
                    "results": [
                        {
                            "zotero_key": r.zotero_key,
                            "title": r.title,
                            "success": r.success,
                            "article_id": r.article_id,
                            "has_pdf": r.pdf_imported,
                            "error": r.error,
                        }
                        for r in result.results
                    ],
                }
                return result_payload
            except Exception:
                await session.rollback()
                raise

    try:
        return run_task(run)
    except Exception as exc:
        self.retry(exc=exc)


@celery_app.task(
    bind=True,
    max_retries=3,
    default_retry_delay=120,
    rate_limit="2/m",
)
def retry_failed_zotero_sync_task(
    self,
    project_id: str,
    source_sync_run_id: str,
    user_id: str,
    sync_run_id: str,
    limit: int = 100,
) -> dict[str, Any]:
    async def run():
        from app.core.deps import get_supabase_client
        from app.core.factories import create_storage_adapter
        from app.services.zotero_import_service import ZoteroImportService
        from app.worker._session import worker_session

        async with worker_session() as session:
            try:
                supabase = get_supabase_client()
                storage = create_storage_adapter(supabase)
                service = ZoteroImportService(
                    db=session,
                    user_id=user_id,
                    storage=storage,
                    trace_id=self.request.id,
                )
                _, result = await service.retry_failed_items(
                    project_id=UUID(project_id),
                    source_run_id=UUID(source_sync_run_id),
                    target_run_id=UUID(sync_run_id),
                    limit=limit,
                )
                await session.commit()
                return {
                    "sync_run_id": sync_run_id,
                    "retry_of_sync_run_id": source_sync_run_id,
                    "queued_items": limit,
                    "imported": result.imported,
                    "updated": result.updated,
                    "failed": result.failed,
                    "skipped": result.skipped,
                }
            except Exception:
                await session.rollback()
                raise

    try:
        return run_task(run)
    except Exception as exc:
        self.retry(exc=exc)


@celery_app.task(
    bind=True,
    max_retries=1,
    rate_limit="1/m",
)
def sync_zotero_library_task(
    self,
    user_id: str,
) -> dict[str, Any]:
    """Sync the user's full Zotero library metadata.

    Args:
        user_id: User UUID whose Zotero library should be synced.

    Returns:
        Dict with the sync result summary.
    """

    async def run():
        from app.services.zotero_service import ZoteroService
        from app.worker._session import worker_session

        async with worker_session() as session:
            try:
                zotero = ZoteroService(
                    db=session,
                    user_id=user_id,
                )

                # Test the connection
                connection_result = await zotero.test_connection()

                if not connection_result.get("success"):
                    return {
                        "success": False,
                        "error": connection_result.get("error"),
                    }

                # List collections
                collections_result = await zotero.list_collections()

                return {
                    "success": True,
                    "user_name": connection_result.get("user_name"),
                    "collections_count": len(collections_result.get("collections", [])),
                    "collections": [
                        {
                            "key": c.get("key"),
                            "name": c.get("data", {}).get("name"),
                        }
                        for c in collections_result.get("collections", [])[:20]  # Cap response size
                    ],
                }
            except Exception:
                await session.rollback()
                raise

    try:
        return run_task(run)
    except Exception as exc:
        self.retry(exc=exc)
