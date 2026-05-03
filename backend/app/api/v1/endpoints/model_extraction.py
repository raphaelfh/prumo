"""
Model Extraction Endpoint.

Endpoint for extraction automatica de modelos de predicao de articles.
Identifica and cria instances de modelos with its hierarquias completas.
"""

from time import perf_counter
from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.exc import IntegrityError

from app.api.deps.security import get_current_user_sub
from app.core.deps import CurrentUser, DbSession, SupabaseClient
from app.core.factories import create_storage_adapter
from app.core.logging import get_logger
from app.schemas.common import ApiResponse
from app.schemas.extraction import (
    CreateModelHierarchyRequest,
    CreateModelHierarchyResponse,
    ModelExtractionRequest,
    ModelExtractionResult,
    ModelHierarchyChildResponse,
)
from app.services.api_key_service import APIKeyService
from app.services.model_hierarchy_service import ModelHierarchyService
from app.services.model_extraction_service import ModelExtractionService
from app.utils.rate_limiter import limiter

router = APIRouter()
logger = get_logger(__name__)


@router.post(
    "/manual",
    response_model=ApiResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Create one prediction model hierarchy",
    description="Creates the parent prediction model and required singleton children in one transaction.",
)
@limiter.limit("60/minute")
async def create_manual_model_hierarchy(
    request: Request,  # noqa: ARG001
    payload: CreateModelHierarchyRequest,
    db: DbSession,
    current_user_sub: UUID = Depends(get_current_user_sub),
) -> ApiResponse:
    trace_id = getattr(request.state, "trace_id", None) or "missing-trace-id"
    service = ModelHierarchyService(db)

    try:
        result = await service.create_model_hierarchy(
            project_id=payload.project_id,
            article_id=payload.article_id,
            template_id=payload.template_id,
            user_id=current_user_sub,
            model_name=payload.model_name,
            modelling_method=payload.modelling_method,
        )
        await db.commit()
        return ApiResponse.success(
            CreateModelHierarchyResponse(
                model_id=result.model_id,
                model_label=result.model_label,
                child_instances=[
                    ModelHierarchyChildResponse(
                        id=child.id,
                        entity_type_id=child.entity_type_id,
                        parent_instance_id=child.parent_instance_id,
                        label=child.label,
                    )
                    for child in result.child_instances
                ],
                proposal_run_id=result.proposal_run_id,
            ),
            trace_id=trace_id,
        )
    except ValueError as exc:
        await db.rollback()
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except Exception as exc:
        await db.rollback()
        logger.error(
            "manual_model_hierarchy_error",
            trace_id=trace_id,
            user_id=str(current_user_sub),
            project_id=str(payload.project_id),
            article_id=str(payload.article_id),
            template_id=str(payload.template_id),
            error=str(exc),
            exc_info=True,
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to create model hierarchy",
        ) from exc


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
    trace_id = getattr(request.state, "trace_id", None) or "missing-trace-id"
    endpoint_start = perf_counter()

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

        db_commit_start = perf_counter()
        await db.commit()
        db_commit_duration_ms = (perf_counter() - db_commit_start) * 1000
        endpoint_duration_ms = (perf_counter() - endpoint_start) * 1000

        logger.info(
            "model_extraction_success",
            trace_id=trace_id,
            user_id=user.sub,
            run_id=result.extraction_run_id,
            models_count=result.total_models,
            children_count=result.child_instances_created,
            tokens_total=result.tokens_total,
            db_commit_duration_ms=db_commit_duration_ms,
            endpoint_duration_ms=endpoint_duration_ms,
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
        rollback_start = perf_counter()
        await db.rollback()
        rollback_duration_ms = (perf_counter() - rollback_start) * 1000
        logger.warning(
            "model_extraction_validation_error",
            trace_id=trace_id,
            error=str(e),
            rollback_duration_ms=rollback_duration_ms,
        )
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e),
        ) from e
    except IntegrityError as e:
        rollback_start = perf_counter()
        await db.rollback()
        rollback_duration_ms = (perf_counter() - rollback_start) * 1000
        logger.warning(
            "model_extraction_integrity_error",
            trace_id=trace_id,
            error=str(e),
            rollback_duration_ms=rollback_duration_ms,
        )
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Referenced project, article or template does not exist.",
        ) from e
    except FileNotFoundError as e:
        rollback_start = perf_counter()
        await db.rollback()
        rollback_duration_ms = (perf_counter() - rollback_start) * 1000
        logger.warning(
            "model_extraction_pdf_not_found",
            trace_id=trace_id,
            error=str(e),
            rollback_duration_ms=rollback_duration_ms,
        )
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="PDF not found. Upload a PDF first.",
        ) from e
    except Exception as e:
        rollback_start = perf_counter()
        await db.rollback()
        rollback_duration_ms = (perf_counter() - rollback_start) * 1000
        logger.error(
            "model_extraction_error",
            trace_id=trace_id,
            error=str(e),
            rollback_duration_ms=rollback_duration_ms,
            endpoint_duration_ms=(perf_counter() - endpoint_start) * 1000,
            exc_info=True,
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Model extraction failed: {str(e)}",
        ) from e
