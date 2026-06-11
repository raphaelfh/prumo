"""
Section Extraction Endpoint.

Endpoint for extraction de sections especificas de templates.
Suporta extraction individual or em batch de todas as sections.
"""

from time import perf_counter
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.exc import IntegrityError

from app.api.deps.security import ensure_project_member, get_current_user_sub
from app.core.deps import CurrentUser, DbSession, SupabaseClient
from app.core.factories import create_storage_adapter
from app.core.logging import get_logger
from app.schemas.common import ApiResponse
from app.schemas.extraction import (
    BatchSectionResult,
    SectionExtractionRequest,
    SectionExtractionResponseData,
    SingleSectionResult,
)
from app.services.api_key_service import APIKeyService
from app.services.extraction_run_read_service import RunNotFoundError, get_run_or_raise
from app.services.run_lifecycle_service import (
    CreateRunInputError,
    TemplateNotFoundError,
    TemplateVersionNotFoundError,
)
from app.services.section_extraction_service import SectionExtractionService
from app.utils.rate_limiter import limiter

router = APIRouter()
logger = get_logger(__name__)


async def _check_request_scope(
    db: DbSession,
    payload: SectionExtractionRequest,
    current_user_sub: UUID,
) -> None:
    if payload.run_id is None:
        await ensure_project_member(db, payload.project_id, current_user_sub)
        return

    try:
        run = await get_run_or_raise(db, payload.run_id)
    except RunNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc

    await ensure_project_member(db, run.project_id, current_user_sub)
    if (
        payload.project_id != run.project_id
        or payload.article_id != run.article_id
        or payload.template_id != run.template_id
    ):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="runId does not match projectId, articleId, and templateId",
        )


@router.post(
    "",
    response_model=ApiResponse[SectionExtractionResponseData],
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
    current_user_sub: UUID = Depends(get_current_user_sub),
) -> ApiResponse[SectionExtractionResponseData]:
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

    await _check_request_scope(db, payload, current_user_sub)

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

        # Dispatch table (ordered — earlier branches win on overlapping
        # payloads, matching the pre-refactor priority):
        # 1. ``entity_type_id`` present → single-section path. Covers both
        #    the existing-run append (extraction surface; ``run_id`` set)
        #    and the legacy standalone caller (``run_id`` None). The
        #    service routes internally based on ``run_id``.
        # 2. ``run_id`` alone → ``extract_for_run`` iterates every top-level
        #    entity_type of the run's template. Used by Quality Assessment.
        # 3. ``extract_all_sections`` → batch sweep of child sections under
        #    ``parent_instance_id`` (per-model CHARMS batch).
        if payload.entity_type_id is not None:
            single_result = await service.extract_section(
                project_id=payload.project_id,
                article_id=payload.article_id,
                template_id=payload.template_id,
                entity_type_id=payload.entity_type_id,
                parent_instance_id=payload.parent_instance_id,
                model=payload.model or "gpt-4o-mini",
                run_id=payload.run_id,
            )

            db_commit_start = perf_counter()
            await db.commit()
            db_commit_duration_ms = (perf_counter() - db_commit_start) * 1000

            logger.info(
                "section_extraction_success",
                trace_id=trace_id,
                run_id=single_result.extraction_run_id,
                entity_type_id=str(payload.entity_type_id),
                suggestions_created=single_result.suggestions_created,
                tokens_total=single_result.tokens_total,
                existing_run=payload.run_id is not None,
                db_commit_duration_ms=db_commit_duration_ms,
                endpoint_duration_ms=(perf_counter() - endpoint_start) * 1000,
            )

            response_data: SectionExtractionResponseData = SingleSectionResult(
                extraction_run_id=single_result.extraction_run_id,
                entity_type_id=single_result.entity_type_id,
                suggestions_created=single_result.suggestions_created,
                tokens_prompt=single_result.tokens_prompt,
                tokens_completion=single_result.tokens_completion,
                tokens_total=single_result.tokens_total,
                duration_ms=single_result.duration_ms,
            )
        elif payload.run_id is not None:
            qa_result = await service.extract_for_run(
                run_id=payload.run_id,
                skip_fields_with_human_proposals=payload.skip_fields_with_human_proposals,
                auto_advance_to_review=payload.auto_advance_to_review,
                model=payload.model or "gpt-4o-mini",
            )

            db_commit_start = perf_counter()
            await db.commit()
            db_commit_duration_ms = (perf_counter() - db_commit_start) * 1000

            logger.info(
                "extract_for_run_success",
                trace_id=trace_id,
                run_id=qa_result.extraction_run_id,
                total_sections=qa_result.total_sections,
                successful=qa_result.successful_sections,
                failed=qa_result.failed_sections,
                tokens_total=qa_result.total_tokens_used,
                db_commit_duration_ms=db_commit_duration_ms,
                endpoint_duration_ms=(perf_counter() - endpoint_start) * 1000,
            )

            response_data = BatchSectionResult(
                extraction_run_id=qa_result.extraction_run_id,
                total_sections=qa_result.total_sections,
                successful_sections=qa_result.successful_sections,
                failed_sections=qa_result.failed_sections,
                total_suggestions_created=qa_result.total_suggestions_created,
                total_tokens_used=qa_result.total_tokens_used,
                duration_ms=qa_result.duration_ms,
                sections=qa_result.sections,
            )
        else:
            # ``extract_all_sections`` (validator forces parent_instance_id).
            batch_result = await service.extract_all_sections(
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
                run_id=batch_result.extraction_run_id,
                total_sections=batch_result.total_sections,
                successful=batch_result.successful_sections,
                failed=batch_result.failed_sections,
                tokens_total=batch_result.total_tokens_used,
                db_commit_duration_ms=db_commit_duration_ms,
                endpoint_duration_ms=(perf_counter() - endpoint_start) * 1000,
            )

            response_data = BatchSectionResult(
                extraction_run_id=batch_result.extraction_run_id,
                total_sections=batch_result.total_sections,
                successful_sections=batch_result.successful_sections,
                failed_sections=batch_result.failed_sections,
                total_suggestions_created=batch_result.total_suggestions_created,
                total_tokens_used=batch_result.total_tokens_used,
                duration_ms=batch_result.duration_ms,
                sections=batch_result.sections,
            )

        return ApiResponse(ok=True, data=response_data, trace_id=trace_id)

    except CreateRunInputError as e:
        rollback_start = perf_counter()
        await db.rollback()
        rollback_duration_ms = (perf_counter() - rollback_start) * 1000
        logger.warning(
            "section_extraction_bola_rejected",
            trace_id=trace_id,
            project_id=str(payload.project_id),
            article_id=str(payload.article_id),
            error=str(e),
            rollback_duration_ms=rollback_duration_ms,
        )
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e)) from e
    except (TemplateNotFoundError, TemplateVersionNotFoundError) as e:
        rollback_start = perf_counter()
        await db.rollback()
        rollback_duration_ms = (perf_counter() - rollback_start) * 1000
        logger.warning(
            "section_extraction_template_missing",
            trace_id=trace_id,
            template_id=str(payload.template_id),
            error=str(e),
            rollback_duration_ms=rollback_duration_ms,
        )
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e)) from e
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
