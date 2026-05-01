"""
Extraction Schemas.

Schemas Pydantic for extraction de data de articles cientificos.
"""

from datetime import datetime
from typing import Annotated, Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator

# =================== COMMON SCHEMAS ===================


class ExtractionOptions(BaseModel):
    """Opcoes de extraction."""

    model: str = Field(default="gpt-4o-mini", description="Modelo OpenAI a usar")
    temperature: float = Field(default=0.1, ge=0, le=2)
    max_tokens: int | None = Field(default=None, ge=100, le=16000)

    model_config = ConfigDict(populate_by_name=True)


class EvidencePassage(BaseModel):
    """Passagem de texto citada como evidencia."""

    text: str = Field(..., description="Texto extraido do documento")
    page_number: int | None = Field(default=None, description="Numero da pagina")
    confidence: float | None = Field(default=None, ge=0, le=1)

    model_config = ConfigDict(populate_by_name=True)


class FieldSuggestion(BaseModel):
    """Sugestao de valor for um field."""

    field_id: UUID = Field(..., alias="fieldId")
    field_name: str = Field(..., alias="fieldName")
    suggested_value: Any = Field(..., alias="suggestedValue")
    confidence_score: float | None = Field(default=None, alias="confidenceScore", ge=0, le=1)
    reasoning: str | None = None
    evidence: list[EvidencePassage] = []

    model_config = ConfigDict(populate_by_name=True)


# =================== SECTION EXTRACTION SCHEMAS ===================


class SectionExtractionRequest(BaseModel):
    """Request for extraction de section."""

    project_id: UUID = Field(..., alias="projectId")
    article_id: UUID = Field(..., alias="articleId")
    template_id: UUID = Field(..., alias="templateId")

    # Para extraction de section unica
    entity_type_id: UUID | None = Field(default=None, alias="entityTypeId")

    # Para extraction em batch de todas as sections
    parent_instance_id: UUID | None = Field(default=None, alias="parentInstanceId")
    extract_all_sections: bool = Field(default=False, alias="extractAllSections")

    # Filtrar sections especificas (para chunking)
    section_ids: list[UUID] | None = Field(default=None, alias="sectionIds")

    # Texto do PDF ja processado (evita reprocessar)
    pdf_text: str | None = Field(default=None, alias="pdfText")

    # Opcoes de extraction
    options: ExtractionOptions | None = None
    model: str | None = Field(
        default="gpt-4o-mini",
        description="Modelo OpenAI a usar",
    )

    # Reuse an existing run instead of creating a new one. Used by the
    # Quality-Assessment surface, which opens a Run via the HITL session
    # service and then fires AI extraction against that same Run (so the
    # session-scoped Run isn't shadowed by a new one).
    run_id: UUID | None = Field(default=None, alias="runId")

    # When False, the service skips the proposal -> review auto-advance
    # at the end. QA needs this off because its publish flow walks the
    # run from PROPOSAL all the way to FINALIZED in one click; an early
    # advance would land the run at REVIEW prematurely and break that.
    auto_advance_to_review: bool = Field(default=True, alias="autoAdvanceToReview")

    # When True, fields whose latest proposal on this Run is `human` are
    # excluded from the LLM call. Lets users re-run AI without losing
    # values they already typed/edited manually.
    skip_fields_with_human_proposals: bool = Field(
        default=False,
        alias="skipFieldsWithHumanProposals",
    )

    model_config = ConfigDict(populate_by_name=True)

    @model_validator(mode="after")
    def validate_extraction_mode(self) -> "SectionExtractionRequest":
        """Valida que os fields corretos estao presentes for cada modo."""
        # QA / pre-opened-run mode: caller passes ``run_id`` and the
        # service iterates every top-level entity_type of that run's
        # template. No parent_instance_id / entity_type_id required.
        if self.run_id is not None:
            return self
        if self.extract_all_sections:
            if not self.parent_instance_id:
                raise ValueError("parentInstanceId is required when extractAllSections is true")
        else:
            if not self.entity_type_id:
                raise ValueError("entityTypeId is required when extractAllSections is false")
        return self


