"""
API v1 Router.

Agrega todas as rotas da API v1.
"""

from fastapi import APIRouter

from app.api.v1.endpoints import (
    ai_assessment,
    article_import,
    articles_export,
    model_extraction,
    project_assessment_instruments,
    screening,
    section_extraction,
    user_api_keys,
    zotero_import,
)

api_router = APIRouter()

# Registrar routers dos endpoints
api_router.include_router(
    zotero_import.router,
    prefix="/zotero",
    tags=["Zotero Integration"],
)

api_router.include_router(
    ai_assessment.router,
    prefix="/ai-assessment",
    tags=["AI Assessment"],
)

api_router.include_router(
    model_extraction.router,
    prefix="/extraction/models",
    tags=["Model Extraction"],
)

api_router.include_router(
    section_extraction.router,
    prefix="/extraction/sections",
    tags=["Section Extraction"],
)

api_router.include_router(
    user_api_keys.router,
    prefix="/user-api-keys",
    tags=["User API Keys"],
)

api_router.include_router(
    project_assessment_instruments.router,
    prefix="/assessment-instruments",
    tags=["Project Assessment Instruments"],
)

api_router.include_router(
    articles_export.router,
    prefix="/articles-export",
    tags=["Articles Export"],
)

api_router.include_router(
    article_import.router,
    prefix="/article-import",
    tags=["Article Import"],
)

api_router.include_router(
    screening.router,
    prefix="/screening",
    tags=["Screening"],
)
