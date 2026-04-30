"""
Article Read Models.

DTOs otimizados for listagem and detalhes de articles.
"""

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict


class ArticleFileReadModel(BaseModel):
    """Arquivo de article for leitura."""

    id: UUID
    file_type: str
    storage_key: str
    size_bytes: int | None = None

    model_config = ConfigDict(from_attributes=True)


class ArticleListReadModel(BaseModel):
    """
    Artigo for listagem.

    Inclui data desnormalizados for evitar N+1 queries.
    """

    id: UUID
    title: str
    authors: str | None = None
    publication_year: int | None = None

    # Dados do project (JOIN)
    project_id: UUID
    project_name: str | None = None

    # Contagens (aggregations)
    files_count: int = 0
    extractions_count: int = 0

    # Status computado
    has_pdf: bool = False

    # Timestamps
    created_at: datetime
    updated_at: datetime | None = None

    model_config = ConfigDict(from_attributes=True)


class ArticleDetailReadModel(BaseModel):
    """
    Artigo with detalhes completos.

    Inclui files and extractions.
    """

    id: UUID
    title: str
    authors: str | None = None
    publication_year: int | None = None
    abstract: str | None = None
    doi: str | None = None
    journal: str | None = None
    volume: str | None = None
    issue: str | None = None
    pages: str | None = None

    # Dados do project
    project_id: UUID
    project_name: str | None = None
    review_title: str | None = None

    # Arquivos (eager loaded)
    files: list[ArticleFileReadModel] = []

    # Resumo de extractions
    extractions_total: int = 0
    extractions_completed: int = 0
    models_extracted: int = 0

    # Status computados
    has_pdf: bool = False
    extraction_progress: float = 0.0  # 0-100%
    overall_status: str = "pending"  # pending, in_progress, completed

    # Metadata
    zotero_key: str | None = None
    created_at: datetime
    updated_at: datetime | None = None

    model_config = ConfigDict(from_attributes=True)

    @classmethod
    def compute_progress(cls, completed: int, total: int) -> float:
        """Calcula progresso percentual."""
        if total == 0:
            return 0.0
        return round((completed / total) * 100, 1)

    @classmethod
    def compute_overall_status(
        cls,
        extraction_progress: float,
    ) -> str:
        """Computa status geral do article."""
        if extraction_progress == 0:
            return "pending"
        if extraction_progress >= 100:
            return "completed"
        return "in_progress"
