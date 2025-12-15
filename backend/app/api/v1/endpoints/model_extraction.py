# Copyright (c) 2025 Raphael Federicci Haddad.
# Licensed under the GNU Affero General Public License v3.0 (AGPLv3).
# Commercial licenses are available upon request.

"""
Model Extraction Endpoint.

Migrado de: supabase/functions/model-extraction/index.ts

Endpoint para extração automática de modelos de predição de artigos.
Identifica e cria instâncias de modelos com suas hierarquias completas.
"""

from uuid import UUID

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field

from app.core.deps import CurrentUser, DbSession, SupabaseClient
from app.core.logging import get_logger
from app.schemas.common import ApiResponse
from app.services.model_extraction_service import ModelExtractionService
from app.utils.rate_limiter import limiter

router = APIRouter()
logger = get_logger(__name__)


class ModelExtractionRequest(BaseModel):
    """Request para extração de modelos."""
    
    project_id: UUID = Field(..., alias="projectId")
    article_id: UUID = Field(..., alias="articleId")
    template_id: UUID = Field(..., alias="templateId")
    
    # Opções de extração
    model: str | None = Field(
        default="gpt-4o-mini",
        description="Modelo OpenAI a usar (gpt-4o-mini, gpt-4o, gpt-5)",
    )
    
    model_config = {"populate_by_name": True}


class ModelExtractionOptions(BaseModel):
    """Opções de extração."""
    
    model: str = Field(default="gpt-4o-mini")


class ModelExtractionResult(BaseModel):
    """Resultado da extração de modelos."""
    
    run_id: str
    models_created: list[dict]
    total_models: int


@router.post(
    "",
    response_model=ApiResponse,
    summary="Extrair modelos de predição",
    description="Identifica e extrai automaticamente modelos de predição do artigo.",
)
@limiter.limit("5/minute")
async def extract_models(
    request: ModelExtractionRequest,
    db: DbSession,
    user: CurrentUser,
    supabase: SupabaseClient,
) -> ApiResponse:
    """
    Executa extração de modelos de predição de um artigo.
    
    Rate limit: 5 requisições por minuto por usuário.
    
    O pipeline:
    1. Busca PDF do artigo
    2. Processa texto do PDF
    3. Identifica modelos de predição
    4. Cria instâncias com hierarquias
    
    Args:
        request: Dados do artigo e template.
        
    Returns:
        ApiResponse com modelos criados.
    """
    import uuid
    
    trace_id = str(uuid.uuid4())
    
    logger.info(
        "model_extraction_request",
        trace_id=trace_id,
        user_id=user.sub,
        project_id=str(request.project_id),
        article_id=str(request.article_id),
        template_id=str(request.template_id),
        model=request.model,
    )
    
    try:
        service = ModelExtractionService(
            db=db,
            user_id=user.sub,
            supabase=supabase,
            trace_id=trace_id,
        )
        
        result = await service.extract(
            project_id=request.project_id,
            article_id=request.article_id,
            template_id=request.template_id,
            model=request.model or "gpt-4o-mini",
        )
        
        logger.info(
            "model_extraction_success",
            trace_id=trace_id,
            user_id=user.sub,
            run_id=result.get("run_id"),
            models_count=len(result.get("models_created", [])),
        )
        
        return ApiResponse(ok=True, data=result)
        
    except ValueError as e:
        logger.warning(
            "model_extraction_validation_error",
            trace_id=trace_id,
            error=str(e),
        )
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e),
        ) from e
    except FileNotFoundError as e:
        logger.warning(
            "model_extraction_pdf_not_found",
            trace_id=trace_id,
            error=str(e),
        )
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="PDF not found. Upload a PDF first.",
        ) from e
    except Exception as e:
        logger.error(
            "model_extraction_error",
            trace_id=trace_id,
            error=str(e),
            exc_info=True,
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Model extraction failed: {str(e)}",
        ) from e

