"""
Event Handlers.
Handlers to process domain events.
"""

import structlog

from app.domain.events.base import event_bus
from app.domain.events.extraction_events import (
    ExtractionCompleted,
    ModelsExtracted,
    SuggestionAccepted,
)

logger = structlog.get_logger()

# =================== EXTRACTION HANDLERS ===================


@event_bus.subscribe(ExtractionCompleted)
async def on_extraction_completed(event: ExtractionCompleted) -> None:
    """
    Handler when an extraction is completed.
    Actions:
    - Update progress
    - Trigger next extractions
    - Performance log
    """
    logger.info(
        "handler_extraction_completed",
        article_id=str(event.article_id),
        run_id=event.run_id,
        suggestions_created=event.suggestions_created,
        duration_ms=event.duration_ms,
    )

    # TODO: Check if there are more sections to extract
    # TODO: Atualizar progresso do article


@event_bus.subscribe(ModelsExtracted)
async def on_models_extracted(event: ModelsExtracted) -> None:
    """
    Handler when models are extracted.
    Actions:
    - Trigger extraction of child sections
    - Update count
    - Notify user
    """
    logger.info(
        "handler_models_extracted",
        article_id=str(event.article_id),
        models_count=event.models_count,
        child_instances=event.child_instances_count,
        model_names=event.model_names,
    )

    # TODO: Trigger automatic extraction of child sections
    # TODO: Send notification of models found


@event_bus.subscribe(SuggestionAccepted)
async def on_suggestion_accepted(event: SuggestionAccepted) -> None:
    """
    Handler when a suggestion is accepted.
    Actions:
    - Collect feedback for training
    - Update accuracy metrics
    - Audit log
    """
    logger.info(
        "handler_suggestion_accepted",
        suggestion_id=str(event.suggestion_id),
        field_name=event.field_name,
        was_modified=event.was_modified,
    )

    # TODO: Coletar for dataset de fine-tuning
    # TODO: Calculate modification rate per field


def register_handlers() -> None:
    """
    Register all handlers.
    Call at application startup to ensure handlers
    are registered before any event is published.
    """
    # Decorators already register automatically, but this function
    # ensures the module was imported
    logger.info("event_handlers_registered", handler_count=3)
