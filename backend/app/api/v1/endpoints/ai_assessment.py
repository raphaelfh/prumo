# Copyright (c) 2025 Raphael Federicci Haddad.
# Licensed under the GNU Affero General Public License v3.0 (AGPLv3).
# Commercial licenses are available upon request.

"""
AI Assessment Endpoint.

Migrado de: supabase/functions/ai-assessment/index.ts

Endpoint para avaliação de artigos usando IA (OpenAI Responses API).
Suporta leitura direta de PDF com fallback para File Search.
"""

from uuid import UUID

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field
from slowapi import Limiter
from slowapi.util import get_remote_address

from app.core.deps import CurrentUser, DbSession, SupabaseClient
from app.core.logging import get_logger
from app.schemas.common import ApiResponse
from app.services.ai_assessment_service import AIAssessmentService
from app.utils.rate_limiter import limiter

router = APIRouter()
logger = get_logger(__name__)


class AIAssessmentRequest(BaseModel):
    """Request para avaliação AI de um item de assessment."""
    
    project_id: UUID = Field(..., alias="projectId")
    article_id: UUID = Field(..., alias="articleId")
    assessment_item_id: UUID = Field(..., alias="assessmentItemId")
    instrument_id: UUID = Field(..., alias="instrumentId")
    
    # Opcionais para fonte do PDF
    pdf_storage_key: str | None = Field(default=None, alias="pdf_storage_key")
    pdf_base64: str | None = Field(default=None, alias="pdf_base64")
    pdf_filename: str | None = Field(default=None, alias="pdf_filename")
    pdf_file_id: str | None = Field(default=None, alias="pdf_file_id")
    
    # Forçar uso de File Search (para PDFs > 32MB)
    force_file_search: bool = Field(default=False, alias="force_file_search")
    
    model_config = {"populate_by_name": True}


class AIAssessmentResponse(BaseModel):
    """Response da avaliação AI."""
    
    assessment: dict
    trace_id: str


@router.post(
    "/ai",
    response_model=ApiResponse,
    summary="Avaliar artigo com IA",
    description="Usa OpenAI para avaliar um item de assessment baseado no PDF do artigo.",
)
@limiter.limit("10/minute")
async def ai_assessment(
    request: AIAssessmentRequest,
    db: DbSession,
    user: CurrentUser,
    supabase: SupabaseClient,
) -> ApiResponse:
    """
    Executa avaliação AI de um item de assessment.
    
    Rate limit: 10 requisições por minuto por usuário.
    
    Args:
        request: Dados do assessment a avaliar.
        
    Returns:
        ApiResponse com resultado da avaliação.
    """
    import uuid
    
    trace_id = str(uuid.uuid4())
    
    logger.info(
        "ai_assessment_request",
        trace_id=trace_id,
        user_id=user.sub,
        project_id=str(request.project_id),
        article_id=str(request.article_id),
        assessment_item_id=str(request.assessment_item_id),
    )
    
    try:
        service = AIAssessmentService(
            db=db,
            user_id=user.sub,
            supabase=supabase,
            trace_id=trace_id,
        )
        
        result = await service.assess(
            project_id=request.project_id,
            article_id=request.article_id,
            assessment_item_id=request.assessment_item_id,
            instrument_id=request.instrument_id,
            pdf_storage_key=request.pdf_storage_key,
            pdf_base64=request.pdf_base64,
            pdf_filename=request.pdf_filename,
            pdf_file_id=request.pdf_file_id,
            force_file_search=request.force_file_search,
        )
        
        logger.info(
            "ai_assessment_success",
            trace_id=trace_id,
            user_id=user.sub,
            assessment_id=result.get("id"),
        )
        
        return ApiResponse(
            ok=True,
            data={"assessment": result, "trace_id": trace_id},
        )
        
    except ValueError as e:
        logger.warning(
            "ai_assessment_validation_error",
            trace_id=trace_id,
            error=str(e),
        )
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e),
        ) from e
    except Exception as e:
        logger.error(
            "ai_assessment_error",
            trace_id=trace_id,
            error=str(e),
            exc_info=True,
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Assessment failed: {str(e)}",
        ) from e