class SingleSectionResult(BaseModel):
    """Resultado de extraction de section unica."""

    extraction_run_id: str = Field(..., alias="extractionRunId")
    suggestions_created: int = Field(..., alias="suggestionsCreated")
    entity_type_id: str = Field(..., alias="entityTypeId")
    tokens_prompt: int = Field(..., alias="tokensPrompt")
    tokens_completion: int = Field(..., alias="tokensCompletion")
    tokens_total: int = Field(..., alias="tokensTotal")
    duration_ms: float = Field(..., alias="durationMs")

    model_config = ConfigDict(populate_by_name=True)


class BatchSectionResult(BaseModel):
    """Resultado de extraction em batch."""

    extraction_run_id: str = Field(..., alias="extractionRunId")
    total_sections: int = Field(..., alias="totalSections")
    successful_sections: int = Field(..., alias="successfulSections")
    failed_sections: int = Field(..., alias="failedSections")
    total_suggestions_created: int = Field(..., alias="totalSuggestionsCreated")
    total_tokens_used: int = Field(..., alias="totalTokensUsed")
    duration_ms: float = Field(..., alias="durationMs")
    sections: list[dict[str, Any]] = Field(default=[], alias="sections")

    model_config = ConfigDict(populate_by_name=True)


# =================== MODEL EXTRACTION SCHEMAS ===================


class CreateModelHierarchyRequest(BaseModel):
    """Request to create one prediction-model hierarchy for an article."""

    project_id: UUID = Field(..., alias="projectId")
    article_id: UUID = Field(..., alias="articleId")
    template_id: UUID = Field(..., alias="templateId")
    model_name: str = Field(..., alias="modelName")
    modelling_method: str | None = Field(default=None, alias="modellingMethod")

    model_config = ConfigDict(populate_by_name=True)


class ModelHierarchyChildResponse(BaseModel):
    """Child instance created under the parent model instance."""

    id: UUID
    entity_type_id: UUID = Field(..., alias="entityTypeId")
    parent_instance_id: UUID = Field(..., alias="parentInstanceId")
    label: str

    model_config = ConfigDict(populate_by_name=True)


class CreateModelHierarchyResponse(BaseModel):
    """Response for one-shot hierarchy creation."""

    model_id: UUID = Field(..., alias="modelId")
    model_label: str = Field(..., alias="modelLabel")
    child_instances: list[ModelHierarchyChildResponse] = Field(alias="childInstances")
    proposal_run_id: UUID | None = Field(default=None, alias="proposalRunId")

    model_config = ConfigDict(populate_by_name=True)


class ModelExtractionRequest(BaseModel):
    """Request for extraction de modelos de predicao."""

    project_id: UUID = Field(..., alias="projectId")
    article_id: UUID = Field(..., alias="articleId")
    template_id: UUID = Field(..., alias="templateId")

    # Opcoes de extraction
    model: str | None = Field(
        default="gpt-4o-mini",
        description="Modelo OpenAI a usar",
    )
    options: ExtractionOptions | None = None

    model_config = ConfigDict(populate_by_name=True)


class IdentifiedModel(BaseModel):
    """Modelo de predicao identificado in the article."""

    model_name: str = Field(..., alias="modelName")
    model_type: str | None = Field(default=None, alias="modelType")
    target_outcome: str | None = Field(default=None, alias="targetOutcome")
    description: str | None = None

    # Metadata adicionais extraidos
    sample_size: int | None = Field(default=None, alias="sampleSize")
    performance_metrics: dict[str, Any] = Field(default={}, alias="performanceMetrics")
    validation_strategy: str | None = Field(default=None, alias="validationStrategy")

    model_config = ConfigDict(populate_by_name=True)


class ModelExtractionResult(BaseModel):
    """Resultado da extraction de modelos."""

    extraction_run_id: str = Field(..., alias="extractionRunId")
    models_created: list[dict[str, Any]] = Field(..., alias="modelsCreated")
    total_models: int = Field(..., alias="totalModels")
    child_instances_created: int = Field(..., alias="childInstancesCreated")
    metadata: dict[str, Any]

    model_config = ConfigDict(populate_by_name=True)


# =================== ENTITY TYPE SCHEMAS ===================


