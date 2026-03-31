"""
Domain Events.

Eventos de dominio for desacoplamento and comunicacao entre componentes.
"""

from app.domain.events.assessment_events import (
    ArticleAssessed,
    AssessmentApproved,
    AssessmentRejected,
)
from app.domain.events.base import DomainEvent, EventBus
from app.domain.events.extraction_events import (
    ExtractionCompleted,
    ModelsExtracted,
    SuggestionAccepted,
)

__all__ = [
    # Base
    "DomainEvent",
    "EventBus",
    # Assessment events
    "ArticleAssessed",
    "AssessmentApproved",
    "AssessmentRejected",
    # Extraction events
    "ExtractionCompleted",
    "ModelsExtracted",
    "SuggestionAccepted",
]
