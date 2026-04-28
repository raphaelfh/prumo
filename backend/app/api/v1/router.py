"""
API v1 Router.

Agrega todas as rotas da API v1.
"""

from fastapi import APIRouter

from app.api.v1.endpoints import (
    articles_export,
    citations,
    extraction_runs,
    hitl_sessions,
    model_extraction,
    project_templates,
    section_extraction,
    user_api_keys,
    zotero_import,
)

api_router = APIRouter()

# Registrar routers of the endpoints
api_router.include_router(
    zotero_import.router,
    prefix="/zotero",
    tags=["Zotero Integration"],
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
    articles_export.router,
    prefix="/articles-export",
    tags=["Articles Export"],
)

api_router.include_router(
    extraction_runs.router,
    prefix="/runs",
    tags=["extraction-runs"],
)

api_router.include_router(
    hitl_sessions.router,
    prefix="/hitl",
    tags=["hitl-sessions"],
)

api_router.include_router(
    project_templates.router,
    prefix="/projects",
    tags=["project-templates"],
)

api_router.include_router(
    citations.router,
    prefix="/articles",
    tags=["citations"],
)
