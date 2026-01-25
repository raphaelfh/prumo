"""
Import Tasks.

Tasks Celery para importação de dados externos.
"""

import asyncio
from typing import Any
from uuid import UUID

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
) -> dict[str, Any]:
    """
    Task para importação de collection do Zotero.
    
    Args:
        project_id: ID do projeto.
        collection_key: Key da collection no Zotero.
        user_id: ID do usuário.
        import_pdfs: Se deve importar PDFs.
        max_items: Máximo de items a importar.
        
    Returns:
        Dict com resultado da importação.
    """
    from app.core.deps import AsyncSessionLocal, get_supabase_client
    from app.core.factories import create_storage_adapter
    from app.repositories import UnitOfWork
    from app.services.zotero_service import ZoteroService
    from app.use_cases import ImportZoteroRequest, ImportZoteroUseCase
    
    async def run():
        async with AsyncSessionLocal() as session:
            try:
                supabase = get_supabase_client()
                storage = create_storage_adapter(supabase)
                uow = UnitOfWork(session)
                
                # ZoteroService precisa da sessão
                zotero = ZoteroService(
                    db=session,
                    user_id=user_id,
                )
                
                use_case = ImportZoteroUseCase(
                    uow=uow,
                    zotero=zotero,
                    storage=storage,
                )
                
                request = ImportZoteroRequest(
                    project_id=UUID(project_id),
                    collection_key=collection_key,
                    user_id=user_id,
                    trace_id=self.request.id,
                    import_pdfs=import_pdfs,
                    max_items=max_items,
                )
                
                result = await use_case.execute(request)
                
                return {
                    "total_items": result.total_items,
                    "imported": result.imported,
                    "failed": result.failed,
                    "skipped": result.skipped,
                    "results": [
                        {
                            "zotero_key": r.zotero_key,
                            "title": r.title,
                            "success": r.success,
                            "article_id": r.article_id,
                            "has_pdf": r.has_pdf,
                            "error": r.error,
                        }
                        for r in result.results
                    ],
                }
            except Exception:
                await session.rollback()
                raise
    
    try:
        return asyncio.run(run())
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
    """
    Task para sincronização completa da biblioteca Zotero.
    
    Args:
        user_id: ID do usuário.
        
    Returns:
        Dict com resultado da sincronização.
    """
    from app.core.deps import AsyncSessionLocal
    from app.services.zotero_service import ZoteroService
    
    async def run():
        async with AsyncSessionLocal() as session:
            try:
                zotero = ZoteroService(
                    db=session,
                    user_id=user_id,
                )
                
                # Testar conexão
                connection_result = await zotero.test_connection()
                
                if not connection_result.get("success"):
                    return {
                        "success": False,
                        "error": connection_result.get("error"),
                    }
                
                # Listar collections
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
                        for c in collections_result.get("collections", [])[:20]  # Limitar
                    ],
                }
            except Exception:
                await session.rollback()
                raise
    
    try:
        return asyncio.run(run())
    except Exception as exc:
        self.retry(exc=exc)
