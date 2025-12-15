# Copyright (c) 2025 Raphael Federicci Haddad.
# Licensed under the GNU Affero General Public License v3.0 (AGPLv3).
# Commercial licenses are available upon request.

"""
Section Extraction Service.

Migrado de: supabase/functions/section-extraction/index.ts

Serviço para extração de seções específicas de templates.
"""

import time
from typing import Any
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession
from supabase import Client

from app.core.logging import LoggerMixin
from app.services.pdf_processor import PDFProcessor
from app.services.openai_service import OpenAIService


class SectionExtractionService(LoggerMixin):
    """
    Service para extração de seções de templates.
    
    Suporta extração individual ou em batch.
    """
    
    def __init__(
        self,
        db: AsyncSession,
        user_id: str,
        supabase: Client,
        trace_id: str,
    ):
        self.db = db
        self.user_id = user_id
        self.supabase = supabase
        self.trace_id = trace_id
        self.pdf_processor = PDFProcessor()
        self.openai_service = OpenAIService(trace_id=trace_id)
    
    async def extract_section(
        self,
        project_id: UUID,
        article_id: UUID,
        template_id: UUID,
        entity_type_id: UUID,
        parent_instance_id: UUID | None = None,
        model: str = "gpt-4o-mini",
    ) -> dict[str, Any]:
        """
        Extrai uma seção específica do template.
        
        Args:
            project_id: ID do projeto.
            article_id: ID do artigo.
            template_id: ID do template.
            entity_type_id: ID do entity type a extrair.
            parent_instance_id: ID da instância pai (opcional).
            model: Modelo OpenAI.
            
        Returns:
            Dict com run_id e sugestões criadas.
        """
        import uuid
        
        start_time = time.time()
        run_id = str(uuid.uuid4())
        
        self.logger.info(
            "section_extraction_start",
            trace_id=self.trace_id,
            run_id=run_id,
            entity_type_id=str(entity_type_id),
        )
        
        # 1. Buscar PDF
        pdf_data = await self._get_pdf(article_id)
        
        # 2. Processar texto
        pdf_text = await self.pdf_processor.extract_text(pdf_data)
        
        # 3. Buscar entity type e seus fields
        entity_type = await self._get_entity_type(entity_type_id)
        
        # 4. Construir schema para extração
        extraction_schema = self._build_extraction_schema(entity_type)
        
        # 5. Executar extração com LLM
        extracted_data = await self._extract_with_llm(
            pdf_text=pdf_text,
            entity_type=entity_type,
            schema=extraction_schema,
            model=model,
        )
        
        # 6. Criar sugestões no banco
        suggestions_created = await self._create_suggestions(
            project_id=project_id,
            article_id=article_id,
            entity_type_id=entity_type_id,
            parent_instance_id=parent_instance_id,
            extracted_data=extracted_data,
            run_id=run_id,
        )
        
        duration = (time.time() - start_time) * 1000
        
        self.logger.info(
            "section_extraction_complete",
            trace_id=self.trace_id,
            run_id=run_id,
            suggestions_created=suggestions_created,
            duration_ms=duration,
        )
        
        return {
            "run_id": run_id,
            "suggestions_created": suggestions_created,
            "entity_type_id": str(entity_type_id),
        }
    
    async def extract_all_sections(
        self,
        project_id: UUID,
        article_id: UUID,
        template_id: UUID,
        parent_instance_id: UUID,
        section_ids: list[UUID] | None = None,
        pdf_text: str | None = None,
        model: str = "gpt-4o-mini",
    ) -> dict[str, Any]:
        """
        Extrai todas as seções filhas de um modelo.
        
        Args:
            project_id: ID do projeto.
            article_id: ID do artigo.
            template_id: ID do template.
            parent_instance_id: ID da instância pai.
            section_ids: IDs específicos a extrair (opcional).
            pdf_text: Texto do PDF pré-processado (opcional).
            model: Modelo OpenAI.
            
        Returns:
            Dict com estatísticas da extração em batch.
        """
        import uuid
        
        start_time = time.time()
        run_id = str(uuid.uuid4())
        
        self.logger.info(
            "batch_extraction_start",
            trace_id=self.trace_id,
            run_id=run_id,
            parent_instance_id=str(parent_instance_id),
        )
        
        # 1. Buscar/processar PDF
        if not pdf_text:
            pdf_data = await self._get_pdf(article_id)
            pdf_text = await self.pdf_processor.extract_text(pdf_data)
        
        # 2. Buscar entity types filhos
        child_types = await self._get_child_entity_types(
            template_id=template_id,
            parent_instance_id=parent_instance_id,
            section_ids=section_ids,
        )
        
        # 3. Extrair cada seção
        total_sections = len(child_types)
        successful = 0
        failed = 0
        total_suggestions = 0
        
        for entity_type in child_types:
            try:
                result = await self.extract_section(
                    project_id=project_id,
                    article_id=article_id,
                    template_id=template_id,
                    entity_type_id=UUID(entity_type["id"]),
                    parent_instance_id=parent_instance_id,
                    model=model,
                )
                successful += 1
                total_suggestions += result.get("suggestions_created", 0)
            except Exception as e:
                failed += 1
                self.logger.error(
                    "section_extraction_failed",
                    trace_id=self.trace_id,
                    entity_type_id=entity_type["id"],
                    error=str(e),
                )
        
        duration = (time.time() - start_time) * 1000
        
        self.logger.info(
            "batch_extraction_complete",
            trace_id=self.trace_id,
            run_id=run_id,
            total_sections=total_sections,
            successful=successful,
            failed=failed,
            duration_ms=duration,
        )
        
        return {
            "run_id": run_id,
            "total_sections": total_sections,
            "successful_sections": successful,
            "failed_sections": failed,
            "total_suggestions_created": total_suggestions,
        }
    
    async def _get_pdf(self, article_id: UUID) -> bytes:
        """Busca e faz download do PDF."""
        files_result = (
            self.supabase.table("article_files")
            .select("storage_key")
            .eq("article_id", str(article_id))
            .ilike("file_type", "%pdf%")
            .order("created_at", desc=True)
            .limit(1)
            .execute()
        )
        
        if not files_result.data:
            raise FileNotFoundError(f"PDF not found for article {article_id}")
        
        storage_key = files_result.data[0]["storage_key"]
        response = self.supabase.storage.from_("articles").download(storage_key)
        
        if not response:
            raise FileNotFoundError(f"PDF download failed: {storage_key}")
        
        return bytes(response)
    
    async def _get_entity_type(self, entity_type_id: UUID) -> dict[str, Any]:
        """Busca entity type com seus fields."""
        result = (
            self.supabase.table("extraction_entity_types")
            .select("*, extraction_fields(*)")
            .eq("id", str(entity_type_id))
            .single()
            .execute()
        )
        
        if not result.data:
            raise ValueError(f"Entity type not found: {entity_type_id}")
        
        return result.data
    
    async def _get_child_entity_types(
        self,
        template_id: UUID,
        parent_instance_id: UUID,
        section_ids: list[UUID] | None = None,
    ) -> list[dict[str, Any]]:
        """Busca entity types filhos."""
        query = (
            self.supabase.table("extraction_entity_types")
            .select("*")
            .eq("template_id", str(template_id))
        )
        
        if section_ids:
            query = query.in_("id", [str(s) for s in section_ids])
        
        result = query.execute()
        return result.data or []
    
    def _build_extraction_schema(self, entity_type: dict[str, Any]) -> dict[str, Any]:
        """Constrói schema JSON para extração baseado nos fields."""
        fields = entity_type.get("extraction_fields", [])
        
        properties = {}
        required = []
        
        for field in fields:
            field_name = field.get("name", "").replace(" ", "_").lower()
            field_type = field.get("data_type", "string")
            
            # Mapear tipos
            json_type = "string"
            if field_type in ("number", "integer", "float"):
                json_type = "number"
            elif field_type == "boolean":
                json_type = "boolean"
            elif field_type in ("array", "list"):
                json_type = "array"
            
            properties[field_name] = {
                "type": json_type,
                "description": field.get("description", ""),
            }
            
            if field.get("is_required"):
                required.append(field_name)
        
        return {
            "type": "object",
            "properties": properties,
            "required": required,
        }
    
    async def _extract_with_llm(
        self,
        pdf_text: str,
        entity_type: dict[str, Any],
        schema: dict[str, Any],
        model: str,
    ) -> dict[str, Any]:
        """Executa extração usando LLM."""
        entity_name = entity_type.get("name", "data")
        entity_description = entity_type.get("description", "")
        
        prompt = f"""Extract the following information from the scientific article:

Section: {entity_name}
Description: {entity_description}

Article text:
{pdf_text[:15000]}

Extract the data according to this schema and return as JSON:
{schema}
"""
        
        response = await self.openai_service.chat_completion(
            messages=[
                {"role": "system", "content": "You are an expert at extracting structured data from scientific articles."},
                {"role": "user", "content": prompt},
            ],
            model=model,
            response_format={"type": "json_object"},
        )
        
        import json
        try:
            return json.loads(response)
        except json.JSONDecodeError:
            self.logger.error(
                "extraction_parse_error",
                trace_id=self.trace_id,
                response=response[:500],
            )
            return {}
    
    async def _create_suggestions(
        self,
        project_id: UUID,
        article_id: UUID,
        entity_type_id: UUID,
        parent_instance_id: UUID | None,
        extracted_data: dict[str, Any],
        run_id: str,
    ) -> int:
        """Cria sugestões de extração no banco."""
        count = 0
        
        for field_name, value in extracted_data.items():
            if value is None:
                continue
            
            suggestion_data = {
                "project_id": str(project_id),
                "article_id": str(article_id),
                "entity_type_id": str(entity_type_id),
                "parent_instance_id": str(parent_instance_id) if parent_instance_id else None,
                "field_name": field_name,
                "suggested_value": str(value) if not isinstance(value, str) else value,
                "ai_run_id": run_id,
                "status": "pending",
            }
            
            self.supabase.table("extraction_suggestions").insert(suggestion_data).execute()
            count += 1
        
        return count

