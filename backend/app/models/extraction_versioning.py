"""Extraction versioning models: TemplateVersion and HitlConfig.

These tables back the immutable-snapshot template versioning and the
HITL configuration resolution chain (project default + template override).
Both feed Run.hitl_config_snapshot at Run creation time.
"""

from datetime import datetime
from enum import Enum as PyEnum
from uuid import UUID

from sqlalchemy import Boolean, DateTime, ForeignKey, Index, Integer, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import BaseModel, PostgreSQLEnumType


class TemplateKind(str, PyEnum):
    """Kind of evaluation a template represents."""

    EXTRACTION = "extraction"
    QUALITY_ASSESSMENT = "quality_assessment"


class HitlConfigScopeKind(str, PyEnum):
    """Scope at which a HITL config applies."""

    PROJECT = "project"
    TEMPLATE = "template"


class ConsensusRule(str, PyEnum):
    """Rule for resolving multi-reviewer consensus."""

    UNANIMOUS = "unanimous"
    MAJORITY = "majority"
    ARBITRATOR = "arbitrator"


class ExtractionTemplateVersion(BaseModel):
    """Immutable snapshot of a project_extraction_template's structure.

    Run.version_id references this table so that altering a template
    in the future does not retroactively affect frozen Runs.
    """

    __tablename__ = "extraction_template_versions"

    project_template_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("public.project_extraction_templates.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    version: Mapped[int] = mapped_column(Integer, nullable=False)
    schema_: Mapped[dict] = mapped_column("schema", JSONB, nullable=False)
    published_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )
    published_by: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("public.profiles.id", ondelete="RESTRICT"),
        nullable=False,
    )
    is_active: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    __table_args__ = (
        UniqueConstraint(
            "project_template_id",
            "version",
            name="uq_extraction_template_versions_template_version",
        ),
        Index(
            "idx_extraction_template_versions_active",
            "project_template_id",
            unique=True,
            postgresql_where="is_active",
        ),
        {"schema": "public"},
    )

    def __repr__(self) -> str:
        return (
            f"<ExtractionTemplateVersion template={self.project_template_id} "
            f"version={self.version}>"
        )


class ExtractionHitlConfig(BaseModel):
    """HITL configuration scoped to a project or a template.

    Resolution at Run creation: template-scoped overrides project-scoped;
    if neither exists, system default applies (1 reviewer, unanimous).
    The resolved config is snapshot-copied to Run.hitl_config_snapshot.
    """

    __tablename__ = "extraction_hitl_configs"

    scope_kind: Mapped[str] = mapped_column(
        PostgreSQLEnumType("hitl_config_scope_kind"),
        nullable=False,
    )
    scope_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        nullable=False,
        index=True,
    )
    reviewer_count: Mapped[int] = mapped_column(Integer, nullable=False)
    consensus_rule: Mapped[str] = mapped_column(
        PostgreSQLEnumType("consensus_rule"),
        nullable=False,
    )
    arbitrator_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("public.profiles.id", ondelete="SET NULL"),
        nullable=True,
    )

    __table_args__ = (
        UniqueConstraint(
            "scope_kind",
            "scope_id",
            name="uq_extraction_hitl_configs_scope",
        ),
        {"schema": "public"},
    )

    def __repr__(self) -> str:
        return (
            f"<ExtractionHitlConfig scope={self.scope_kind} "
            f"rule={self.consensus_rule} reviewers={self.reviewer_count}>"
        )
