"""
API v1 Router.

Agrega todas as rotas da API v1.
"""

from fastapi import APIRouter

from app.api.v1.endpoints import (
    articles_export,
    evaluation_consensus,
    evaluation_review,
    evaluation_runs,
    evaluation_schema_versions,
    model_extraction,
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
    evaluation_runs.router,
    prefix="/evaluation-runs",
    tags=["Unified Evaluation Runs"],
)

api_router.include_router(
    evaluation_review.router,
    prefix="",
    tags=["Unified Evaluation Review"],
)

api_router.include_router(
    evaluation_consensus.router,
    prefix="",
    tags=["Unified Evaluation Consensus"],
)

api_router.include_router(
    evaluation_schema_versions.router,
    prefix="",
    tags=["Unified Evaluation Schema Versions"],
)
