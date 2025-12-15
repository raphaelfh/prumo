# Copyright (c) 2025 Raphael Federicci Haddad.
# Licensed under the GNU Affero General Public License v3.0 (AGPLv3).
# Commercial licenses are available upon request.

"""
API v1 Router.

Agrega todas as rotas da API v1.
"""

from fastapi import APIRouter

from app.api.v1.endpoints import (
    ai_assessment,
    model_extraction,
    section_extraction,
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
    prefix="/assessment",
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

