"""Extraction instance model: one entry of an entity type in an article."""

from typing import TYPE_CHECKING, Any
from uuid import UUID

from sqlalchemy import Boolean, ForeignKey, Index, Integer, String, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import BaseModel

if TYPE_CHECKING:
    from app.models.extraction import ProjectExtractionTemplate


class ExtractionInstance(BaseModel):
    """
    Instancia especifica de entidade for cada article.

    Indices:
    - project_id, article_id, template_id: FKs indexadas
    - (article_id, entity_type_id, sort_order): busca ordenada
    - metadata: GIN for busca em JSONB
    - entity_key: unique per (article, entity type, parent instance)
    """

    __tablename__ = "extraction_instances"

    project_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("public.projects.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    article_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("public.articles.id", ondelete="CASCADE"),
        nullable=True,
        index=True,
    )

    template_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("public.project_extraction_templates.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )

    entity_type_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("public.extraction_entity_types.id", ondelete="RESTRICT"),
        nullable=False,
    )

    parent_instance_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("public.extraction_instances.id", ondelete="CASCADE"),
        nullable=True,
    )

    label: Mapped[str] = mapped_column(String, nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    metadata_: Mapped[dict[str, Any]] = mapped_column(
        "metadata", JSONB, default=dict, nullable=False
    )

    created_by: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("public.profiles.id", ondelete="RESTRICT"),
        nullable=False,
    )

    is_template: Mapped[bool | None] = mapped_column(Boolean, default=False, nullable=True)

    # Relationships
    template: Mapped["ProjectExtractionTemplate"] = relationship(
        "ProjectExtractionTemplate",
        back_populates="instances",
    )

    __table_args__ = (
        # Indice composto for busca ordenada por article
        Index(
            "idx_extraction_instances_article_entity_sort",
            "article_id",
            "entity_type_id",
            "sort_order",
        ),
        # Indice GIN for metadata
        Index("idx_extraction_instances_metadata_gin", "metadata", postgresql_using="gin"),
        # One identity per coordinate, roots included (0090).
        Index(
            "uq_extraction_instances_entity_key",
            "article_id",
            "entity_type_id",
            "parent_instance_id",
            text("(metadata->>'entity_key')"),
            unique=True,
            postgresql_nulls_not_distinct=True,
            postgresql_where=text("metadata ? 'entity_key'"),
        ),
        {"schema": "public"},
    )

    def __repr__(self) -> str:
        return f"<ExtractionInstance {self.label}>"
