"""
Assess Article Use Case.

Orquestra avaliação AI de artigos.
"""

from dataclasses import dataclass
from typing import Any
from uuid import UUID

from app.core.logging import LoggerMixin
from app.infrastructure.storage import StorageAdapter
from app.repositories import UnitOfWork
from app.services.openai_service import OpenAIService


@dataclass
class AssessArticleRequest:
    """Request para avaliação de artigo."""
    
    project_id: UUID
    article_id: UUID
    assessment_item_id: UUID
    instrument_id: UUID
    user_id: str
    trace_id: str
    pdf_storage_key: str | None = None
    pdf_base64: str | None = None
    force_file_search: bool = False


@dataclass
class AssessArticleResponse:
    """Response da avaliação de artigo."""
    
    assessment_id: str
    selected_level: str | None
    confidence_score: float | None
    justification: str | None
    status: str
    processing_time_ms: int


class AssessArticleUseCase(LoggerMixin):
    """
    Use case para avaliação AI de artigos.
    
    Orquestra:
    1. Busca de dados via repositories
    2. Download de PDF via storage
    3. Chamada à OpenAI
    4. Persistência do resultado
    """
    
    def __init__(
        self,
        uow: UnitOfWork,
        storage: StorageAdapter,
        openai: OpenAIService,
    ):
        self.uow = uow
        self.storage = storage
        self.openai = openai
    
    async def execute(self, request: AssessArticleRequest) -> AssessArticleResponse:
        """
        Executa avaliação de artigo.
        
        Args:
            request: Dados da requisição.
            
        Returns:
            Response com resultado da avaliação.
        """
        import base64
        import json
        import time
        
        start_time = time.time()
        
        self.logger.info(
            "assess_article_start",
            trace_id=request.trace_id,
            article_id=str(request.article_id),
            item_id=str(request.assessment_item_id),
        )
        
        # 1. Buscar dados via repositories
        article = await self.uow.articles.get_by_id(request.article_id)
        if not article:
            raise ValueError(f"Article not found: {request.article_id}")
        
        item = await self.uow.assessment_items.get_by_id(request.assessment_item_id)
        if not item:
            raise ValueError(f"Assessment item not found: {request.assessment_item_id}")
        
        project_summary = await self.uow.projects.get_summary(request.project_id)
        
        # 2. Obter PDF
        pdf_bytes = await self._get_pdf_bytes(
            request.article_id,
            request.pdf_storage_key,
            request.pdf_base64,
        )
        
        # 3. Preparar prompt
        allowed_levels = item.allowed_levels or []
        if isinstance(allowed_levels, str):
            allowed_levels = json.loads(allowed_levels)
        
        prompt = self._build_prompt(item, project_summary, allowed_levels)
        
        # 4. Chamar OpenAI
        ai_start = time.time()
        
        # Criar data URL para PDF
        pdf_data_url = f"data:application/pdf;base64,{base64.b64encode(pdf_bytes).decode()}"
        
        response_text = await self.openai.assess_with_pdf(
            pdf_data_url=pdf_data_url,
            question=item.question,
            allowed_levels=allowed_levels,
            context=project_summary,
        )
        
        ai_duration = int((time.time() - ai_start) * 1000)
        
        # 5. Parsear resultado
        result = json.loads(response_text)
        
        # 6. Salvar no banco
        from app.models.assessment import AIAssessment
        
        ai_assessment = AIAssessment(
            project_id=request.project_id,
            article_id=request.article_id,
            assessment_item_id=request.assessment_item_id,
            instrument_id=request.instrument_id,
            user_id=UUID(request.user_id),
            selected_level=result.get("selected_level"),
            confidence_score=result.get("confidence_score"),
            justification=result.get("justification"),
            evidence_passages=result.get("evidence_passages"),
            ai_model_used="gpt-4o-mini",
            processing_time_ms=ai_duration,
            status="pending_review",
        )
        
        saved = await self.uow.ai_assessments.create(ai_assessment)
        await self.uow.commit()
        
        total_duration = int((time.time() - start_time) * 1000)
        
        self.logger.info(
            "assess_article_complete",
            trace_id=request.trace_id,
            assessment_id=str(saved.id),
            duration_ms=total_duration,
        )
        
        return AssessArticleResponse(
            assessment_id=str(saved.id),
            selected_level=saved.selected_level,
            confidence_score=saved.confidence_score,
            justification=saved.justification,
            status=saved.status,
            processing_time_ms=ai_duration,
        )
    
    async def _get_pdf_bytes(
        self,
        article_id: UUID,
        storage_key: str | None,
        pdf_base64: str | None,
    ) -> bytes:
        """Obtém bytes do PDF."""
        import base64
        
        if pdf_base64:
            return base64.b64decode(pdf_base64)
        
        if storage_key:
            return await self.storage.download("articles", storage_key)
        
        # Buscar do banco
        pdf_file = await self.uow.article_files.get_latest_pdf(article_id)
        if not pdf_file:
            raise FileNotFoundError(f"PDF not found for article {article_id}")
        
        return await self.storage.download("articles", pdf_file.storage_key)
    
    def _build_prompt(
        self,
        item: Any,
        project: dict[str, Any],
        allowed_levels: list[str],
    ) -> str:
        """Constrói prompt para avaliação."""
        levels_str = ", ".join(allowed_levels) if allowed_levels else "N/A"
        
        return f"""Assess: {item.question}

Available levels: {levels_str}

Context:
- Review: {project.get('review_title', '')}
- Condition: {project.get('condition_studied', '')}
"""
