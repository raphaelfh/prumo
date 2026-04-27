"""
Section Extraction Endpoint.

Migrado de: supabase/functions/section-extraction/index.ts

Endpoint for extraction de sections especificas de templates.
Suporta extraction individual or em batch de todas as sections.
"""

from time import perf_counter

from fastapi import APIRouter, HTTPException, Request, status
from sqlalchemy.exc import IntegrityError

from app.core.deps import CurrentUser, DbSession, SupabaseClient
from app.core.factories import create_storage_adapter
from app.core.logging import get_logger
from app.schemas.common import ApiResponse
from app.schemas.extraction import (
    BatchSectionResult,
    SectionExtractionRequest,
    SingleSectionResult,
)
from app.services.api_key_service import APIKeyService
from app.services.section_extraction_service import SectionExtractionService
from app.utils.rate_limiter import limiter

router = APIRouter()
logger = get_logger(__name__)


@router.post(
    "",
    response_model=ApiResponse,
    summary="Extrair section(oes) de template",
    description="Extrai data de uma section especifica or todas as sections de um modelo.",
)
@limiter.limit("10/minute")
async def extract_section(
    request: Request,  # noqa: ARG001
    payload: SectionExtractionRequest,
    db: DbSession,
    user: CurrentUser,
    supabase: SupabaseClient,
) -> ApiResponse:
    """
    Executa extraction de section(oes) de um template.

    Rate limit: 10 requisicoes por minuto por user.

    Modos de operacao:
    1. Secao unica: entity_type_id obrigatorio
    2. Todas as sections: extract_all_sections=true, parent_instance_id obrigatorio

    Args:
        request: Request HTTP (usado pelo rate limiter).
        payload: Parametros de extraction.

    Returns:
        ApiResponse with resultado da extraction.
    """
    trace_id = getattr(request.state, "trace_id", None) or "missing-trace-id"
    endpoint_start = perf_counter()

    logger.info(
        "section_extraction_request",
        trace_id=trace_id,
        user_id=user.sub,
        project_id=str(payload.project_id),
        article_id=str(payload.article_id),
        template_id=str(payload.template_id),
        entity_type_id=str(payload.entity_type_id) if payload.entity_type_id else None,
        extract_all_sections=payload.extract_all_sections,
        model=payload.model,
    )

    try:
        # Create storage adapter via factory
        storage = create_storage_adapter(supabase)

        # Buscar API key do user (BYOK) with fallback for global
        api_key_service = APIKeyService(db=db, user_id=user.sub)
        user_openai_key = await api_key_service.get_key_for_provider("openai")

        service = SectionExtractionService(
            db=db,
            user_id=user.sub,
            storage=storage,
            trace_id=trace_id,
            openai_api_key=user_openai_key,
        )

        if payload.extract_all_sections:
            # Extracao em batch de todas as sections
            result = await service.extract_all_sections(
                project_id=payload.project_id,
                article_id=payload.article_id,
                template_id=payload.template_id,
                parent_instance_id=payload.parent_instance_id,  # type: ignore
                section_ids=payload.section_ids,
                pdf_text=payload.pdf_text,
                model=payload.model or "gpt-4o-mini",
            )

            db_commit_start = perf_counter()
            await db.commit()
            db_commit_duration_ms = (perf_counter() - db_commit_start) * 1000

            logger.info(
                "batch_section_extraction_success",
                trace_id=trace_id,
                run_id=result.extraction_run_id,
                total_sections=result.total_sections,
                successful=result.successful_sections,
                failed=result.failed_sections,
                tokens_total=result.total_tokens_used,
                db_commit_duration_ms=db_commit_duration_ms,
                endpoint_duration_ms=(perf_counter() - endpoint_start) * 1000,
            )

            # Formatar resposta in the formato camelCase for o frontend
            response_data = BatchSectionResult(
                extraction_run_id=result.extraction_run_id,
                total_sections=result.total_sections,
                successful_sections=result.successful_sections,
                failed_sections=result.failed_sections,
                total_suggestions_created=result.total_suggestions_created,
                total_tokens_used=result.total_tokens_used,
                duration_ms=result.duration_ms,
                sections=result.sections,
            ).model_dump(by_alias=True)
        else:
            # Extracao de section unica
            result = await service.extract_section(
                project_id=payload.project_id,
                article_id=payload.article_id,
                template_id=payload.template_id,
                entity_type_id=payload.entity_type_id,  # type: ignore
                parent_instance_id=payload.parent_instance_id,
                model=payload.model or "gpt-4o-mini",
            )

            db_commit_start = perf_counter()
            await db.commit()
            db_commit_duration_ms = (perf_counter() - db_commit_start) * 1000

            logger.info(
                "section_extraction_success",
                trace_id=trace_id,
                run_id=result.extraction_run_id,
                suggestions_created=result.suggestions_created,
                tokens_total=result.tokens_total,
                db_commit_duration_ms=db_commit_duration_ms,
                endpoint_duration_ms=(perf_counter() - endpoint_start) * 1000,
            )

            # Formatar resposta in the formato camelCase for o frontend
            response_data = SingleSectionResult(
                extraction_run_id=result.extraction_run_id,
                entity_type_id=result.entity_type_id,
                suggestions_created=result.suggestions_created,
                tokens_prompt=result.tokens_prompt,
                tokens_completion=result.tokens_completion,
                tokens_total=result.tokens_total,
                duration_ms=result.duration_ms,
            ).model_dump(by_alias=True)

        return ApiResponse(ok=True, data=response_data, trace_id=trace_id)

    except ValueError as e:
        rollback_start = perf_counter()
        await db.rollback()
        rollback_duration_ms = (perf_counter() - rollback_start) * 1000
        logger.warning(
            "section_extraction_validation_error",
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
            "section_extraction_integrity_error",
            trace_id=trace_id,
            error=str(e),
            rollback_duration_ms=rollback_duration_ms,
        )
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Referenced project, article, template or entity_type does not exist.",
        ) from e
    except FileNotFoundError as e:
        rollback_start = perf_counter()
        await db.rollback()
        rollback_duration_ms = (perf_counter() - rollback_start) * 1000
        logger.warning(
            "section_extraction_pdf_not_found",
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
            "section_extraction_error",
            trace_id=trace_id,
            error=str(e),
            rollback_duration_ms=rollback_duration_ms,
            endpoint_duration_ms=(perf_counter() - endpoint_start) * 1000,
            exc_info=True,
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Section extraction failed: {str(e)}",
        ) from e
