"""Feedback outbox models.

`feedback_reports` is a store-and-forward log: a row is persisted on
submit, then a Celery task forwards it to Linear with idempotent
retries. `feedback_attachments` holds optional screenshots/clips.
"""

from datetime import datetime
from uuid import UUID

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import BaseModel


class FeedbackReport(BaseModel):
    """A single user feedback submission, forwarded to Linear."""

    __tablename__ = "feedback_reports"

    # No ORM-level ForeignKey: user_id references the Supabase-managed
    # auth.users table, which the app intentionally does not map in
    # SQLAlchemy. The FK is enforced at the DB level (baseline migration).
    user_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True), nullable=True
    )
    # Column name mirrors the existing DB column; intentionally shadows
    # the `type` builtin (required for schema parity).
    type: Mapped[str] = mapped_column(String(32), nullable=False)
    severity: Mapped[str | None] = mapped_column(String(16), nullable=True)
    summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    description: Mapped[str] = mapped_column(Text, nullable=False)

    url: Mapped[str | None] = mapped_column(Text, nullable=True)
    route: Mapped[str | None] = mapped_column(Text, nullable=True)
    user_agent: Mapped[str | None] = mapped_column(Text, nullable=True)
    viewport_size: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    project_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("public.projects.id", ondelete="SET NULL"),
        nullable=True,
    )
    article_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("public.articles.id", ondelete="SET NULL"),
        nullable=True,
    )
    app_version: Mapped[str | None] = mapped_column(String(64), nullable=True)

    linear_issue_id: Mapped[str | None] = mapped_column(Text, nullable=True)
    linear_identifier: Mapped[str | None] = mapped_column(String(32), nullable=True)
    linear_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    forward_status: Mapped[str] = mapped_column(
        String(16), nullable=False, server_default="pending"
    )
    forward_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    forwarded_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    attachments: Mapped[list["FeedbackAttachment"]] = relationship(
        back_populates="report",
        cascade="all, delete-orphan",
        lazy="selectin",
    )


class FeedbackAttachment(BaseModel):
    """A screenshot or short clip attached to a feedback report."""

    __tablename__ = "feedback_attachments"

    feedback_report_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("public.feedback_reports.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    kind: Mapped[str] = mapped_column(String(16), nullable=False)
    storage_key: Mapped[str] = mapped_column(Text, nullable=False)
    content_type: Mapped[str] = mapped_column(String(128), nullable=False)
    size_bytes: Mapped[int | None] = mapped_column(Integer, nullable=True)
    linear_asset_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    forward_status: Mapped[str] = mapped_column(
        String(16), nullable=False, server_default="pending"
    )

    report: Mapped["FeedbackReport"] = relationship(back_populates="attachments")
