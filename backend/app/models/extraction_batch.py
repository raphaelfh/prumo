"""A reviewer's AI batch over many articles of one project tool (spec 2026-09-15 §6).

Backend-only (RLS on, client roles revoked). The batch has no status column:
its state is derived from ``cancelled_at``/``stop_code`` and its items, and a
dispatched item's outcome is its attempt's, so nothing can drift.
"""

from datetime import datetime
from uuid import UUID

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import BaseModel

ITEM_STATUSES = ("queued", "dispatched", "skipped", "failed", "cancelled")


class ExtractionBatch(BaseModel):
    __tablename__ = "extraction_batches"

    # Cascades are deliberate (G17): a batch never blocks deleting its owner,
    # project or tool.
    owner_id: Mapped[UUID] = mapped_column(ForeignKey("public.profiles.id", ondelete="CASCADE"))
    project_id: Mapped[UUID] = mapped_column(ForeignKey("public.projects.id", ondelete="CASCADE"))
    template_id: Mapped[UUID] = mapped_column(
        ForeignKey("public.project_extraction_templates.id", ondelete="CASCADE")
    )
    skip_articles_with_ai_suggestions: Mapped[bool] = mapped_column(
        Boolean, default=True, server_default=text("true")
    )
    cancelled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    stop_code: Mapped[str | None] = mapped_column(Text)
    stop_message: Mapped[str | None] = mapped_column(Text)

    __table_args__ = (
        Index("ix_extraction_batches_owner_created", "owner_id", "created_at"),
        {"schema": "public"},
    )


class ExtractionBatchItem(BaseModel):
    __tablename__ = "extraction_batch_items"

    batch_id: Mapped[UUID] = mapped_column(
        ForeignKey("public.extraction_batches.id", ondelete="CASCADE")
    )
    article_id: Mapped[UUID] = mapped_column(ForeignKey("public.articles.id", ondelete="CASCADE"))
    attempt_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("public.extraction_attempts.id", ondelete="SET NULL")
    )
    status: Mapped[str] = mapped_column(Text, default="queued", server_default="queued")
    reason_code: Mapped[str | None] = mapped_column(Text)

    __table_args__ = (
        # Built from ITEM_STATUSES so the constant and the constraint cannot
        # drift; renders byte-identical SQL to the literal it replaced, so
        # there is no migration drift.
        CheckConstraint(
            "status IN (" + ",".join(f"'{status}'" for status in ITEM_STATUSES) + ")",
            name="status",
        ),
        UniqueConstraint("batch_id", "article_id", name="uq_extraction_batch_items_batch_article"),
        Index("ix_extraction_batch_items_batch_status", "batch_id", "status"),
        {"schema": "public"},
    )
