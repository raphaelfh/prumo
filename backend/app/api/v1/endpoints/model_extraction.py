"""
Model Extraction Endpoint.

Migrado de: supabase/functions/model-extraction/index.ts

Endpoint for extraction automatica de modelos de predicao de articles.
Identifica and cria instances de modelos with its hierarquias completas.
"""

import uuid

from fastapi import APIRouter, HTTPException, Request, status

from app.core.deps import CurrentUser, DbSession, SupabaseClient
from app.core.factories import create_storage_adapter
from app.core.logging import get_logger
from app.schemas.common import ApiResponse
from app.schemas.extraction import ModelExtractionRequest, ModelExtractionResult
from app.services.api_key_service import APIKeyService
from app.services.model_extraction_service import ModelExtractionService
from app.utils.rate_limiter import limiter

router = APIRouter()
logger = get_logger(__name__)


@router.post(
    "",
    response_model=ApiResponse,
    summary="Extrair modelos de predicao",
    description="Identifica and extrai automaticamente modelos de predicao do article.",
)
@limiter.limit("5/minute")
async def extract_models(
    request: Request,  # noqa: ARG001
    payload: ModelExtractionRequest,
    db: DbSession,
    user: CurrentUser,
    supabase: SupabaseClient,
) -> ApiResponse:
    """
    Run prediction model extraction for an article.

    Rate limit: 5 requests per minute per user.

    Pipeline:
    1. Fetch article PDF
    2. Process PDF text
    3. Identify prediction models
    4. Create instances with hierarchies

    Args:
        request: HTTP request (used by rate limiter).
        payload: Article and template data.

    Returns:
        ApiResponse with created models.
    """
    trace_id = str(uuid.uuid4())

    logger.info(
        "model_extraction_request",
        trace_id=trace_id,
        user_id=user.sub,
        project_id=str(payload.project_id),
        article_id=str(payload.article_id),
        template_id=str(payload.template_id),
        model=payload.model,
    )

    try:
        # Create storage adapter via factory
        storage = create_storage_adapter(supabase)

        # Buscar API key do user (BYOK) with fallback for global
        api_key_service = APIKeyService(db=db, user_id=user.sub)
        user_openai_key = await api_key_service.get_key_for_provider("openai")

        service = ModelExtractionService(
            db=db,
            user_id=user.sub,
            storage=storage,
            trace_id=trace_id,
            openai_api_key=user_openai_key,
        )

        result = await service.extract(
            project_id=payload.project_id,
            article_id=payload.article_id,
            template_id=payload.template_id,
            model=payload.model or "gpt-4o-mini",
        )

        # Commit explicito for persistir as instances criadas
        await db.commit()

        logger.info(
            "model_extraction_success",
            trace_id=trace_id,
            user_id=user.sub,
            run_id=result.extraction_run_id,
            models_count=result.total_models,
            children_count=result.child_instances_created,
            tokens_total=result.tokens_total,
        )

        # Formatar resposta in the formato camelCase for o frontend
        response_data = ModelExtractionResult(
            extraction_run_id=result.extraction_run_id,
            models_created=result.models_created,
            total_models=result.total_models,
            child_instances_created=result.child_instances_created,
            metadata={
                "duration": int(result.duration_ms),
                "modelsFound": result.total_models,
                "tokensPrompt": result.tokens_prompt,
                "tokensCompletion": result.tokens_completion,
                "tokensTotal": result.tokens_total,
            },
        ).model_dump(by_alias=True)

        return ApiResponse(ok=True, data=response_data, trace_id=trace_id)

    except ValueError as e:
        await db.rollback()
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
        await db.rollback()
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
        await db.rollback()
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
