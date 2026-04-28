"""
SQLAlchemy Models.

Exporta todos os modelos for facilitar importacao e
garantir que o Alembic detecte todas as tabelas.

IMPORTANTE: A ordem de importacao importa!
- Modelos base primeiro (Base, BaseModel)
- Modelos sem dependencias (User, Project)
- Modelos que dependem de outros (Article, Extraction, etc.)
"""

# Base models primeiro
# Modelos que dependem of the anteriores
from app.models.article import Article, ArticleFile, FileRole
from app.models.article_author import (
    ArticleAuthor,
    ArticleAuthorLink,
    ArticleSyncEvent,
    ArticleSyncRun,
)
from app.models.base import Base, BaseModel, TimestampMixin, UUIDMixin
from app.models.extraction import (
    ExtractionCardinality,
    ExtractionEntityType,
    ExtractionEvidence,
    ExtractionField,
    ExtractionFieldType,
    ExtractionFramework,
    ExtractionInstance,
    ExtractionRun,
    ExtractionRunStage,
    ExtractionRunStatus,
    ExtractionTemplateGlobal,
    ProjectExtractionTemplate,
)
from app.models.extraction_versioning import (
    ConsensusRule,
    ExtractionHitlConfig,
    ExtractionTemplateVersion,
    HitlConfigScopeKind,
    TemplateKind,
)
from app.models.extraction_workflow import (
    ExtractionConsensusDecision,
    ExtractionConsensusMode,
    ExtractionProposalRecord,
    ExtractionProposalSource,
    ExtractionPublishedState,
    ExtractionReviewerDecision,
    ExtractionReviewerDecisionType,
    ExtractionReviewerState,
)
from app.models.integration import ZoteroIntegration
from app.models.project import Project, ProjectMember, ProjectMemberRole, ReviewType

# Modelos sem dependencias (ou with dependencias minimas)
from app.models.user import Profile
from app.models.user_api_key import SUPPORTED_PROVIDERS, UserAPIKey


# Forca o registro de todas as tabelas in the metadata
# Isso garante que todas as foreign keys sejam resolvidas corretamente
def _prepare_metadata() -> None:
    """
    Prepara o metadata do SQLAlchemy registrando todas as tabelas.

    Isso garante que todas as foreign keys sejam resolvidas corretamente,
    mesmo quando ha dependencias circulares entre modelos.

    A estrategia e forcar o processamento de cada modelo in the ordem correta
    acessando seus atributos de tabela, garantindo que todas as foreign keys
    sejam resolvidas antes de processar modelos dependentes.
    """
    # Forcar o processamento de cada modelo in the ordem de dependencia
    # Isso garante que as tabelas sejam registradas antes de serem referenciadas

    # 1. Profile primeiro (sem dependencias)
    _ = Profile.__table__  # type: ignore[union-attr]

    # 2. Project (depende de Profile)
    _ = Project.__table__  # type: ignore[union-attr]
    _ = ProjectMember.__table__  # type: ignore[union-attr]

    # 3. Article (depende de Project)
    _ = Article.__table__  # type: ignore[union-attr]
    _ = ArticleFile.__table__  # type: ignore[union-attr]
    _ = ArticleAuthor.__table__  # type: ignore[union-attr]
    _ = ArticleAuthorLink.__table__  # type: ignore[union-attr]
    _ = ArticleSyncRun.__table__  # type: ignore[union-attr]
    _ = ArticleSyncEvent.__table__  # type: ignore[union-attr]

    # 4. Extraction models (dependem de Article, Project, etc.)
    # Apenas acessar o metadata ja forca o processamento de todos
    _ = Base.metadata.tables


# Executar preparacao do metadata apos todas as importacoes
_prepare_metadata()

__all__ = [
    # Base
    "Base",
    "BaseModel",
    "TimestampMixin",
    "UUIDMixin",
    # User
    "Profile",
    # Project
    "Project",
    "ProjectMember",
    "ProjectMemberRole",
    "ReviewType",
    # Article
    "Article",
    "ArticleFile",
    "FileRole",
    "ArticleAuthor",
    "ArticleAuthorLink",
    "ArticleSyncRun",
    "ArticleSyncEvent",
    # Extraction
    "ExtractionTemplateGlobal",
    "ProjectExtractionTemplate",
    "ExtractionEntityType",
    "ExtractionField",
    "ExtractionInstance",
    "ExtractionEvidence",
    "ExtractionRun",
    "ExtractionFramework",
    "ExtractionFieldType",
    "ExtractionCardinality",
    "ExtractionRunStage",
    "ExtractionRunStatus",
    # Extraction versioning
    "ConsensusRule",
    "ExtractionHitlConfig",
    "ExtractionTemplateVersion",
    "HitlConfigScopeKind",
    "TemplateKind",
    # Extraction workflow
    "ExtractionConsensusDecision",
    "ExtractionConsensusMode",
    "ExtractionProposalRecord",
    "ExtractionProposalSource",
    "ExtractionPublishedState",
    "ExtractionReviewerDecision",
    "ExtractionReviewerDecisionType",
    "ExtractionReviewerState",
    # Integration
    "ZoteroIntegration",
    # User API Keys
    "UserAPIKey",
    "SUPPORTED_PROVIDERS",
]
