"""
Middlewares da Aplicacao.

Inclui:
- RequestIdMiddleware: Adiciona trace_id a todas as requests
- LoggingMiddleware: Log de requests/responses
- TimingMiddleware: Mede duracao of the requests
"""

import time
import uuid
from typing import Any

from fastapi import Request, Response
from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint

from app.core.logging import clear_log_context, get_logger, log_context

logger = get_logger(__name__)


class RequestIdMiddleware(BaseHTTPMiddleware):
    """
    Middleware que adiciona trace_id a todas as requests.

    O trace_id e:
    1. Lido do header X-Trace-Id (se presente)
    2. Generated automatically (if not present)
    3. Adicionado ao response header
    4. Disponivel em request.state.trace_id
    """

    async def dispatch(
        self,
        request: Request,
        call_next: RequestResponseEndpoint,
    ) -> Response:
        # Pegar trace_id do header or gerar novo
        trace_id = request.headers.get("x-trace-id") or str(uuid.uuid4())

        # Adicionar ao state da request
        request.state.trace_id = trace_id

        # Adicionar ao contexto de logging
        log_context(trace_id=trace_id)

        try:
            response = await call_next(request)

            # Adicionar trace_id ao response header
            response.headers["X-Trace-Id"] = trace_id

            return response
        finally:
            # Limpar contexto de logging
            clear_log_context()


class LoggingMiddleware(BaseHTTPMiddleware):
    """
    Middleware for logging de requests and responses.

    Loga:
    - Metodo and path
    - Status code
    - Duracao
    - User agent (truncado)
    """

    # Paths that should not be logged
    EXCLUDED_PATHS = {"/health", "/api/v1/docs", "/api/v1/openapi.json", "/favicon.ico"}

    async def dispatch(
        self,
        request: Request,
        call_next: RequestResponseEndpoint,
    ) -> Response:
        # Skip paths excluidos
        if request.url.path in self.EXCLUDED_PATHS:
            return await call_next(request)

        start_time = time.time()
        trace_id = getattr(request.state, "trace_id", None)

        # Log da request
        logger.info(
            "request_started",
            trace_id=trace_id,
            method=request.method,
            path=request.url.path,
            query=str(request.query_params) if request.query_params else None,
        )

        try:
            response = await call_next(request)
            duration_ms = (time.time() - start_time) * 1000

            # Log do response
            log_level = "info" if response.status_code < 400 else "warning"
            getattr(logger, log_level)(
                "request_completed",
                trace_id=trace_id,
                method=request.method,
                path=request.url.path,
                status_code=response.status_code,
                duration_ms=round(duration_ms, 2),
            )

            return response

        except Exception as e:
            duration_ms = (time.time() - start_time) * 1000

            logger.error(
                "request_failed",
                trace_id=trace_id,
                method=request.method,
                path=request.url.path,
                duration_ms=round(duration_ms, 2),
                error=str(e),
            )
            raise


class TimingMiddleware(BaseHTTPMiddleware):
    """
    Middleware que adiciona header X-Response-Time.

    Util for debugging and monitoramento de performance.
    """

    async def dispatch(
        self,
        request: Request,
        call_next: RequestResponseEndpoint,
    ) -> Response:
        start_time = time.time()

        response = await call_next(request)

        duration_ms = (time.time() - start_time) * 1000
        response.headers["X-Response-Time"] = f"{duration_ms:.2f}ms"

        return response


def register_middlewares(app: Any) -> None:
    """
    Registra todos os middlewares in the aplicacao.

    A ordem importa! Os middlewares sao executados in the ordem inversa
    de registro (ultimo registrado = primeiro executado).

    Args:
        app: Instancia do FastAPI.
    """
    # Ordem de execucao: Timing -> Logging -> RequestId
    app.add_middleware(TimingMiddleware)
    app.add_middleware(LoggingMiddleware)
    app.add_middleware(RequestIdMiddleware)
