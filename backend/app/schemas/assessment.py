"""
Assessment Schemas.

Schemas Pydantic para avaliação de qualidade de artigos.
"""

from datetime import datetime
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


# =================== EVIDENCE SCHEMAS ===================


class EvidencePassage(BaseModel):
    """Passagem de texto citada como evidência."""
    
    text: str = Field(..., description="Texto extraído do documento")
    page_number: int | None = Field(default=None, alias="pageNumber")
    
    model_config = ConfigDict(populate_by_name=True)


# =================== AI ASSESSMENT SCHEMAS ===================


class AIAssessmentRequest(BaseModel):
    """Request para avaliação AI de um item de assessment."""
    
    project_id: UUID = Field(..., alias="projectId")
    article_id: UUID = Field(..., alias="articleId")
    assessment_item_id: UUID = Field(..., alias="assessmentItemId")
    instrument_id: UUID = Field(..., alias="instrumentId")
    
    # Opcionais para fonte do PDF
    pdf_storage_key: str | None = Field(default=None, alias="pdfStorageKey")
    pdf_base64: str | None = Field(default=None, alias="pdfBase64")
    pdf_filename: str | None = Field(default=None, alias="pdfFilename")
    pdf_file_id: str | None = Field(default=None, alias="pdfFileId")
    
    # Forçar uso de File Search (para PDFs > 32MB)
    force_file_search: bool = Field(default=False, alias="forceFileSearch")
    
    # Opções do modelo
    model: str = Field(default="gpt-4o-mini")
    temperature: float = Field(default=0.1, ge=0, le=1)
    
    model_config = ConfigDict(populate_by_name=True)


class AIAssessmentResult(BaseModel):
    """Resultado da avaliação AI."""
    
    id: UUID
    project_id: UUID = Field(..., alias="projectId")
    article_id: UUID = Field(..., alias="articleId")
    assessment_item_id: UUID = Field(..., alias="assessmentItemId")
    instrument_id: UUID = Field(..., alias="instrumentId")
    
    selected_level: str = Field(..., alias="selectedLevel")
    confidence_score: float | None = Field(default=None, alias="confidenceScore")
    justification: str
    evidence_passages: list[EvidencePassage] = Field(default=[], alias="evidencePassages")
    
    ai_model_used: str = Field(..., alias="aiModelUsed")
    processing_time_ms: int | None = Field(default=None, alias="processingTimeMs")
    prompt_tokens: int | None = Field(default=None, alias="promptTokens")
    completion_tokens: int | None = Field(default=None, alias="completionTokens")
    
    status: str
    created_at: datetime = Field(..., alias="createdAt")
    
    model_config = ConfigDict(populate_by_name=True, from_attributes=True)


class AIAssessmentResponse(BaseModel):
    """Response completa da avaliação AI."""
    
    assessment: AIAssessmentResult
    trace_id: str = Field(..., alias="traceId")
    
    model_config = ConfigDict(populate_by_name=True)


# =================== BATCH ASSESSMENT SCHEMAS ===================


class BatchAIAssessmentRequest(BaseModel):
    """Request para avaliação AI em batch."""
    
    project_id: UUID = Field(..., alias="projectId")
    article_id: UUID = Field(..., alias="articleId")
    instrument_id: UUID = Field(..., alias="instrumentId")
    
    # Avaliar todos os items ou específicos
    item_ids: list[UUID] | None = Field(default=None, alias="itemIds")
    
    # Fonte do PDF
    pdf_storage_key: str | None = Field(default=None, alias="pdfStorageKey")
    
    # Opções
    model: str = Field(default="gpt-4o-mini")
    force_file_search: bool = Field(default=False, alias="forceFileSearch")
    
    model_config = ConfigDict(populate_by_name=True)


class BatchItemResult(BaseModel):
    """Resultado de um item no batch."""
    
    item_id: UUID = Field(..., alias="itemId")
    success: bool
    assessment_id: UUID | None = Field(default=None, alias="assessmentId")
    error: str | None = None
    
    model_config = ConfigDict(populate_by_name=True)


class BatchAIAssessmentResult(BaseModel):
    """Resultado do batch de avaliações."""
    
    trace_id: str = Field(..., alias="traceId")
    total_items: int = Field(..., alias="totalItems")
    successful: int
    failed: int
    results: list[BatchItemResult]
    processing_time_ms: int = Field(..., alias="processingTimeMs")
    
    model_config = ConfigDict(populate_by_name=True)


