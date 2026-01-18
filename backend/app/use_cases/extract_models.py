"""
Extract Models Use Case.

Orquestra extração automática de modelos de predição.
"""

import json
import time
import uuid
from dataclasses import dataclass, field
from typing import Any
from uuid import UUID

from app.core.logging import LoggerMixin
from app.infrastructure.storage import StorageAdapter
from app.models.extraction import ExtractionInstance, ExtractionInstanceStatus
from app.repositories import UnitOfWork
from app.services.openai_service import OpenAIService
from app.services.pdf_processor import PDFProcessor


@dataclass
class ExtractModelsRequest:
    """Request para extração de modelos."""
    
    project_id: UUID
    article_id: UUID
    template_id: UUID
    user_id: str
    trace_id: str
    model: str = "gpt-4o-mini"


@dataclass
class ExtractedModel:
    """Modelo extraído."""
    
    instance_id: str
    model_name: str
    model_type: str | None = None
    target_outcome: str | None = None


@dataclass
class ExtractModelsResponse:
    """Response da extração de modelos."""
    
    run_id: str
    models_created: list[ExtractedModel] = field(default_factory=list)
    total_models: int = 0
    child_instances_created: int = 0
    duration_ms: int = 0


class ExtractModelsUseCase(LoggerMixin):
    """
    Use case para extração de modelos de predição.
    
    Orquestra:
    1. Busca de PDF e template
    2. Identificação de modelos via LLM
    3. Criação de instâncias de modelos
    4. Criação de child instances
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
    
    async def execute(self, request: ExtractModelsRequest) -> ExtractModelsResponse:
        """
        Executa extração de modelos.
        
        Args:
            request: Dados da requisição.
            
        Returns:
            Response com modelos extraídos.
        """
        start_time = time.time()
        run_id = str(uuid.uuid4())
        
        self.logger.info(
            "extract_models_start",
            trace_id=request.trace_id,
            run_id=run_id,
            article_id=str(request.article_id),
        )
        
        # 1. Buscar PDF
        pdf_bytes = await self._get_pdf_bytes(request.article_id)
        
        # 2. Processar texto
        pdf_text = await self.pdf_processor.extract_text(pdf_bytes)
        
        # 3. Identificar modelos
        models_data = await self._identify_models(
            pdf_text=pdf_text,
            model=request.model,
        )
        
        # 4. Criar instâncias
        created_models, child_count = await self._create_instances(
            request=request,
            models_data=models_data,
            run_id=run_id,
        )
        
        await self.uow.commit()
        
        duration = int((time.time() - start_time) * 1000)
        
        self.logger.info(
            "extract_models_complete",
            trace_id=request.trace_id,
            run_id=run_id,
            models_count=len(created_models),
            children_count=child_count,
            duration_ms=duration,
        )
        
        return ExtractModelsResponse(
            run_id=run_id,
            models_created=created_models,
            total_models=len(created_models),
            child_instances_created=child_count,
            duration_ms=duration,
        )
    
    async def _get_pdf_bytes(self, article_id: UUID) -> bytes:
        """Obtém bytes do PDF."""
        pdf_file = await self.uow.article_files.get_latest_pdf(article_id)
        if not pdf_file:
            raise FileNotFoundError(f"PDF not found for article {article_id}")
        
        return await self.storage.download("articles", pdf_file.storage_key)
    
    async def _identify_models(
        self,
        pdf_text: str,
        model: str,
    ) -> list[dict[str, Any]]:
        """Identifica modelos no texto usando LLM."""
        prompt = """Analyze this scientific article and identify all prediction models.

For each model, extract:
1. model_name: Clear, descriptive name
2. model_type: Type (logistic regression, random forest, etc.)
3. target_outcome: What it predicts

Text (truncated):
""" + pdf_text[:15000] + """

Return JSON: {"models": [...]}
If no models found, return {"models": []}
"""
        
        response = await self.openai.chat_completion(
            messages=[
                {"role": "system", "content": "Expert at identifying prediction models in scientific articles."},
                {"role": "user", "content": prompt},
            ],
            model=model,
            response_format={"type": "json_object"},
        )
        
        try:
            result = json.loads(response)
            return result.get("models", [])
        except json.JSONDecodeError:
            self.logger.error("model_parse_error", response=response[:500])
            return []
    
    async def _create_instances(
        self,
        request: ExtractModelsRequest,
        models_data: list[dict[str, Any]],
        run_id: str,
    ) -> tuple[list[ExtractedModel], int]:
        """Cria instâncias de modelos e children."""
        # Buscar entity_type_id para prediction_models
        entity_type = await self.uow.entity_types.get_by_name(
            "prediction_models",
            request.template_id,
            is_project_template=True,
        )
        
        if not entity_type:
            entity_type = await self.uow.entity_types.get_by_name(
                "prediction_models",
                request.template_id,
                is_project_template=False,
            )
        
        if not entity_type:
            self.logger.warning("no_prediction_models_entity_type")
            return [], 0
        
        created: list[ExtractedModel] = []
        total_children = 0
        
        for idx, model_data in enumerate(models_data):
            # Criar instância do modelo
            instance = ExtractionInstance(
                project_id=request.project_id,
                article_id=request.article_id,
                template_id=request.template_id,
                entity_type_id=entity_type.id,
                label=model_data.get("model_name", f"Model {idx + 1}"),
                sort_order=idx,
                metadata={
                    "ai_extracted": True,
                    "ai_run_id": run_id,
                    "model_type": model_data.get("model_type"),
                    "target_outcome": model_data.get("target_outcome"),
                },
                created_by=UUID(request.user_id),
                status=ExtractionInstanceStatus.PENDING.value,
            )
            
            saved = await self.uow.extraction_instances.create(instance)
            
            # Criar children
            child_count = await self._create_children(
                parent_instance_id=saved.id,
                parent_entity_type_id=entity_type.id,
                request=request,
            )
            
            total_children += child_count
            
            created.append(ExtractedModel(
                instance_id=str(saved.id),
                model_name=instance.label,
                model_type=model_data.get("model_type"),
                target_outcome=model_data.get("target_outcome"),
            ))
        
        return created, total_children
    
    async def _create_children(
        self,
        parent_instance_id: UUID,
        parent_entity_type_id: UUID,
        request: ExtractModelsRequest,
    ) -> int:
        """Cria instâncias filhas."""
        child_types = await self.uow.entity_types.get_children(
            str(parent_entity_type_id),
            cardinality="one",
        )
        
        count = 0
        
        for child_type in child_types:
            child = ExtractionInstance(
                project_id=request.project_id,
                article_id=request.article_id,
                template_id=request.template_id,
                entity_type_id=child_type.id,
                parent_instance_id=parent_instance_id,
                label=child_type.label,
                sort_order=child_type.sort_order or 0,
                metadata={"auto_created": True},
                created_by=UUID(request.user_id),
                status=ExtractionInstanceStatus.PENDING.value,
            )
            
            await self.uow.extraction_instances.create(child)
            count += 1
        
        return count
