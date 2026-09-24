"""Personal access tokens for the /mcp mount (spec §4.1, ADR 0020).

Only the SHA-256 of the secret is stored; the secret is shown once.
Backend-only table: migration 0078 enables RLS with ``deny_all`` and
revokes every privilege from ``authenticated`` / ``anon``. Not
``BaseModel``: the table has no ``updated_at``.
"""

from __future__ import annotations

from datetime import datetime
from typing import Literal
from uuid import UUID

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, Text, func, text
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, UUIDMixin


class PersonalAccessToken(Base, UUIDMixin):
    __tablename__ = "personal_access_tokens"

    user_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("public.profiles.id", ondelete="CASCADE"), nullable=False
    )
    name: Mapped[str] = mapped_column(Text, nullable=False)
    token_prefix: Mapped[str] = mapped_column(Text, nullable=False)
    token_hash: Mapped[str] = mapped_column(Text, nullable=False, unique=True)
    # Literal, not str: strict mypy (no pydantic plugin) rejects a str passed to the
    # Literal-typed PersonalAccessTokenRead.scope / McpPrincipal.scope. Explicit Text
    # keeps the DDL a plain text column (verified: no alembic drift, mypy clean).
    scope: Mapped[Literal["read", "read_write"]] = mapped_column(Text, nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    __table_args__ = (
        # SHORT names: the "ck" convention expands them to ck_personal_access_tokens_<name>.
        CheckConstraint("char_length(name) BETWEEN 1 AND 80", name="name_check"),
        CheckConstraint("scope IN ('read', 'read_write')", name="scope_check"),
        CheckConstraint(
            "expires_at > created_at AND expires_at <= created_at + interval '365 days'",
            name="expires_at_check",
        ),
        Index(
            "ix_personal_access_tokens_active_user",
            "user_id",
            postgresql_where=text("revoked_at IS NULL"),
        ),
        {"schema": "public"},
    )
