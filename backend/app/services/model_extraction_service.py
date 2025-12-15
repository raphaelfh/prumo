# Copyright (c) 2025 Raphael Federicci Haddad.
# Licensed under the GNU Affero General Public License v3.0 (AGPLv3).
# Commercial licenses are available upon request.

"""
Model Extraction Service.

Migrado de: supabase/functions/model-extraction/index.ts

Serviço para extração automática de modelos de predição de artigos.
"""

import time
from typing import Any
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession
from supabase import Client

from app.core.logging import LoggerMixin
from app.services.pdf_processor import PDFProcessor
from app.services.openai_service import OpenAIService


class ModelExtractionService(LoggerMixin):
    """
    Service para extração de modelos de predição.
    
    Identifica e cria instâncias de modelos automaticamente.
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
    
    async def extract(
        self,
        project_id: UUID,
        article_id: UUID,
        template_id: UUID,
        model: str = "gpt-4o-mini",
    ) -> dict[str, Any]:
        """
        Extrai modelos de predição de um artigo.
        
        Args:
            project_id: ID do projeto.
            article_id: ID do artigo.
            template_id: ID do template.
            model: Modelo OpenAI a usar.
            
        Returns:
            Dict com run_id e modelos criados.
        """
        import uuid
        
        start_time = time.time()
        run_id = str(uuid.uuid4())
        
        self.logger.info(
            "model_extraction_start",
            trace_id=self.trace_id,
            run_id=run_id,
            article_id=str(article_id),
        )
        
        # 1. Buscar PDF
        pdf_data = await self._get_pdf(article_id)
        
        # 2. Processar texto do PDF
        pdf_text = await self.pdf_processor.extract_text(pdf_data)
        
        # 3. Buscar template e entity types
        template = await self._get_template(template_id)
        
        # 4. Identificar modelos usando LLM
        models = await self._identify_models(pdf_text, template, model)
        
        # 5. Criar instâncias no banco
        created_models = await self._create_model_instances(
            project_id=project_id,
            article_id=article_id,
            template_id=template_id,
            models=models,
            run_id=run_id,
        )
        
        duration = (time.time() - start_time) * 1000
        
        self.logger.info(
            "model_extraction_complete",
            trace_id=self.trace_id,
            run_id=run_id,
            models_count=len(created_models),
            duration_ms=duration,
        )
        
        return {
            "run_id": run_id,
            "models_created": created_models,
            "total_models": len(created_models),
        }
    
    async def _get_pdf(self, article_id: UUID) -> bytes:
        """Busca e faz download do PDF do artigo."""
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
    
    async def _get_template(self, template_id: UUID) -> dict[str, Any]:
        """Busca template com entity types."""
        result = (
            self.supabase.table("extraction_templates")
            .select("*, extraction_entity_types(*)")
            .eq("id", str(template_id))
            .single()
            .execute()
        )
        
        if not result.data:
            raise ValueError(f"Template not found: {template_id}")
        
        return result.data
    
    async def _identify_models(
        self,
        pdf_text: str,
        template: dict[str, Any],
        model: str,
    ) -> list[dict[str, Any]]:
        """
        Usa LLM para identificar modelos no texto do PDF.
        
        Returns:
            Lista de modelos identificados com seus nomes.
        """
        # Buscar entity type "model" no template
        entity_types = template.get("extraction_entity_types", [])
        model_entity = next(
            (et for et in entity_types if et.get("name", "").lower() == "model"),
            None,
        )
        
        if not model_entity:
            self.logger.warning(
                "no_model_entity_type",
                trace_id=self.trace_id,
                template_id=template.get("id"),
            )
            return []
        
        prompt = f"""Analyze the following scientific article text and identify all prediction models described.

For each model found, extract:
1. model_name: A clear, descriptive name for the model
2. model_type: Type of model (e.g., logistic regression, random forest, neural network)
3. target_outcome: What the model predicts

Article text:
{pdf_text[:15000]}  # Limit to avoid token limits

Return a JSON array of models found. If no models are found, return an empty array.
"""
        
        response = await self.openai_service.chat_completion(
            messages=[
                {"role": "system", "content": "You are an expert at identifying prediction models in scientific articles."},
                {"role": "user", "content": prompt},
            ],
            model=model,
            response_format={"type": "json_object"},
        )
        
        import json
        try:
            result = json.loads(response)
            return result.get("models", [])
        except json.JSONDecodeError:
            self.logger.error(
                "model_identification_parse_error",
                trace_id=self.trace_id,
                response=response[:500],
            )
            return []
    
    async def _create_model_instances(
        self,
        project_id: UUID,
        article_id: UUID,
        template_id: UUID,
        models: list[dict[str, Any]],
        run_id: str,
    ) -> list[dict[str, Any]]:
        """
        Cria instâncias de modelos no banco.
        
        Returns:
            Lista de instâncias criadas.
        """
        created = []
        
        for model_data in models:
            instance_data = {
                "project_id": str(project_id),
                "article_id": str(article_id),
                "template_id": str(template_id),
                "name": model_data.get("model_name", "Unknown Model"),
                "data": model_data,
                "ai_run_id": run_id,
                "status": "pending_review",
            }
            
            result = (
                self.supabase.table("extraction_instances")
                .insert(instance_data)
                .execute()
            )
            
            if result.data:
                created.append(result.data[0])
        
        return created

