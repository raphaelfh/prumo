"""
Extract Section Use Case.

Orquestra extração de seções de templates.
"""

import json
import time
import uuid
from dataclasses import dataclass
from typing import Any
from uuid import UUID

from app.core.logging import LoggerMixin
from app.infrastructure.storage import StorageAdapter
from app.models.extraction import AISuggestion
from app.repositories import UnitOfWork
from app.services.openai_service import OpenAIService
from app.services.pdf_processor import PDFProcessor


@dataclass
class ExtractSectionRequest:
    """Request para extração de seção."""
    
    project_id: UUID
    article_id: UUID
    template_id: UUID
    entity_type_id: UUID
    user_id: str
    trace_id: str
    parent_instance_id: UUID | None = None
    model: str = "gpt-4o-mini"


@dataclass
class ExtractSectionResponse:
    """Response da extração de seção."""
    
    run_id: str
    suggestions_created: int
    entity_type_id: str
    duration_ms: int


class ExtractSectionUseCase(LoggerMixin):
    """
    Use case para extração de seções.
    
    Orquestra:
    1. Busca de PDF e entity type
    2. Processamento de texto
    3. Extração via LLM
    4. Criação de sugestões
    """
    
    def __init__(
        self,
        uow: UnitOfWork,
        storage: StorageAdapter,
        openai: OpenAIService,
        pdf_processor: PDFProcessor,
    ):
        self.uow = uow
        self.storage = storage
        self.openai = openai
        self.pdf_processor = pdf_processor
    
    async def execute(self, request: ExtractSectionRequest) -> ExtractSectionResponse:
        """
        Executa extração de seção.
        
        Args:
            request: Dados da requisição.
            
        Returns:
            Response com resultado da extração.
        """
        start_time = time.time()
        run_id = str(uuid.uuid4())
        
        self.logger.info(
            "extract_section_start",
            trace_id=request.trace_id,
            run_id=run_id,
            entity_type_id=str(request.entity_type_id),
        )
        
        # 1. Buscar PDF
        pdf_bytes = await self._get_pdf_bytes(request.article_id)
        
        # 2. Processar texto
        pdf_text = await self.pdf_processor.extract_text(pdf_bytes)
        
        # 3. Buscar entity type com fields
        entity_type = await self.uow.entity_types.get_with_fields(request.entity_type_id)
        if not entity_type:
            raise ValueError(f"Entity type not found: {request.entity_type_id}")
        
        # 4. Construir schema
        schema = self._build_schema(entity_type)
        
        # 5. Extrair com LLM
        extracted_data = await self._extract_with_llm(
            pdf_text=pdf_text,
            entity_type=entity_type,
            schema=schema,
            model=request.model,
        )
        
        # 6. Criar sugestões
        suggestions_count = await self._create_suggestions(
            request=request,
            extracted_data=extracted_data,
            run_id=run_id,
        )
        
        await self.uow.commit()
        
        duration = int((time.time() - start_time) * 1000)
        
        self.logger.info(
            "extract_section_complete",
            trace_id=request.trace_id,
            run_id=run_id,
            suggestions=suggestions_count,
            duration_ms=duration,
        )
        
        return ExtractSectionResponse(
            run_id=run_id,
            suggestions_created=suggestions_count,
            entity_type_id=str(request.entity_type_id),
            duration_ms=duration,
        )
    
    async def _get_pdf_bytes(self, article_id: UUID) -> bytes:
        """Obtém bytes do PDF."""
        pdf_file = await self.uow.article_files.get_latest_pdf(article_id)
        if not pdf_file:
            raise FileNotFoundError(f"PDF not found for article {article_id}")
        
        return await self.storage.download("articles", pdf_file.storage_key)
    
    def _build_schema(self, entity_type: Any) -> dict[str, Any]:
        """Constrói schema JSON para extração."""
        fields = entity_type.fields if hasattr(entity_type, 'fields') else []
        
        properties = {}
        required = []
        
        for field in fields:
            field_name = field.name.replace(" ", "_").lower()
            
            json_type = "string"
            if field.data_type in ("number", "integer", "float"):
                json_type = "number"
            elif field.data_type == "boolean":
                json_type = "boolean"
            elif field.data_type in ("array", "list"):
                json_type = "array"
            
            properties[field_name] = {
                "type": json_type,
                "description": field.description or "",
            }
            
            if field.is_required:
                required.append(field_name)
        
        return {
            "type": "object",
            "properties": properties,
            "required": required,
        }
    
    async def _extract_with_llm(
        self,
        pdf_text: str,
        entity_type: Any,
        schema: dict[str, Any],
        model: str,
    ) -> dict[str, Any]:
        """Executa extração usando LLM."""
        prompt = f"""Extract information from this scientific article:

Section: {entity_type.name}
Description: {entity_type.description or ''}

Text (truncated):
{pdf_text[:15000]}

Schema: {json.dumps(schema)}

Return JSON matching the schema.
"""
        
        response = await self.openai.chat_completion(
            messages=[
                {"role": "system", "content": "Extract structured data from scientific articles."},
                {"role": "user", "content": prompt},
            ],
            model=model,
            response_format={"type": "json_object"},
        )
        
        try:
            return json.loads(response)
        except json.JSONDecodeError:
            self.logger.error("extraction_parse_error", response=response[:500])
            return {}
    
    async def _create_suggestions(
        self,
        request: ExtractSectionRequest,
        extracted_data: dict[str, Any],
        run_id: str,
    ) -> int:
        """Cria sugestões no banco."""
        # Buscar instância existente
        instances = await self.uow.extraction_instances.get_by_article(
            request.article_id,
            request.entity_type_id,
        )
        
        if not instances:
            self.logger.warning(
                "no_instance_for_suggestions",
                article_id=str(request.article_id),
            )
            return 0
        
        instance = instances[0]
        count = 0
        
        for field_name, value in extracted_data.items():
            if value is None:
                continue
            
            suggestion = AISuggestion(
                instance_id=instance.id,
                field_name=field_name,
                suggested_value=str(value),
                ai_run_id=run_id,
                status="pending",
            )
            
            await self.uow.ai_suggestions.create(suggestion)
            count += 1
        
        return count
