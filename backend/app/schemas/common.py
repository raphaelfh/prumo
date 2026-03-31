"""
Common Schemas.

Schemas compartilhados usados em toda a API.
Mantem padrao de resposta consistente with Edge Functions anteriores.
"""

from typing import Any, Generic, TypeVar

from pydantic import BaseModel, Field

T = TypeVar("T")


class ErrorDetail(BaseModel):
    """Standardized error details."""

    code: str = Field(..., description="Error code")
    message: str = Field(..., description="Error message")
    details: dict[str, Any] | None = Field(
        default=None,
        description="Additional error details",
    )


class ApiResponse(BaseModel, Generic[T]):
    """
    Response padronizado da API.

    Mantem compatibilidade with formato usado nas Edge Functions:
    { ok: boolean, data?: T, error?: { code, message } }
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