# =================== INSTRUMENT SCHEMAS ===================


class AssessmentItemSchema(BaseModel):
    """Schema de item de assessment."""
    
    id: UUID
    domain: str
    item_code: str = Field(..., alias="itemCode")
    question: str
    sort_order: int = Field(..., alias="sortOrder")
    required: bool = True
    allowed_levels: list[str] = Field(..., alias="allowedLevels")
    
    model_config = ConfigDict(populate_by_name=True, from_attributes=True)


class AssessmentInstrumentSchema(BaseModel):
    """Schema de instrumento de assessment."""
    
    id: UUID
    tool_type: str = Field(..., alias="toolType")
    name: str
    version: str
    mode: Literal["human", "ai", "hybrid"] = "human"
    is_active: bool = Field(default=True, alias="isActive")
    items: list[AssessmentItemSchema] = []
    
    model_config = ConfigDict(populate_by_name=True, from_attributes=True)


# =================== HUMAN ASSESSMENT SCHEMAS ===================


class ItemResponse(BaseModel):
    """Resposta a um item de assessment."""
    
    item_id: str = Field(..., alias="itemId")
    selected_level: str = Field(..., alias="selectedLevel")
    confidence: int | None = Field(default=None, ge=1, le=5)
    notes: str | None = None
    evidence: list[EvidencePassage] = []
    
    model_config = ConfigDict(populate_by_name=True)


class SaveAssessmentRequest(BaseModel):
    """Request para salvar assessment humano."""
    
    project_id: UUID = Field(..., alias="projectId")
    article_id: UUID = Field(..., alias="articleId")
    instrument_id: UUID = Field(..., alias="instrumentId")
    responses: dict[str, ItemResponse]
    status: Literal["in_progress", "submitted"] = "in_progress"
    private_notes: str | None = Field(default=None, alias="privateNotes")
    
    # Para assessment por instância
    extraction_instance_id: UUID | None = Field(default=None, alias="extractionInstanceId")
    
    model_config = ConfigDict(populate_by_name=True)


class AssessmentResponse(BaseModel):
    """Response de assessment humano."""
    
    id: UUID
    project_id: UUID = Field(..., alias="projectId")
    article_id: UUID = Field(..., alias="articleId")
    user_id: UUID = Field(..., alias="userId")
    instrument_id: UUID | None = Field(default=None, alias="instrumentId")
    tool_type: str = Field(..., alias="toolType")
    
    responses: dict[str, Any]
    overall_assessment: dict[str, Any] | None = Field(default=None, alias="overallAssessment")
    status: str
    completion_percentage: float | None = Field(default=None, alias="completionPercentage")
    
    is_blind: bool = Field(default=False, alias="isBlind")
    version: int = 1
    
    created_at: datetime = Field(..., alias="createdAt")
    updated_at: datetime = Field(..., alias="updatedAt")
    
    model_config = ConfigDict(populate_by_name=True, from_attributes=True)


# =================== REVIEW SCHEMAS ===================


class ReviewAIAssessmentRequest(BaseModel):
    """Request para revisar avaliação de IA."""
    
    status: Literal["accepted", "rejected", "modified"]
    human_response: str | None = Field(default=None, alias="humanResponse")
    notes: str | None = None
    
    model_config = ConfigDict(populate_by_name=True)


# =================== AGGREGATE SCHEMAS ===================


class DomainSummary(BaseModel):
    """Sumário de um domínio de avaliação."""
    
    domain: str
    items_count: int = Field(..., alias="itemsCount")
    completed_count: int = Field(..., alias="completedCount")
    overall_level: str | None = Field(default=None, alias="overallLevel")
    
    model_config = ConfigDict(populate_by_name=True)


class ArticleAssessmentSummary(BaseModel):
    """Sumário de todas as avaliações de um artigo."""
    
    article_id: UUID = Field(..., alias="articleId")
    human_assessments: int = Field(..., alias="humanAssessments")
    ai_assessments: int = Field(..., alias="aiAssessments")
    domains: list[DomainSummary]
    overall_risk_of_bias: str | None = Field(default=None, alias="overallRiskOfBias")
    consensus_reached: bool = Field(default=False, alias="consensusReached")
    
    model_config = ConfigDict(populate_by_name=True)

