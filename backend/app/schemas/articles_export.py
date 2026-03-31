"""
Articles Export Schemas.

Pydantic request/response for exportacao de articles (CSV, RIS, RDF).
"""

from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

# =================== REQUEST ===================


class ExportRequest(BaseModel):
    """Request for iniciar exportacao de articles."""

    project_id: UUID = Field(..., alias="projectId", description="project")
    article_ids: list[UUID] = Field(
        ..., alias="articleIds", description="IDs of the articles a exportar"
    )
    formats: list[str] = Field(..., description="Formatos: csv, ris, rdf (um or mais)")
    file_scope: str = Field(
        ...,
        alias="fileScope",
        description="Escopo de files: none, main_only, all",
    )

    model_config = ConfigDict(populate_by_name=True)


# =================== RESPONSE (JSON) ===================


class SkippedFileEntry(BaseModel):
    """Input for file that cannot be included in the export."""

    article_id: UUID = Field(..., alias="articleId")
    storage_key: str = Field(..., alias="storageKey")
    reason: str = Field(...)

    model_config = ConfigDict(populate_by_name=True)


class ExportProgress(BaseModel):
    """Progresso do export (optional)."""

    current: int = Field(..., description="Item atual")
    total: int = Field(..., description="Total de itens")
    stage: str = Field(..., description="Etapa: metadata, files, etc.")

    model_config = ConfigDict(populate_by_name=True)


class ExportStatusResponse(BaseModel):
    """Response do status do job de export."""

    job_id: str = Field(..., alias="jobId")
    status: str = Field(
        ...,
        description="pending | running | completed | failed | cancelled",
    )
    progress: ExportProgress | None = None
    download_url: str | None = Field(default=None, alias="downloadUrl")
    expires_at: str | None = Field(default=None, alias="expiresAt")
    skipped_files: list[SkippedFileEntry] | None = Field(
        default=None,
        alias="skippedFiles",
    )
    error: str | None = None

    model_config = ConfigDict(populate_by_name=True)


class ExportStartedResponse(BaseModel):
    """Response 202 quando export e enfileirado (async)."""

    job_id: str = Field(..., alias="jobId")
    message: str | None = Field(
        default="Export started. Poll status for download link.",
        alias="message",
    )

    model_config = ConfigDict(populate_by_name=True)


class ExportCancelResponse(BaseModel):
    """Response do cancelamento do job."""

    cancelled: bool = Field(...)
