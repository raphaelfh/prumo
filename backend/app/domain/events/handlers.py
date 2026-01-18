"""
Event Handlers.

Handlers para processar domain events.
"""

import structlog

from app.domain.events.assessment_events import (
    ArticleAssessed,
    AssessmentApproved,
    AssessmentRejected,
)
from app.domain.events.base import event_bus
from app.domain.events.extraction_events import (
    ExtractionCompleted,
    ModelsExtracted,
    SuggestionAccepted,
)

logger = structlog.get_logger()


# =================== ASSESSMENT HANDLERS ===================

@event_bus.subscribe(ArticleAssessed)
async def on_article_assessed(event: ArticleAssessed) -> None:
    """
    Handler para quando um artigo é avaliado.
    
    Actions:
    - Log estruturado
    - Atualizar métricas (futuro)
    - Notificar usuário (futuro)
    """
    logger.info(
        "handler_article_assessed",
        article_id=str(event.article_id),
        assessment_id=str(event.assessment_id),
        selected_level=event.selected_level,
        confidence=event.confidence_score,
    )
    
    # TODO: Atualizar métricas de uso de AI
    # TODO: Enviar notificação se confidence < threshold


@event_bus.subscribe(AssessmentApproved)
async def on_assessment_approved(event: AssessmentApproved) -> None:
    """
    Handler para quando um assessment é aprovado.
    
    Actions:
    - Atualizar status do artigo
    - Atualizar progresso do projeto
    - Log de auditoria
    """
    logger.info(
        "handler_assessment_approved",
        assessment_id=str(event.assessment_id),
        article_id=str(event.article_id),
        reviewer_id=str(event.reviewer_id),
        modifications_made=event.modifications_made,
    )
    
    # TODO: Atualizar contadores de artigos avaliados
    # TODO: Verificar se projeto está completo


@event_bus.subscribe(AssessmentRejected)
async def on_assessment_rejected(event: AssessmentRejected) -> None:
    """
    Handler para quando um assessment é rejeitado.
    
    Actions:
    - Log para análise de qualidade AI
    - Coletar feedback
    - Re-agendar avaliação manual
    """
    logger.warning(
        "handler_assessment_rejected",
        assessment_id=str(event.assessment_id),
        article_id=str(event.article_id),
        reason=event.rejection_reason,
    )
    
    # TODO: Coletar rejeições para análise de qualidade
    # TODO: Disparar re-avaliação se necessário


# =================== EXTRACTION HANDLERS ===================

@event_bus.subscribe(ExtractionCompleted)
async def on_extraction_completed(event: ExtractionCompleted) -> None:
    """
    Handler para quando uma extração é completada.
    
    Actions:
    - Atualizar progresso
    - Disparar próximas extrações
    - Log de performance
    """
    logger.info(
        "handler_extraction_completed",
        article_id=str(event.article_id),
        run_id=event.run_id,
        suggestions_created=event.suggestions_created,
        duration_ms=event.duration_ms,
    )
    
    # TODO: Verificar se há mais seções a extrair
    # TODO: Atualizar progresso do artigo


@event_bus.subscribe(ModelsExtracted)
async def on_models_extracted(event: ModelsExtracted) -> None:
    """
    Handler para quando modelos são extraídos.
    
    Actions:
    - Disparar extração de seções filhas
    - Atualizar contagem
    - Notificar usuário
    """
    logger.info(
        "handler_models_extracted",
        article_id=str(event.article_id),
        models_count=event.models_count,
        child_instances=event.child_instances_count,
        model_names=event.model_names,
    )
    
    # TODO: Disparar extração automática de seções filhas
    # TODO: Enviar notificação de modelos encontrados


@event_bus.subscribe(SuggestionAccepted)
async def on_suggestion_accepted(event: SuggestionAccepted) -> None:
    """
    Handler para quando uma sugestão é aceita.
    
    Actions:
    - Coletar feedback para treinamento
    - Atualizar métricas de acurácia
    - Log de auditoria
    """
    logger.info(
        "handler_suggestion_accepted",
        suggestion_id=str(event.suggestion_id),
        field_name=event.field_name,
        was_modified=event.was_modified,
    )
    
    # TODO: Coletar para dataset de fine-tuning
    # TODO: Calcular taxa de modificação por campo


def register_handlers() -> None:
    """
    Registra todos os handlers.
    
    Chamar no startup da aplicação para garantir que os handlers
    estão registrados antes de qualquer evento ser publicado.
    """
    # Os decorators já registram automaticamente, mas esta função
    # garante que o módulo foi importado
    logger.info("event_handlers_registered", handler_count=6)
