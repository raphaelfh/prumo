"""
Model Extraction Service.

Migrado de: supabase/functions/model-extraction/index.ts

Serviço para extração automática de modelos de predição de artigos.
Implementa:
- Identificação de modelos via LLM
- Criação automática de hierarquia (modelo + seções filhas)
- Tracking de extraction_runs e tokens
- Repository Pattern com SQLAlchemy
"""

import json
import time
from dataclasses import dataclass
from typing import Any
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.logging import LoggerMixin
from app.infrastructure.storage import StorageAdapter
from app.models.extraction import (
    ExtractionInstance,
    ExtractionInstanceStatus,
    ExtractionRunStage,
)
from app.repositories import (
    ArticleFileRepository,
    ExtractionEntityTypeRepository,
    ExtractionInstanceRepository,
    ExtractionRunRepository,
    ExtractionTemplateRepository,
    GlobalTemplateRepository,
)
from app.services.openai_service import OpenAIService
from app.services.pdf_processor import PDFProcessor
from app.utils.json_parser import extract_models_from_response


@dataclass
class ModelExtractionResult:
    """Resultado de extração de modelos."""

    extraction_run_id: str
    models_created: list[dict[str, Any]]
    total_models: int
    child_instances_created: int
    tokens_prompt: int
    tokens_completion: int
    tokens_total: int
    duration_ms: float


