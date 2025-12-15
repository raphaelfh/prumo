# Copyright (c) 2025 Raphael Federicci Haddad.
# Licensed under the GNU Affero General Public License v3.0 (AGPLv3).
# Commercial licenses are available upon request.

"""
Section Extraction Endpoint.

Migrado de: supabase/functions/section-extraction/index.ts

Endpoint para extração de seções específicas de templates.
Suporta extração individual ou em batch de todas as seções.
"""

from uuid import UUID

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field, model_validator

from app.core.deps import CurrentUser, DbSession, SupabaseClient
from app.core.logging import get_logger
from app.schemas.common import ApiResponse
from app.services.section_extraction_service import SectionExtractionService
from app.utils.rate_limiter import limiter

router = APIRouter()
logger = get_logger(__name__)


class SectionExtractionRequest(BaseModel):
    """Request para extração de seção."""
    
    project_id: UUID = Field(..., alias="projectId")
    article_id: UUID = Field(..., alias="articleId")
    template_id: UUID = Field(..., alias="templateId")
    
    # Para extração de seção única
    entity_type_id: UUID | None = Field(default=None, alias="entityTypeId")
    
    # Para extração em batch de todas as seções
    parent_instance_id: UUID | None = Field(default=None, alias="parentInstanceId")
    extract_all_sections: bool = Field(default=False, alias="extractAllSections")
    
    # Filtrar seções específicas (para chunking)
    section_ids: list[UUID] | None = Field(default=None, alias="sectionIds")
    
    # Texto do PDF já processado (evita reprocessar)
    pdf_text: str | None = Field(default=None, alias="pdfText")
    
    # Opções de extração
    model: str | None = Field(
        default="gpt-4o-mini",
        description="Modelo OpenAI a usar",
    )
    
    model_config = {"populate_by_name": True}
    
    @model_validator(mode="after")
    def validate_extraction_mode(self) -> "SectionExtractionRequest":
        """Valida que os campos corretos estão presentes para cada modo."""
        if self.extract_all_sections:
            if not self.parent_instance_id:
                raise ValueError(
                    "parentInstanceId is required when extractAllSections is true"
                )
        else:
            if not self.entity_type_id:
                raise ValueError(
                    "entityTypeId is required when extractAllSections is false"
                )
        return self


class SingleSectionResult(BaseModel):
    """Resultado de extração de seção única."""
    
    run_id: str
    suggestions_created: int
    entity_type_id: str


class BatchSectionResult(BaseModel):
    """Resultado de extração em batch."""
    
    run_id: str
    total_sections: int
    successful_sections: int
    failed_sections: int
    total_suggestions_created: int


@router.post(
    "",
    response_model=ApiResponse,
    summary="Extrair seção(ões) de template",
    description="Extrai dados de uma seção específica ou todas as seções de um modelo.",
)
@limiter.limit("10/minute")
async def extract_section(
    request: SectionExtractionRequest,
    db: DbSession,
    user: CurrentUser,
    supabase: SupabaseClient,
) -> ApiResponse:
    """
    Executa extração de seção(ões) de um template.
    
    Rate limit: 10 requisições por minuto por usuário.
    
    Modos de operação:
    1. Seção única: entity_type_id obrigatório
    2. Todas as seções: extract_all_sections=true, parent_instance_id obrigatório
    
    Args:
        request: Parâmetros de extração.
        
    Returns:
        ApiResponse com resultado da extração.
    """
    import uuid
    
    trace_id = str(uuid.uuid4())
    
    logger.info(
        "section_extraction_request",
        trace_id=trace_id,
        user_id=user.sub,
        project_id=str(request.project_id),
        article_id=str(request.article_id),
        template_id=str(request.template_id),
        entity_type_id=str(request.entity_type_id) if request.entity_type_id else None,
        extract_all_sections=request.extract_all_sections,
        model=request.model,
    )
    
    try:
        service = SectionExtractionService(
            db=db,
            user_id=user.sub,
            supabase=supabase,
            trace_id=trace_id,
        )
        
        if request.extract_all_sections:
            # Extração em batch de todas as seções
            result = await service.extract_all_sections(
                project_id=request.project_id,
                article_id=request.article_id,
                template_id=request.template_id,
                parent_instance_id=request.parent_instance_id,  # type: ignore
                section_ids=request.section_ids,
                pdf_text=request.pdf_text,
                model=request.model or "gpt-4o-mini",
            )
            
            logger.info(
                "batch_section_extraction_success",
                trace_id=trace_id,
                total_sections=result.get("total_sections"),
                successful=result.get("successful_sections"),
                failed=result.get("failed_sections"),
            )
        else:
            # Extração de seção única
            result = await service.extract_section(
                project_id=request.project_id,
                article_id=request.article_id,
                template_id=request.template_id,
                entity_type_id=request.entity_type_id,  # type: ignore
                parent_instance_id=request.parent_instance_id,
                model=request.model or "gpt-4o-mini",
            )
            
            logger.info(
                "section_extraction_success",
                trace_id=trace_id,
                run_id=result.get("run_id"),
                suggestions_created=result.get("suggestions_created"),
            )
        
        return ApiResponse(ok=True, data=result)
        
    except ValueError as e:
        logger.warning(
            "section_extraction_validation_error",
            trace_id=trace_id,
            error=str(e),
        )
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e),
        ) from e
    except FileNotFoundError as e:
        logger.warning(
            "section_extraction_pdf_not_found",
            trace_id=trace_id,
            error=str(e),
        )
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="PDF not found. Upload a PDF first.",
        ) from e
    except Exception as e:
        logger.error(
            "section_extraction_error",
            trace_id=trace_id,
            error=str(e),
            exc_info=True,
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Section extraction failed: {str(e)}",
        ) from e