class ExtractionFieldSchema(BaseModel):
    """Schema de field de extraction."""

    id: UUID
    name: str
    label: str
    description: str | None = None
    field_type: str = Field(..., alias="fieldType")
    is_required: bool = Field(default=False, alias="isRequired")
    allowed_values: list[str] | None = Field(default=None, alias="allowedValues")
    unit: str | None = None
    allowed_units: list[str] | None = Field(default=None, alias="allowedUnits")
    llm_description: str | None = Field(default=None, alias="llmDescription")
    sort_order: int = Field(default=0, alias="sortOrder")

    model_config = ConfigDict(populate_by_name=True)


class ExtractionEntityTypeSchema(BaseModel):
    """Schema de tipo de entidade."""

    id: UUID
    name: str
    label: str
    description: str | None = None
    cardinality: Literal["one", "many"]
    is_required: bool = Field(default=False, alias="isRequired")
    sort_order: int = Field(default=0, alias="sortOrder")
    parent_entity_type_id: UUID | None = Field(default=None, alias="parentEntityTypeId")
    fields: list[ExtractionFieldSchema] = []

    model_config = ConfigDict(populate_by_name=True)


class ExtractionTemplateSchema(BaseModel):
    """Schema de template de extraction."""

    id: UUID
    name: str
    description: str | None = None
    framework: Literal["CHARMS", "PICOS", "CUSTOM"]
    version: str
    entity_types: list[ExtractionEntityTypeSchema] = Field(default=[], alias="entityTypes")

    model_config = ConfigDict(populate_by_name=True)


# =================== INSTANCE SCHEMAS ===================


class CreateInstanceRequest(BaseModel):
    """Request for criar instance de extraction."""

    project_id: UUID = Field(..., alias="projectId")
    article_id: UUID = Field(..., alias="articleId")
    template_id: UUID = Field(..., alias="templateId")
    entity_type_id: UUID = Field(..., alias="entityTypeId")
    parent_instance_id: UUID | None = Field(default=None, alias="parentInstanceId")
    label: str
    metadata: dict[str, Any] = {}

    model_config = ConfigDict(populate_by_name=True)


class InstanceResponse(BaseModel):
    """Response de instance de extraction."""

    id: UUID
    project_id: UUID = Field(..., alias="projectId")
    article_id: UUID | None = Field(default=None, alias="articleId")
    template_id: UUID = Field(..., alias="templateId")
    entity_type_id: UUID = Field(..., alias="entityTypeId")
    parent_instance_id: UUID | None = Field(default=None, alias="parentInstanceId")
    label: str
    status: str
    sort_order: int = Field(..., alias="sortOrder")
    created_at: datetime = Field(..., alias="createdAt")
    updated_at: datetime = Field(..., alias="updatedAt")

    model_config = ConfigDict(populate_by_name=True, from_attributes=True)


# =================== VALUE SCHEMAS ===================


class SaveValueRequest(BaseModel):
    """Request for salvar valor extraido."""

    instance_id: UUID = Field(..., alias="instanceId")
    field_id: UUID = Field(..., alias="fieldId")
    value: Any
    source: Literal["human", "ai", "rule"] = "human"
    unit: str | None = None
    evidence: list[EvidencePassage] = []

    model_config = ConfigDict(populate_by_name=True)


class ValueResponse(BaseModel):
    """Response de valor extraido."""

    id: UUID
    instance_id: UUID = Field(..., alias="instanceId")
    field_id: UUID = Field(..., alias="fieldId")
    value: Any
    source: str
    confidence_score: float | None = Field(default=None, alias="confidenceScore")
    unit: str | None = None
    is_consensus: bool = Field(default=False, alias="isConsensus")
    created_at: datetime = Field(..., alias="createdAt")
    updated_at: datetime = Field(..., alias="updatedAt")

    model_config = ConfigDict(populate_by_name=True, from_attributes=True)


# =================== SUGGESTION SCHEMAS ===================


