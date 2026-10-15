"""Credential rows for the /mcp mount (spec §4.1, ADR 0020, ADR 0022).

``kind='pat'``: a personal access token. Only the SHA-256 of the secret is
stored; the secret is shown once. ``kind='oauth'``: one OAuth connection of
a user to a registered client (``oauth_client_id``); it has no secret of
its own (its access/refresh tokens live in ``mcp_oauth_tokens``) and its
``name`` is the client's name.
Backend-only table: migration 0078 enables RLS with ``deny_all`` and
revokes every privilege from ``authenticated`` / ``anon``. Not
``BaseModel``: the table has no ``updated_at``.
"""

from __future__ import annotations

from datetime import datetime
from typing import Literal
from uuid import UUID

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, Text, func, text
from sqlalchemy.dialects.postgresql import ARRAY
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, UUIDMixin


class PersonalAccessToken(Base, UUIDMixin):
    __tablename__ = "personal_access_tokens"

    user_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("public.profiles.id", ondelete="CASCADE"), nullable=False
    )
    kind: Mapped[Literal["pat", "oauth"]] = mapped_column(
        Text, nullable=False, server_default=text("'pat'")
    )
    oauth_client_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("public.mcp_oauth_clients.client_id", ondelete="CASCADE"),
    )
    name: Mapped[str] = mapped_column(Text, nullable=False)
    # NULL exactly when kind = 'oauth' (kind_shape_check).
    token_prefix: Mapped[str | None] = mapped_column(Text)
    token_hash: Mapped[str | None] = mapped_column(Text, unique=True)
    # Literal, not str: strict mypy (no pydantic plugin) rejects a str passed to the
    # Literal-typed PersonalAccessTokenRead.scope / McpPrincipal.scope. Explicit Text
    # keeps the DDL a plain text column (verified: no alembic drift, mypy clean).
    scope: Mapped[Literal["read", "read_write"]] = mapped_column(Text, nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # NULL = every project of the token's user; otherwise the only projects it reaches.
    project_ids: Mapped[list[UUID] | None] = mapped_column(ARRAY(PG_UUID(as_uuid=True)))
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
        CheckConstraint(
            "project_ids IS NULL OR cardinality(project_ids) BETWEEN 1 AND 20",
            name="project_ids_check",
        ),
        CheckConstraint("kind IN ('pat', 'oauth')", name="kind_check"),
        CheckConstraint(
            "(kind = 'pat' AND token_hash IS NOT NULL AND token_prefix IS NOT NULL"
            " AND oauth_client_id IS NULL)"
            " OR (kind = 'oauth' AND oauth_client_id IS NOT NULL AND token_hash IS NULL"
            " AND token_prefix IS NULL)",
            name="kind_shape_check",
        ),
        Index(
            "ix_personal_access_tokens_active_user",
            "user_id",
            postgresql_where=text("revoked_at IS NULL"),
        ),
        # One unrevoked connection per user x client (no now() here: not IMMUTABLE).
        Index(
            "uq_personal_access_tokens_oauth_user_client",
            "user_id",
            "oauth_client_id",
            unique=True,
            postgresql_where=text("kind = 'oauth' AND revoked_at IS NULL"),
        ),
        Index(
            "ix_personal_access_tokens_oauth_client",
            "oauth_client_id",
            postgresql_where=text("oauth_client_id IS NOT NULL"),
        ),
        {"schema": "public"},
    )
