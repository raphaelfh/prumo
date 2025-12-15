# Copyright (c) 2025 Raphael Federicci Haddad.
# Licensed under the GNU Affero General Public License v3.0 (AGPLv3).
# Commercial licenses are available upon request.

"""
FastAPI Application Entry Point.

Este módulo configura a aplicação FastAPI principal com:
- Middleware de CORS
- Rate limiting
- Logging estruturado
- Rotas da API v1
"""

from contextlib import asynccontextmanager
from typing import AsyncGenerator

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded

from app.api.v1.router import api_router
from app.core.config import settings
from app.core.logging import configure_logging
from app.utils.rate_limiter import limiter


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    """
    Gerencia o ciclo de vida da aplicação.
    
    - Startup: Configura logging, conexões de banco, etc.
    - Shutdown: Fecha conexões e limpa recursos.
    """
    # Startup
    configure_logging()
    
    yield
    
    # Shutdown
    # Cleanup de recursos se necessário


def create_app() -> FastAPI:
    """
    Factory function para criar a aplicação FastAPI.
    
    Returns:
        FastAPI: Instância configurada da aplicação.
    """
    app = FastAPI(
        title=settings.PROJECT_NAME,
        description="Backend API para Review Hub - Plataforma de Revisão Sistemática",
        version="0.1.0",
        openapi_url=f"{settings.API_V1_PREFIX}/openapi.json",
        docs_url=f"{settings.API_V1_PREFIX}/docs",
        redoc_url=f"{settings.API_V1_PREFIX}/redoc",
        lifespan=lifespan,
    )
    
    # Rate Limiter
    app.state.limiter = limiter
    app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
    
    # CORS Middleware
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.CORS_ORIGINS,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    
    # API Routes
    app.include_router(api_router, prefix=settings.API_V1_PREFIX)
    
    @app.get("/health", tags=["Health"])
    async def health_check() -> dict[str, str]:
        """Health check endpoint."""
        return {"status": "healthy"}
    
    return app


app = create_app()


if __name__ == "__main__":
    import uvicorn
    
    uvicorn.run(
        "app.main:app",
        host="0.0.0.0",
        port=8000,
        reload=settings.DEBUG,
    )

