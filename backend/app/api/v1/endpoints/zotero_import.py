"""
Zotero Import Endpoint.

Migrado de: supabase/functions/zotero-import/index.ts

Endpoints para integração com Zotero:
- Salvar credenciais
- Testar conexão
- Listar collections
- Buscar items
- Download de attachments
"""

from enum import Enum
from typing import Any

from fastapi import APIRouter, HTTPException, status

from app.core.deps import CurrentUser, DbSession, SupabaseClient
from app.core.logging import get_logger
from app.schemas.common import ApiResponse
from app.schemas.zotero import (
    DownloadAttachmentRequest,
    FetchAttachmentsRequest,
    FetchItemsRequest,
    SaveCredentialsRequest,
)
from app.services.zotero_service import ZoteroService

router = APIRouter()
logger = get_logger(__name__)


class ZoteroAction(str, Enum):
    """Ações disponíveis para Zotero."""
    
    SAVE_CREDENTIALS = "save-credentials"
    TEST_CONNECTION = "test-connection"
    LIST_COLLECTIONS = "list-collections"
    FETCH_ITEMS = "fetch-items"
    FETCH_ATTACHMENTS = "fetch-attachments"
    DOWNLOAD_ATTACHMENT = "download-attachment"


@router.post(
    "/{action}",
    response_model=ApiResponse,
    summary="Executar ação Zotero",
    description="Endpoint unificado para todas as ações de integração com Zotero.",
)
async def zotero_action(
    action: ZoteroAction,
    db: DbSession,
    user: CurrentUser,
    supabase: SupabaseClient,
    body: dict[str, Any] | None = None,
) -> ApiResponse:
    """
    Executa uma ação de integração com Zotero.
    
    Args:
        action: Tipo de ação a executar.
        body: Dados específicos da ação.
        
    Returns:
        ApiResponse com resultado da ação.
    """
    service = ZoteroService(db=db, user_id=user.sub)
    body = body or {}
    
    logger.info(
        "zotero_action_request",
        action=action.value,
        user_id=user.sub,
    )
    
    try:
        match action:
            case ZoteroAction.SAVE_CREDENTIALS:
                request = SaveCredentialsRequest(**body)
                result = await service.save_credentials(
                    zotero_user_id=request.zotero_user_id,
                    api_key=request.api_key,
                    library_type=request.library_type,
                )
                # Commit explícito para persistir credenciais
                await db.commit()

            case ZoteroAction.TEST_CONNECTION:
                result = await service.test_connection()
                
            case ZoteroAction.LIST_COLLECTIONS:
                result = await service.list_collections()
                
            case ZoteroAction.FETCH_ITEMS:
                request = FetchItemsRequest(**body)
                result = await service.fetch_items(
                    collection_key=request.collection_key,
                    limit=request.limit,
                    start=request.start,
                )
                
            case ZoteroAction.FETCH_ATTACHMENTS:
                request = FetchAttachmentsRequest(**body)
                result = await service.fetch_attachments(item_key=request.item_key)
                
            case ZoteroAction.DOWNLOAD_ATTACHMENT:
                request = DownloadAttachmentRequest(**body)
                result = await service.download_attachment(
                    attachment_key=request.attachment_key,
                )
                
            case _:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Unknown action: {action}",
                )
        
        logger.info(
            "zotero_action_success",
            action=action.value,
            user_id=user.sub,
        )
        
        return ApiResponse(ok=True, data=result)
        
    except ValueError as e:
        logger.warning(
            "zotero_action_validation_error",
            action=action.value,
            error=str(e),
        )
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e),
        ) from e
    except Exception as e:
        logger.error(
            "zotero_action_error",
            action=action.value,
            error=str(e),
            exc_info=True,
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Zotero operation failed: {str(e)}",
        ) from e