class ModelExtractionService(LoggerMixin):
    """
    Service para extração de modelos de predição.
    
    Identifica e cria instâncias de modelos automaticamente.
    Migrado para usar SQLAlchemy via Repository Pattern.
    Suporta BYOK (Bring Your Own Key) com fallback para key global.
    """
    
    def __init__(
        self,
        db: AsyncSession,
        user_id: str,
        storage: StorageAdapter,
        trace_id: str,
        openai_api_key: str | None = None,
    ):
        """
        Inicializa o service.
        
        Args:
            db: Sessão async do SQLAlchemy.
            user_id: ID do usuário autenticado.
            storage: Adapter de storage.
            trace_id: ID de rastreamento.
            openai_api_key: API key customizada (BYOK). Se None, usa key global.
        """
        self.db = db
        self.user_id = user_id
        self.storage = storage
        self.trace_id = trace_id
        self.pdf_processor = PDFProcessor()
        self.openai_service = OpenAIService(trace_id=trace_id, api_key=openai_api_key)
        
        # Repositories
        self._article_files = ArticleFileRepository(db)
        self._templates = ExtractionTemplateRepository(db)
        self._global_templates = GlobalTemplateRepository(db)
        self._entity_types = ExtractionEntityTypeRepository(db)
        self._instances = ExtractionInstanceRepository(db)
        self._runs = ExtractionRunRepository(db)
    
    async def extract(
        self,
        project_id: UUID,
        article_id: UUID,
        template_id: UUID,
        model: str = "gpt-4o-mini",
    ) -> ModelExtractionResult:
        """
        Extrai modelos de predição de um artigo.
        
        Args:
            project_id: ID do projeto.
            article_id: ID do artigo.
            template_id: ID do template.
            model: Modelo OpenAI a usar.

        Returns:
            ModelExtractionResult com extraction_run_id, modelos e tokens.
        """
        start_time = time.time()
        
        # 1. Criar extraction_run no banco
        run = await self._runs.create_run(
            project_id=project_id,
            article_id=article_id,
            template_id=template_id,
            stage=ExtractionRunStage.DATA_SUGGEST,
            created_by=UUID(self.user_id),
            parameters={
                "model": model,
                "extraction_type": "model_identification",
            },
        )
        
        await self._runs.start_run(run.id)
        
        self.logger.info(
            "model_extraction_start",
            trace_id=self.trace_id,
            run_id=str(run.id),
            article_id=str(article_id),
        )
        
        try:
            # 2. Buscar PDF
            pdf_data = await self._get_pdf(article_id)
            
            # 3. Processar texto do PDF
            pdf_text = await self.pdf_processor.extract_text(pdf_data)
            
            # 4. Buscar template e entity types
            template = await self._get_template(template_id)
            
            # 5. Identificar modelos usando LLM (com tracking de tokens)
            models, llm_response = await self._identify_models(pdf_text, template, model)
            
            # 6. Criar instâncias no banco (modelo + children)
            created_models, total_children = await self._create_model_instances(
                project_id=project_id,
                article_id=article_id,
                template_id=template_id,
                models=models,
                run=run,
            )
            
            duration = (time.time() - start_time) * 1000
            
            # 7. Completar run com resultados
            await self._runs.complete_run(
                run_id=run.id,
                results={
                    "models_count": len(created_models),
                    "children_count": total_children,
                    "models_identified": len(models),
                    "tokens_prompt": llm_response.usage.prompt_tokens,
                    "tokens_completion": llm_response.usage.completion_tokens,
                    "tokens_total": llm_response.usage.total_tokens,
                    "duration_ms": duration,
                },
            )
            
            self.logger.info(
                "model_extraction_complete",
                trace_id=self.trace_id,
                run_id=str(run.id),
                models_count=len(created_models),
                children_count=total_children,
                tokens_total=llm_response.usage.total_tokens,
                duration_ms=duration,
            )
            
            # Formatar modelos criados no formato esperado pelo frontend (camelCase)
            formatted_models = [
                {
                    "instanceId": str(model_instance.id),
                    "modelName": model_instance.label or "Unknown Model",
                    "modellingMethod": (model_instance.metadata_ or {}).get("model_type"),
                }
                for model_instance in created_models
            ]
            
            return ModelExtractionResult(
                extraction_run_id=str(run.id),
                models_created=formatted_models,
                total_models=len(formatted_models),
                child_instances_created=total_children,
                tokens_prompt=llm_response.usage.prompt_tokens,
                tokens_completion=llm_response.usage.completion_tokens,
                tokens_total=llm_response.usage.total_tokens,
                duration_ms=duration,
            )
            
        except Exception as e:
            await self._runs.fail_run(run.id, str(e))
            self.logger.error(
                "model_extraction_failed",
                trace_id=self.trace_id,
                run_id=str(run.id),
                error=str(e),
            )
            raise
    
    async def _get_pdf(self, article_id: UUID) -> bytes:
        """Busca e faz download do PDF do artigo via Storage Adapter."""
        pdf_file = await self._article_files.get_latest_pdf(article_id)
        
        if not pdf_file:
            raise FileNotFoundError(f"PDF not found for article {article_id}")
        
        return await self.storage.download("articles", pdf_file.storage_key)
    
    async def _get_template(self, template_id: UUID) -> Any:
        """
        Busca template com entity types.
        
        Tenta primeiro project_extraction_templates (template de projeto),
        depois extraction_templates_global (template global).
        """
        # Primeiro, tentar template de projeto
        template = await self._templates.get_with_entity_types(template_id)
        
        if template:
            return template
        
        # Se não encontrou, tentar template global
        template = await self._global_templates.get_by_id(template_id)
        
        if template:
            return template
        
        raise ValueError(f"Template not found: {template_id}")
    
    async def _identify_models(
        self,
        pdf_text: str,
        template: Any,
        model: str,
    ) -> tuple[list[dict[str, Any]], Any]:
        """
        Usa LLM para identificar modelos no texto do PDF.
        
        Args:
            pdf_text: Texto extraído do PDF.
            template: Template de extração.
            model: Modelo OpenAI a usar.
            
        Returns:
            Tuple com lista de modelos e resposta OpenAI.
        """
        # Buscar entity type "prediction_models" ou "model" no template
        entity_types = template.entity_types if hasattr(template, 'entity_types') else []
        model_entity = next(
            (et for et in entity_types 
             if et.name.lower() in ("prediction_models", "model", "models")),
            None,
        )
        
        if not model_entity:
            self.logger.warning(
                "no_model_entity_type",
                trace_id=self.trace_id,
                template_id=str(template.id),
                available_entity_types=[et.name for et in entity_types] if entity_types else [],
            )
        
        # Prompt ajustado para retornar objeto JSON (required por response_format)
        prompt = f"""Analyze the following scientific article text and identify all prediction models described.

For each model found, extract:
1. model_name: A clear, descriptive name for the model
2. model_type: Type of model (e.g., logistic regression, random forest, neural network)
3. target_outcome: What the model predicts

Article text:
{pdf_text[:15000]}

Return a JSON object with a "models" key containing an array of models.
Example format:
{{"models": [{{"model_name": "...", "model_type": "...", "target_outcome": "..."}}]}}

If no models are found, return: {{"models": []}}
"""
        
        # Usar chat_completion_full para obter tokens
        response = await self.openai_service.chat_completion_full(
            messages=[
                {
                    "role": "system",
                    "content": "You are an expert at identifying prediction models in scientific articles. Always respond with valid JSON.",
                },
                {"role": "user", "content": prompt},
            ],
            model=model,
            response_format={"type": "json_object"},
        )
        
        # Usa parser robusto que trata múltiplos formatos
        models = extract_models_from_response(response.content, trace_id=self.trace_id)
        
        self.logger.info(
            "models_identified",
            trace_id=self.trace_id,
            models_count=len(models),
            tokens_total=response.usage.total_tokens,
        )
        
        return models, response
    
    async def _get_prediction_models_entity_type_id(
        self,
        template_id: UUID,
    ) -> str | None:
        """
        Busca o entity_type_id para 'prediction_models' no template.
        
        Returns:
            entity_type_id ou None se não encontrar.
        """
        # Tentar primeiro por project_template_id
        entity_type = await self._entity_types.get_by_name(
            "prediction_models", template_id, is_project_template=True
        )
        
        if entity_type:
            return str(entity_type.id)
        
        # Tentar por template_id (templates globais)
        entity_type = await self._entity_types.get_by_name(
            "prediction_models", template_id, is_project_template=False
        )
        
        if entity_type:
            return str(entity_type.id)
        
        return None
    
    async def _get_child_entity_types(
        self,
        parent_entity_type_id: str,
        template_id: UUID,
    ) -> list[Any]:
        """
        Busca entity types filhos de um parent entity type.
        
        Retorna apenas os que têm cardinality='one' (criação automática).
        """
        return await self._entity_types.get_children(
            parent_entity_type_id,
            cardinality="one",
        )
    
    async def _create_child_instances(
        self,
        parent_instance_id: str,
        parent_entity_type_id: str,
        project_id: UUID,
        article_id: UUID,
        template_id: UUID,
        run_id: UUID,
    ) -> int:
        """
        Cria instâncias filhas para um modelo.
        
        Para cada entity_type com parent_entity_type_id apontando para
        prediction_models e cardinality='one', cria uma instância.
        
        Returns:
            Número de child instances criadas.
        """
        child_entity_types = await self._get_child_entity_types(
            parent_entity_type_id, template_id
        )
        
        created_count = 0
        
        for child_et in child_entity_types:
            child_instance = ExtractionInstance(
                project_id=project_id,
                article_id=article_id,
                template_id=template_id,
                entity_type_id=child_et.id,
                parent_instance_id=UUID(parent_instance_id),
                label=child_et.label,
                sort_order=child_et.sort_order or 0,
                metadata_={
                    "auto_created": True,
                    "parent_instance_id": parent_instance_id,
                    "ai_run_id": str(run_id),
                },
                created_by=UUID(self.user_id),
                status=ExtractionInstanceStatus.PENDING.value,
            )
            
            try:
                await self._instances.create(child_instance)
                created_count += 1
                
                self.logger.debug(
                    "child_instance_created",
                    trace_id=self.trace_id,
                    parent_id=parent_instance_id,
                    child_id=str(child_instance.id),
                    entity_type=child_et.name,
                )
            except Exception as e:
                # Log mas não falha - child instances podem ser criadas depois
                self.logger.warning(
                    "child_instance_creation_failed",
                    trace_id=self.trace_id,
                    error=str(e),
                    entity_type=child_et.name,
                )
        
        return created_count
    
    async def _create_model_instances(
        self,
        project_id: UUID,
        article_id: UUID,
        template_id: UUID,
        models: list[dict[str, Any]],
        run: Any,
    ) -> tuple[list[ExtractionInstance], int]:
        """
        Cria instâncias de modelos no banco com hierarquia completa.
        
        Para cada modelo identificado:
        1. Cria a instância do modelo (parent)
        2. Cria automaticamente as child instances (seções com cardinality='one')
        
        Returns:
            Tupla (lista de modelos criados, total de children criados).
        """
        # Buscar entity_type_id para 'prediction_models'
        entity_type_id = await self._get_prediction_models_entity_type_id(template_id)
        
        if not entity_type_id:
            self.logger.warning(
                "no_prediction_models_entity_type",
                trace_id=self.trace_id,
                template_id=str(template_id),
            )
            return [], 0
        
        created: list[ExtractionInstance] = []
        total_children_created = 0
        
        for idx, model_data in enumerate(models):
            # 1. Criar instância do modelo (parent)
            model_instance = ExtractionInstance(
                project_id=project_id,
                article_id=article_id,
                template_id=template_id,
                entity_type_id=UUID(entity_type_id),
                label=model_data.get("model_name", f"Model {idx + 1}"),
                sort_order=idx,
                metadata_={
                    "ai_extracted": True,
                    "ai_run_id": str(run.id),
                    "model_type": model_data.get("model_type"),
                    "target_outcome": model_data.get("target_outcome"),
                    "raw_extraction": model_data,
                },
                created_by=UUID(self.user_id),
                status=ExtractionInstanceStatus.PENDING.value,
            )
            
            try:
                saved_instance = await self._instances.create(model_instance)
                created.append(saved_instance)
                
                self.logger.info(
                    "model_instance_created",
                    trace_id=self.trace_id,
                    instance_id=str(saved_instance.id),
                    label=model_instance.label,
                )
                
                # 2. Criar child instances para este modelo
                children_count = await self._create_child_instances(
                    parent_instance_id=str(saved_instance.id),
                    parent_entity_type_id=entity_type_id,
                    project_id=project_id,
                    article_id=article_id,
                    template_id=template_id,
                    run_id=run.id,
                )
                
                total_children_created += children_count
                
                self.logger.info(
                    "model_hierarchy_created",
                    trace_id=self.trace_id,
                    model_id=str(saved_instance.id),
                    children_created=children_count,
                )
                
            except Exception as e:
                self.logger.error(
                    "model_instance_creation_failed",
                    trace_id=self.trace_id,
                    error=str(e),
                    model_name=model_data.get("model_name"),
                )
        
        self.logger.info(
            "all_hierarchies_created",
            trace_id=self.trace_id,
            models_count=len(created),
            total_children_count=total_children_created,
        )
        
        return created, total_children_created
    
    def to_dict(self, result: ModelExtractionResult) -> dict[str, Any]:
        """
        Converte resultado para dict compatível com resposta do endpoint.
        
        Mantém formato compatível com a Edge Function original.
        """
        return {
            "extractionRunId": result.extraction_run_id,
            "modelsCreated": result.models_created,
            "totalModels": result.total_models,
            "childInstancesCreated": result.child_instances_created,
            "metadata": {
                "duration": int(result.duration_ms),
                "modelsFound": result.total_models,
                "tokensPrompt": result.tokens_prompt,
                "tokensCompletion": result.tokens_completion,
                "tokensTotal": result.tokens_total,
            },
        }
