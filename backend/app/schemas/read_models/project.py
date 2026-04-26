"""
Project Read Models.

DTOs otimizados for listagem and detalhes de projects.
"""

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict


class ProjectMemberReadModel(BaseModel):
    """Membro de project for leitura."""

    user_id: UUID
    role: str
    user_name: str | None = None
    user_email: str | None = None
    joined_at: datetime | None = None

    model_config = ConfigDict(from_attributes=True)


class ProjectListReadModel(BaseModel):
    """
    Projeto for listagem.

    Inclui estatisticas agregadas.
    """

    id: UUID
    name: str
    review_title: str | None = None
    description: str | None = None
    status: str = "active"  # active, archived, completed

    # Organizacao
    org_id: UUID
    org_name: str | None = None

    # Contagens (aggregations)
    articles_count: int = 0
    members_count: int = 0
    instruments_count: int = 0
    templates_count: int = 0

    # Progresso
    articles_completed: int = 0
    completion_percentage: float = 0.0

    # Timestamps
    created_at: datetime
    updated_at: datetime | None = None

    model_config = ConfigDict(from_attributes=True)

    @classmethod
    def compute_completion(cls, completed: int, total: int) -> float:
        """Calcula percentual de conclusao."""
        if total == 0:
            return 0.0
        return round((completed / total) * 100, 1)


class ProjectDetailReadModel(BaseModel):
    """
    Projeto with detalhes completos.

    Inclui membros, configuracoes and estatisticas detalhadas.
    """

    id: UUID
    name: str
    review_title: str | None = None
    description: str | None = None
    condition_studied: str | None = None
    eligibility_criteria: str | None = None
    study_design: str | None = None
    status: str = "active"

    # Organizacao
    org_id: UUID
    org_name: str | None = None

    # Criador
    created_by_id: UUID | None = None
    created_by_name: str | None = None

    # Membros (eager loaded)
    members: list[ProjectMemberReadModel] = []

    # Estatisticas de articles
    articles_total: int = 0
    articles_pending: int = 0
    articles_in_progress: int = 0
    articles_completed: int = 0

    # Estatisticas de extractions
    extractions_total: int = 0
    extractions_completed: int = 0
    models_extracted: int = 0

    # Progresso geral
    extraction_progress: float = 0.0
    overall_progress: float = 0.0

    # Configuracoes
    default_instrument_id: UUID | None = None
    default_template_id: UUID | None = None

    # Timestamps
    created_at: datetime
    updated_at: datetime | None = None

    model_config = ConfigDict(from_attributes=True)

    @classmethod
    def compute_overall_progress(
        cls,
        extraction_progress: float,
    ) -> float:
        """Calcula progresso geral como media ponderada."""
        return round(extraction_progress, 1)
