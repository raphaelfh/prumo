"""
Assessment Tasks.

Tasks Celery para processamento de assessments.
"""

import asyncio
from typing import Any
from uuid import UUID

from app.worker.celery_app import celery_app


@celery_app.task(
    bind=True,
    max_retries=3,
    default_retry_delay=60,
    rate_limit="5/m",
)
def assess_article_task(
    self,
    project_id: str,
    article_id: str,
    assessment_item_id: str,
    instrument_id: str,
    user_id: str,
) -> dict[str, Any]:
    """
    Task para avaliação AI de um artigo.
    
    Args:
        project_id: ID do projeto.
        article_id: ID do artigo.
        assessment_item_id: ID do item de assessment.
        instrument_id: ID do instrumento.
        user_id: ID do usuário.
        
    Returns:
        Dict com resultado do assessment.
    """
    from app.core.database import async_session_maker
    from app.infrastructure.storage import SupabaseStorageAdapter
    from app.repositories import UnitOfWork
    from app.services.openai_service import OpenAIService
    from app.use_cases import AssessArticleRequest, AssessArticleUseCase
    
    async def run():
        async with async_session_maker() as session:
            # Criar dependências
            # Note: Supabase client precisa ser criado aqui
            from supabase import create_client
            from app.core.config import settings
            
            supabase = create_client(settings.SUPABASE_URL, settings.SUPABASE_SERVICE_ROLE_KEY)
            storage = SupabaseStorageAdapter(supabase)
            openai = OpenAIService(trace_id=self.request.id)
            uow = UnitOfWork(session)
            
            use_case = AssessArticleUseCase(
                uow=uow,
                storage=storage,
                openai=openai,
            )
            
            request = AssessArticleRequest(
                project_id=UUID(project_id),
                article_id=UUID(article_id),
                assessment_item_id=UUID(assessment_item_id),
                instrument_id=UUID(instrument_id),
                user_id=user_id,
                trace_id=self.request.id,
            )
            
            result = await use_case.execute(request)
            
            return {
                "assessment_id": result.assessment_id,
                "selected_level": result.selected_level,
                "confidence_score": result.confidence_score,
                "status": result.status,
            }
    
    try:
        return asyncio.run(run())
    except Exception as exc:
        self.retry(exc=exc)


@celery_app.task(
    bind=True,
    max_retries=2,
    default_retry_delay=120,
    rate_limit="2/m",
)
def batch_assess_task(
    self,
    project_id: str,
    article_ids: list[str],
    instrument_id: str,
    user_id: str,
) -> dict[str, Any]:
    """
    Task para avaliação em batch de múltiplos artigos.
    
    Args:
        project_id: ID do projeto.
        article_ids: Lista de IDs de artigos.
        instrument_id: ID do instrumento.
        user_id: ID do usuário.
        
    Returns:
        Dict com estatísticas do batch.
    """
    results = {
        "total": len(article_ids),
        "completed": 0,
        "failed": 0,
        "results": [],
    }
    
    for article_id in article_ids:
        try:
            # Disparar subtask para cada artigo
            task = assess_article_task.delay(
                project_id=project_id,
                article_id=article_id,
                assessment_item_id="",  # Seria obtido do instrumento
                instrument_id=instrument_id,
                user_id=user_id,
            )
            
            results["results"].append({
                "article_id": article_id,
                "task_id": task.id,
                "status": "queued",
            })
            results["completed"] += 1
            
        except Exception as e:
            results["failed"] += 1
            results["results"].append({
                "article_id": article_id,
                "status": "failed",
                "error": str(e),
            })
    
    return results
