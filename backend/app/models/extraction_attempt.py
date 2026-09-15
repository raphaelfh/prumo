"""Durable, service-only identity and outcome of one extraction request."""

from typing import Any
from uuid import UUID

from sqlalchemy import CheckConstraint, ForeignKey, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import BaseModel


class ExtractionAttempt(BaseModel):
    __tablename__ = "extraction_attempts"

    request_id: Mapped[UUID] = mapped_column(unique=True)
    owner_id: Mapped[UUID] = mapped_column(ForeignKey("public.profiles.id", ondelete="RESTRICT"))
    # Run deletion owns the cascade; coordinate references are deferred so a
    # project/article whole-graph cascade may remove its parents in any order.
    project_id: Mapped[UUID] = mapped_column(
        ForeignKey("public.projects.id", deferrable=True, initially="DEFERRED")
    )
    article_id: Mapped[UUID] = mapped_column(
        ForeignKey("public.articles.id", deferrable=True, initially="DEFERRED")
    )
    template_id: Mapped[UUID] = mapped_column(
        ForeignKey("public.project_extraction_templates.id", deferrable=True, initially="DEFERRED")
    )
    run_id: Mapped[UUID] = mapped_column(
        ForeignKey("public.extraction_runs.id", ondelete="CASCADE")
    )
    request_payload: Mapped[dict[str, Any]] = mapped_column(JSONB)
    job_id: Mapped[str | None] = mapped_column(Text)
    engine: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    status: Mapped[str] = mapped_column(Text, default="pending", server_default="pending")
    result: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    error: Mapped[str | None] = mapped_column(Text)
    error_code: Mapped[str | None] = mapped_column(Text)

    __table_args__ = (
        CheckConstraint(
            "status IN ('pending','running','completed','failed','cancelled')", name="status"
        ),
        UniqueConstraint("id", "run_id", name="uq_extraction_attempt_id_run"),
        {"schema": "public"},
    )
