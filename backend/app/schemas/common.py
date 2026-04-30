"""
Common Schemas.

Schemas compartilhados usados em toda a API.
Mantem padrao de resposta consistente with Edge Functions anteriores.

API contract — error semantics
==============================
The API uses a hybrid error model on purpose:

1. **HTTP 4xx (400/401/403/404/422/429)** — surfaced for:
   - Pydantic / FastAPI request validation (auto-generated 422)
   - Authentication / authorization failures (401/403)
   - Routing failures (404)
   - Rate limiting (429)
   - Direct ``raise HTTPException(...)`` calls

2. **HTTP 200 with ``{ok: false, error: {code, message}}``** — surfaced for:
   - Business validation that ran past Pydantic (e.g., empty list rejected by
     custom rule)
   - Domain rules that need a structured error envelope but where 4xx would be
     misleading (e.g., a job state machine refusal)

Frontend clients MUST therefore check both ``response.ok`` (HTTP) and
``body.ok`` (envelope) to determine success. The ``body.error.code`` field is
drawn from :class:`ApiErrorCode`; new codes should be added there before use.

Field naming convention
=======================
All request and response fields use **snake_case** on the wire
(e.g., ``project_id``, ``download_url``). Some legacy schemas keep camelCase
``alias=`` declarations for backward compatibility with the frontend; new
schemas should not introduce new aliases.
"""

from enum import StrEnum
from typing import Any, Generic, TypeVar

from pydantic import BaseModel, Field

T = TypeVar("T")


class ApiErrorCode(StrEnum):
    """
    Canonical set of error codes returned in :class:`ErrorDetail.code`.

    Add new codes here before using them in services so the contract stays
    discoverable. Values are short SCREAMING_SNAKE strings consumed by the
    frontend to drive UX (toasts, retry hints, recovery flows).
    """

    VALIDATION_ERROR = "VALIDATION_ERROR"
    AUTHENTICATION_ERROR = "AUTHENTICATION_ERROR"
    AUTHORIZATION_ERROR = "AUTHORIZATION_ERROR"
    FORBIDDEN = "FORBIDDEN"
    NOT_FOUND = "NOT_FOUND"
    CONFLICT = "CONFLICT"
    RATE_LIMIT_EXCEEDED = "RATE_LIMIT_EXCEEDED"
    SERVICE_UNAVAILABLE = "SERVICE_UNAVAILABLE"
    EXTERNAL_SERVICE_ERROR = "EXTERNAL_SERVICE_ERROR"
    AI_EXTRACTION_ERROR = "AI_EXTRACTION_ERROR"
    PDF_PROCESSING_ERROR = "PDF_PROCESSING_ERROR"
    UNEXPECTED_ERROR = "UNEXPECTED_ERROR"
    HTTP_ERROR = "HTTP_ERROR"


class ErrorDetail(BaseModel):
    """Standardized error details."""

    code: str = Field(..., description="Error code (see ApiErrorCode)")
    message: str = Field(..., description="Error message")
    details: dict[str, Any] | None = Field(
        default=None,
        description="Additional error details",
    )


class ApiResponse(BaseModel, Generic[T]):
    """
    Response padronizado da API.

    Mantem compatibilidade with formato usado nas Edge Functions:
    ``{ ok: boolean, data?: T, error?: { code, message }, trace_id?: string }``

    See module docstring for HTTP-status vs envelope semantics.
    """

    ok: bool = Field(..., description="Indica se a operacao foi bem-sucedida")
    data: T | None = Field(default=None, description="Dados da resposta")
    error: ErrorDetail | None = Field(default=None, description="Error details")
    trace_id: str | None = Field(default=None, description="rastreamento")

    @classmethod
    def success(cls, data: T, trace_id: str | None = None) -> "ApiResponse[T]":
        """Create resposta de sucesso."""
        return cls(ok=True, data=data, trace_id=trace_id)

    @classmethod
    def failure(
        cls,
        code: str,
        message: str,
        details: dict[str, Any] | None = None,
        trace_id: str | None = None,
    ) -> "ApiResponse[None]":
        """Create error response."""
        return cls(
            ok=False,
            error=ErrorDetail(code=code, message=message, details=details),
            trace_id=trace_id,
        )


class PaginatedResponse(BaseModel, Generic[T]):
    """Response paginada for listagens."""

    items: list[T] = Field(..., description="List de itens")
    total: int = Field(..., description="Total de itens disponiveis")
    page: int = Field(..., description="Pagina atual")
    page_size: int = Field(..., description="Tamanho da pagina")
    has_more: bool = Field(..., description="Indica se ha mais paginas")

    @property
    def total_pages(self) -> int:
        """Calcula total de paginas."""
        return (self.total + self.page_size - 1) // self.page_size


class HealthResponse(BaseModel):
    """Response do health check."""

    status: str = Field(default="healthy")
    version: str = Field(default="0.1.0")
