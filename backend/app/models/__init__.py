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
from app.models.assessment import (
    AIAssessment,
    AIAssessmentConfig,
    AIAssessmentPrompt,
    AIAssessmentRun,
    AssessmentEvidence,
    AssessmentInstance,
    AssessmentInstrument,
    AssessmentItem,
    AssessmentResponse,
    AssessmentSource,
    AssessmentStatus,
    ProjectAssessmentInstrument,
    ProjectAssessmentItem,
)
from app.models.base import Base, BaseModel, TimestampMixin, UUIDMixin
from app.models.evaluation_decision import (
    ConsensusDecisionMode,
    ConsensusDecisionRecord,
    EvidenceEntityType,
    EvidenceRecord,
    PublishedState,
    PublishedStateStatus,
    ReviewerDecisionRecord,
    ReviewerDecisionType,
    ReviewerState,
)
from app.models.evaluation_run import (
    EvaluationProposalSourceType,
    EvaluationRun,
    EvaluationRunStage,
    EvaluationRunStatus,
    EvaluationRunTarget,
    ProposalRecord,
)
from app.models.evaluation_schema import (
    EvaluationItem,
    EvaluationItemType,
    EvaluationSchema,
    EvaluationSchemaVersion,
    EvaluationSchemaVersionStatus,
)
from app.models.extraction import (
    AISuggestion,
    ExtractedValue,
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
    ExtractionSource,
    ExtractionTemplateGlobal,
    ProjectExtractionTemplate,
    SuggestionStatus,
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
    "ExtractedValue",
    "ExtractionEvidence",
    "ExtractionRun",
    "AISuggestion",
    "ExtractionFramework",
    "ExtractionFieldType",
    "ExtractionCardinality",
    "ExtractionSource",
    "ExtractionRunStage",
    "ExtractionRunStatus",
    "SuggestionStatus",
    # Assessment (new structure)
    "AssessmentInstrument",
    "AssessmentItem",
    "AssessmentInstance",
    "AssessmentResponse",
    "AssessmentEvidence",
    "AssessmentSource",
    "AssessmentStatus",
    "AIAssessmentConfig",
    "AIAssessmentPrompt",
    "AIAssessmentRun",
    "AIAssessment",
    "ProjectAssessmentInstrument",
    "ProjectAssessmentItem",
    # Integration
    "ZoteroIntegration",
    # User API Keys
    "UserAPIKey",
    "SUPPORTED_PROVIDERS",
    # Unified evaluation
    "EvaluationSchema",
    "EvaluationSchemaVersion",
    "EvaluationSchemaVersionStatus",
    "EvaluationItem",
    "EvaluationItemType",
    "EvaluationRun",
    "EvaluationRunStatus",
    "EvaluationRunStage",
    "EvaluationRunTarget",
    "EvaluationProposalSourceType",
    "ProposalRecord",
    "ReviewerDecisionRecord",
    "ReviewerDecisionType",
    "ReviewerState",
    "ConsensusDecisionRecord",
    "ConsensusDecisionMode",
    "PublishedState",
    "PublishedStateStatus",
    "EvidenceRecord",
    "EvidenceEntityType",
]
