"""
Articles Export Schemas.

Pydantic request/response for exportacao de articles (CSV, RIS, RDF).
"""

from uuid import UUID

from pydantic import BaseModel, Field

# =================== REQUEST ===================


class ExportRequest(BaseModel):
    """Request for iniciar exportacao de articles."""

    project_id: UUID = Field(..., description="project")
    article_ids: list[UUID] = Field(..., description="IDs of the articles a exportar")
    formats: list[str] = Field(..., description="Formatos: csv, ris, rdf (um or mais)")
    file_scope: str = Field(..., description="Escopo de files: none, main_only, all")


# =================== RESPONSE (JSON) ===================


class SkippedFileEntry(BaseModel):
    """Input for file that cannot be included in the export."""

    article_id: UUID
    storage_key: str
    reason: str


class ExportProgress(BaseModel):
    """Progresso do export (optional)."""

    current: int = Field(..., description="Item atual")
    total: int = Field(..., description="Total de itens")
    stage: str = Field(..., description="Etapa: metadata, files, etc.")


class ExportStatusResponse(BaseModel):
    """Response do status do job de export."""

    job_id: str
    status: str = Field(
        ...,
        description="pending | running | completed | failed | cancelled",
    )
    progress: ExportProgress | None = None
    download_url: str | None = None
    expires_at: str | None = None
    skipped_files: list[SkippedFileEntry] | None = None
    error: str | None = None


class ExportStartedResponse(BaseModel):
    """Response 202 quando export e enfileirado (async)."""

    job_id: str
    message: str | None = "Export started. Poll status for download link."


class ExportCancelResponse(BaseModel):
    """Response do cancelamento do job."""

    cancelled: bool
