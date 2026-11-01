"""Append-only duplicate verdicts between two articles of one project.

Backend-only (RLS deny-all, like the screening tables). A verdict is never
updated: the current one for a pair is the latest row, ordered by a
``created_at`` that defaults to ``clock_timestamp()`` (the INSERT).
"""

from __future__ import annotations

from datetime import datetime
from typing import get_args
from uuid import UUID

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, Text, func
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, UUIDMixin
from app.schemas.duplicates import DuplicateBasis, DuplicateVerdictValue


def _in_list(column: str, values: tuple[str, ...]) -> str:
    return f"{column} IN ({', '.join(repr(v) for v in values)})"


class ArticleDuplicateVerdict(Base, UUIDMixin):
    """One manager ruling: ``article_id`` is removed / judged distinct, ``kept_article_id`` stays."""

    __tablename__ = "article_duplicate_verdicts"

    project_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("public.projects.id", ondelete="CASCADE"), nullable=False
    )
    article_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("public.articles.id", ondelete="CASCADE"), nullable=False
    )
    kept_article_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("public.articles.id", ondelete="CASCADE"), nullable=False
    )
    verdict: Mapped[str] = mapped_column(Text, nullable=False)
    basis: Mapped[str] = mapped_column(Text, nullable=False)
    decided_by: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("public.profiles.id", ondelete="RESTRICT"), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.clock_timestamp()
    )

    # SHORT CHECK names: the "ck" convention expands them to ck_<table>_<name>.
    __table_args__ = (
        CheckConstraint(_in_list("verdict", get_args(DuplicateVerdictValue)), name="verdict"),
        CheckConstraint(_in_list("basis", get_args(DuplicateBasis)), name="basis"),
        CheckConstraint("article_id <> kept_article_id", name="not_self"),
        Index("ix_article_duplicate_verdicts_project_id", "project_id"),
        Index("ix_article_duplicate_verdicts_article_id", "article_id"),
        Index("ix_article_duplicate_verdicts_kept_article_id", "kept_article_id"),
        Index("ix_article_duplicate_verdicts_decided_by", "decided_by"),
        {"schema": "public"},
    )