class SuggestionResponse(BaseModel):
    """Response de suggestion de IA for extraction."""

    id: UUID
    extraction_run_id: UUID = Field(..., alias="extractionRunId")
    instance_id: UUID | None = Field(default=None, alias="instanceId")
    field_id: UUID = Field(..., alias="fieldId")
    suggested_value: Any = Field(..., alias="suggestedValue")
    confidence_score: float | None = Field(default=None, alias="confidenceScore")
    reasoning: str | None = None
    status: Literal["pending", "accepted", "rejected"]
    created_at: datetime = Field(..., alias="createdAt")

    model_config = ConfigDict(populate_by_name=True, from_attributes=True)


class ReviewSuggestionRequest(BaseModel):
    """Request for revisar suggestion."""

    status: Literal["accepted", "rejected"]
    modified_value: Any | None = Field(default=None, alias="modifiedValue")

    model_config = ConfigDict(populate_by_name=True)


# =================== CITATION ANCHOR (extraction_evidence.position v1) ===================
#
# Wire format for ``extraction_evidence.position`` JSONB. Mirrors
# ``frontend/pdf-viewer/core/citation.ts`` and ``coordinates.ts`` field-for-
# field, including camelCase JSON keys, so the viewer can read citation
# rows from the API and render them without translation.
#
# Spec: ``docs/superpowers/specs/2026-04-28-pdf-viewer-database-requirements.md``
# (sections 2 + 3).


class PDFRect(BaseModel):
    """Bounding box in PDF user space (origin bottom-left, points).

    Mirrors ``frontend/pdf-viewer/core/coordinates.ts:14-19``.
    """

    x: float
    y: float
    width: float
    height: float

    model_config = ConfigDict(populate_by_name=True)


class PDFTextRange(BaseModel):
    """A range of characters within a single page's text content.

    ``charStart`` / ``charEnd`` are offsets into the page's concatenated
    text — same offsets emitted by the engine's ``getTextContent()``.
    Mirrors ``frontend/pdf-viewer/core/coordinates.ts:26-30``.
    """

    page: int = Field(..., ge=1, description="1-indexed page number")
    char_start: int = Field(..., alias="charStart", ge=0)
    char_end: int = Field(..., alias="charEnd", ge=0)

    model_config = ConfigDict(populate_by_name=True)

    @model_validator(mode="after")
    def _char_range_valid(self) -> "PDFTextRange":
        if self.char_end < self.char_start:
            raise ValueError("charEnd must be >= charStart")
        return self


class TextCitationAnchor(BaseModel):
    """Char-range only — most robust to re-OCR / PDF re-encoding."""

    kind: Literal["text"]
    range: PDFTextRange
    quote: str | None = Field(
        default=None,
        description="Optional canonical text used for highlight matching",
    )

    model_config = ConfigDict(populate_by_name=True)


class RegionCitationAnchor(BaseModel):
    """Bbox only — works for figures, tables, image regions."""

    kind: Literal["region"]
    page: int = Field(..., ge=1, description="1-indexed page the rect is on")
    rect: PDFRect

    model_config = ConfigDict(populate_by_name=True)


class HybridCitationAnchor(BaseModel):
    """Both range and bbox + canonical quote — recommended for AI citations."""

    kind: Literal["hybrid"]
    range: PDFTextRange
    rect: PDFRect
    quote: str

    model_config = ConfigDict(populate_by_name=True)


CitationAnchor = Annotated[
    TextCitationAnchor | RegionCitationAnchor | HybridCitationAnchor,
    Field(discriminator="kind"),
]


class PositionV1(BaseModel):
    """v1 wire format for ``extraction_evidence.position`` JSONB.

    Discriminated on ``anchor.kind``; service-layer writers must populate
    ``extraction_evidence.text_content`` and ``page_number`` to match the
    anchor (see spec §2).
    """

    version: Literal[1]
    anchor: CitationAnchor

    model_config = ConfigDict(populate_by_name=True)


def parse_position(
    raw: dict[str, Any] | None,
) -> PositionV1 | None:
    """Validate a ``extraction_evidence.position`` JSONB payload.

    Accepts ``None`` (legacy rows with no position attached) or a dict in
    the v1 shape. Anything in between raises ``pydantic.ValidationError``
    so callers can surface a clear contract violation.
    """

    if raw is None:
        return None
    return PositionV1.model_validate(raw)
