"""
Repository Layer.

Implements the Repository pattern to abstract data access.
Facilitates testing, maintenance and query migration.
"""

from app.repositories.article_repository import ArticleFileRepository, ArticleRepository
from app.repositories.base import BaseRepository
from app.repositories.extraction_consensus_decision_repository import (
    ExtractionConsensusDecisionRepository,
)
from app.repositories.extraction_proposal_repository import ExtractionProposalRepository
from app.repositories.extraction_published_state_repository import (
    ExtractionPublishedStateRepository,
)
from app.repositories.extraction_repository import (
    ExtractionEntityTypeRepository,
    ExtractionInstanceRepository,
    ExtractionTemplateRepository,
    GlobalTemplateRepository,
)
from app.repositories.extraction_reviewer_decision_repository import (
    ExtractionReviewerDecisionRepository,
)
from app.repositories.extraction_reviewer_state_repository import (
    ExtractionReviewerStateRepository,
)
from app.repositories.extraction_run_repository import ExtractionRunRepository
from app.repositories.hitl_config_repository import HitlConfigRepository
from app.repositories.integration_repository import ZoteroIntegrationRepository
from app.repositories.project_repository import ProjectMemberRepository, ProjectRepository
from app.repositories.unit_of_work import UnitOfWork
from app.repositories.user_api_key_repository import UserAPIKeyRepository

__all__ = [
    # Base
    "BaseRepository",
    "UnitOfWork",
    # Article
    "ArticleRepository",
    "ArticleFileRepository",
    # Project
    "ProjectRepository",
    "ProjectMemberRepository",
    # Extraction
    "ExtractionTemplateRepository",
    "GlobalTemplateRepository",
    "ExtractionEntityTypeRepository",
    "ExtractionInstanceRepository",
    "ExtractionRunRepository",
    "ExtractionProposalRepository",
    "ExtractionReviewerDecisionRepository",
    "ExtractionReviewerStateRepository",
    "ExtractionConsensusDecisionRepository",
    "ExtractionPublishedStateRepository",
    # HITL
    "HitlConfigRepository",
    # Integration
    "ZoteroIntegrationRepository",
    # User API Keys
    "UserAPIKeyRepository",
]
