"""
FastAPI Application Entry Point.

Este módulo configura a aplicação FastAPI principal com:
- Middleware de CORS, Logging e Request ID
- Rate limiting
- Error handling centralizado
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
from app.core.error_handler import register_exception_handlers
from app.core.logging import configure_logging, get_logger
from app.core.middleware import register_middlewares
from app.models import Base  # Importa todos os modelos para garantir que sejam registrados
from app.utils.rate_limiter import limiter

logger = get_logger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    """
    Gerencia o ciclo de vida da aplicação.
    
    - Startup: Configura logging, conexões de banco, etc.
    - Shutdown: Fecha conexões e limpa recursos.
    """
    # Startup
    configure_logging()
    logger.info(
        "application_startup",
        project_name=settings.PROJECT_NAME,
        debug=settings.DEBUG,
    )
    
    yield
    
    # Shutdown
    logger.info("application_shutdown")


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
    
    # Registrar exception handlers customizados
    register_exception_handlers(app)
    
    # CORS Middleware (deve vir antes dos outros middlewares)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins_list,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
        expose_headers=["X-Trace-Id", "X-Response-Time"],
    )
    
    # Registrar middlewares customizados (RequestId, Logging, Timing)
    register_middlewares(app)
    
    # API Routes
    app.include_router(api_router, prefix=settings.API_V1_PREFIX)
    
    @app.get("/health", tags=["Health"])
    async def health_check() -> dict[str, str]:
        """Health check endpoint."""
        return {"status": "healthy", "version": "0.1.0"}
    
    @app.get("/", tags=["Root"])
    async def root() -> dict[str, str]:
        """
        Root endpoint com informações da API.
        Para conseguir acessar o doc, visite {settings.API_V1_PREFIX}/docs, como por exemplo http://localhost:8000/api/v1/docs
        """
        return {
            "name": settings.PROJECT_NAME,
            "version": "0.1.0",
            "docs": f"{settings.API_V1_PREFIX}/docs",
        }
    
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

