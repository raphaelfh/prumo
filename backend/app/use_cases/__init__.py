"""
Use Cases (Application Layer).

Casos de uso explícitos que orquestram repositories, services e domain logic.
Implementa CQRS light separando comandos (writes) de queries (reads).
"""

from app.use_cases.assess_article import AssessArticleRequest, AssessArticleUseCase
from app.use_cases.extract_models import ExtractModelsRequest, ExtractModelsUseCase
from app.use_cases.extract_section import ExtractSectionRequest, ExtractSectionUseCase
from app.use_cases.import_zotero import ImportZoteroRequest, ImportZoteroUseCase

__all__ = [
    "AssessArticleUseCase",
    "AssessArticleRequest",
    "ExtractSectionUseCase",
    "ExtractSectionRequest",
    "ImportZoteroUseCase",
    "ImportZoteroRequest",
    "ExtractModelsUseCase",
    "ExtractModelsRequest",
]
