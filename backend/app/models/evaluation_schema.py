"""Unified evaluation schema domain models (skeleton)."""

from datetime import datetime
from enum import Enum as PyEnum
from uuid import UUID

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import BaseModel, PostgreSQLEnumType


class EvaluationSchemaVersionStatus(str, PyEnum):
    """Status values for schema versions."""

    DRAFT = "draft"
    PUBLISHED = "published"
    ARCHIVED = "archived"


class EvaluationItemType(str, PyEnum):
    """Supported item value types."""

    TEXT = "text"
    NUMBER = "number"
    BOOLEAN = "boolean"
    DATE = "date"
    CHOICE_SINGLE = "choice_single"
    CHOICE_MULTI = "choice_multi"


class EvaluationSchema(BaseModel):
    """Top-level schema definition bound to a project."""

    __tablename__ = "evaluation_schemas"

    project_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("public.projects.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    name: Mapped[str] = mapped_column(String, nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("public.profiles.id", ondelete="RESTRICT"),
        nullable=False,
    )

    __table_args__ = (
        UniqueConstraint("project_id", "name", name="evaluation_schemas_project_id_name_key"),
        {"schema": "public"},
    )


class EvaluationSchemaVersion(BaseModel):
    """Immutable snapshot of a schema."""

    __tablename__ = "evaluation_schema_versions"

    schema_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("public.evaluation_schemas.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    version_number: Mapped[int] = mapped_column(Integer, nullable=False)
    status: Mapped[str] = mapped_column(
        PostgreSQLEnumType("evaluation_schema_version_status"),
        default=EvaluationSchemaVersionStatus.DRAFT.value,
        nullable=False,
    )
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    published_by: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("public.profiles.id", ondelete="SET NULL"),
        nullable=True,
    )

    __table_args__ = (
        UniqueConstraint(
            "schema_id",
            "version_number",
            name="evaluation_schema_versions_schema_id_version_number_key",
        ),
        {"schema": "public"},
    )


class EvaluationItem(BaseModel):
    """Atomic item evaluated in runs/reviews/consensus."""

    __tablename__ = "evaluation_items"

    schema_version_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("public.evaluation_schema_versions.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    item_key: Mapped[str] = mapped_column(String, nullable=False)
    label: Mapped[str] = mapped_column(String, nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    item_type: Mapped[str] = mapped_column(PostgreSQLEnumType("evaluation_item_type"), nullable=False)
    options_json: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    required: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False)
    is_deleted: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    __table_args__ = (
        UniqueConstraint(
            "schema_version_id",
            "item_key",
            name="evaluation_items_schema_version_id_item_key_key",
        ),
        {"schema": "public"},
    )
