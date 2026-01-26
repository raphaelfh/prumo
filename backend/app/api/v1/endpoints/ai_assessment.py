"""
AI Assessment Endpoint.

Migrado de: supabase/functions/ai-assessment/index.ts

Endpoint para avaliação de artigos usando IA (OpenAI Responses API).
Suporta leitura direta de PDF com fallback para File Search.
"""

import uuid

from fastapi import APIRouter, HTTPException, Request, status

from app.core.deps import CurrentUser, DbSession, SupabaseClient
from app.core.factories import create_storage_adapter
from app.core.logging import get_logger
from app.schemas.assessment import (
    AIAssessmentRequest,
    AIAssessmentResponseData,
    BatchAIAssessmentRequest,
    BatchAIAssessmentResponseData,
)
from app.schemas.common import ApiResponse
from app.services.ai_assessment_service import AIAssessmentService
from app.utils.rate_limiter import limiter

router = APIRouter()
logger = get_logger(__name__)


@router.post(
    "/ai",
    response_model=ApiResponse,
    summary="Avaliar artigo com IA",
    description="Usa OpenAI para avaliar um item de assessment baseado no PDF do artigo.",
)
@limiter.limit("10/minute")
async def ai_assessment(
    request: Request,  # Necessário para o rate limiter
    payload: AIAssessmentRequest,
    db: DbSession,
    user: CurrentUser,
    supabase: SupabaseClient,
) -> ApiResponse:
    """
    Executa avaliação AI de um item de assessment.
    
    Rate limit: 10 requisições por minuto por usuário.
    
    Args:
        request: Request HTTP (usado pelo rate limiter).
        payload: Dados do assessment a avaliar.
        
    Returns:
        ApiResponse com resultado da avaliação.
    """
    trace_id = str(uuid.uuid4())
    
    logger.info(
        "ai_assessment_request",
        trace_id=trace_id,
        user_id=user.sub,
        project_id=str(payload.project_id),
        article_id=str(payload.article_id),
        assessment_item_id=str(payload.assessment_item_id),
    )
    
    try:
        # Cria storage adapter via factory
        storage = create_storage_adapter(supabase)
        
        service = AIAssessmentService(
            db=db,
            user_id=user.sub,
            storage=storage,
            trace_id=trace_id,
        )
        
        result = await service.assess(
            project_id=payload.project_id,
            article_id=payload.article_id,
            assessment_item_id=payload.assessment_item_id,
            instrument_id=payload.instrument_id,
            pdf_storage_key=payload.pdf_storage_key,
            pdf_base64=payload.pdf_base64,
            pdf_filename=payload.pdf_filename,
            pdf_file_id=payload.pdf_file_id,
            force_file_search=payload.force_file_search,
            model=payload.model or "gpt-4o-mini",
        )
        
        # Commit explícito para persistir os resultados
        await db.commit()
        
        logger.info(
            "ai_assessment_success",
            trace_id=trace_id,
            user_id=user.sub,
            assessment_id=result.assessment_id,
            tokens_total=result.tokens_prompt + result.tokens_completion,
            method_used=result.method_used,
        )
        
        # Formatar resposta no formato camelCase para o frontend
        response_data = AIAssessmentResponseData(
            id=result.assessment_id,
            selected_level=result.selected_level,
            confidence_score=result.confidence_score,
            justification=result.justification,
            evidence_passages=result.evidence_passages,
            status="pending_review",
            metadata={
                "processingTimeMs": result.processing_time_ms,
                "tokensPrompt": result.tokens_prompt,
                "tokensCompletion": result.tokens_completion,
                "methodUsed": result.method_used,
            },
        ).model_dump(by_alias=True)
        
        return ApiResponse(ok=True, data=response_data, trace_id=trace_id)
        
    except ValueError as e:
        await db.rollback()
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
        await db.rollback()
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


@router.post(
    "/ai/batch",
    response_model=ApiResponse,
    summary="Avaliar múltiplos itens com IA",
    description="Usa OpenAI para avaliar múltiplos itens de assessment em batch.",
)
@limiter.limit("5/minute")
async def ai_assessment_batch(
    request: Request,
    payload: BatchAIAssessmentRequest,
    db: DbSession,
    user: CurrentUser,
    supabase: SupabaseClient,
) -> ApiResponse:
    """
    Executa avaliação AI em batch para múltiplos itens.
    
    Rate limit: 5 requisições por minuto por usuário.
    
    Args:
        request: Request HTTP (usado pelo rate limiter).
        payload: Dados dos itens a avaliar.
        
    Returns:
        ApiResponse com lista de resultados.
    """
    trace_id = str(uuid.uuid4())
    
    logger.info(
        "ai_assessment_batch_request",
        trace_id=trace_id,
        user_id=user.sub,
        project_id=str(payload.project_id),
        article_id=str(payload.article_id),
        items_count=len(payload.item_ids),
    )
    
    try:
        storage = create_storage_adapter(supabase)
        
        service = AIAssessmentService(
            db=db,
            user_id=user.sub,
            storage=storage,
            trace_id=trace_id,
        )
        
        results = await service.assess_batch(
            project_id=payload.project_id,
            article_id=payload.article_id,
            item_ids=payload.item_ids,
            instrument_id=payload.instrument_id,
            model=payload.model or "gpt-4o-mini",
        )
        
        await db.commit()
        
        # Formatar respostas
        formatted_results = [service.to_dict(r) for r in results]
        
        logger.info(
            "ai_assessment_batch_success",
            trace_id=trace_id,
            user_id=user.sub,
            total_items=len(payload.item_ids),
            successful_items=len(results),
        )
        
        response_data = BatchAIAssessmentResponseData(
            results=formatted_results,
            total_items=len(payload.item_ids),
            successful_items=len(results),
        ).model_dump(by_alias=True)

        return ApiResponse(ok=True, data=response_data, trace_id=trace_id)
        
    except Exception as e:
        await db.rollback()
        logger.error(
            "ai_assessment_batch_error",
            trace_id=trace_id,
            error=str(e),
            exc_info=True,
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Batch assessment failed: {str(e)}",
        ) from e
