"""OAuth authorization-server state for the /mcp mount (ADR 0022, migration 0083).

A connection itself is a ``PersonalAccessToken`` row with ``kind='oauth'``;
these tables hold what the authorization server needs around it: the
registered clients, the pending authorization requests (and the code an
approved one mints) and the issued access/refresh tokens. Codes and tokens
are stored only as SHA-256 hex. Backend-only tables: RLS ``deny_all`` and
every privilege revoked from ``authenticated`` / ``anon``. Not
``BaseModel``: no ``updated_at``.
"""

from __future__ import annotations

from datetime import datetime
from typing import Literal
from uuid import UUID

from sqlalchemy import Boolean, CheckConstraint, DateTime, ForeignKey, Index, Text, func
from sqlalchemy.dialects.postgresql import ARRAY
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class McpOAuthClient(Base):
    """A client registered through dynamic client registration."""

    __tablename__ = "mcp_oauth_clients"

    client_id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True)
    client_name: Mapped[str] = mapped_column(Text, nullable=False)
    redirect_uris: Mapped[list[str]] = mapped_column(ARRAY(Text), nullable=False)
    # The registered scopes, space-separated.
    scope: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    __table_args__ = (
        CheckConstraint("char_length(client_name) BETWEEN 1 AND 80", name="client_name_check"),
        CheckConstraint("cardinality(redirect_uris) BETWEEN 1 AND 5", name="redirect_uris_check"),
        {"schema": "public"},
    )


class McpOAuthRequest(Base):
    """A pending authorization request; once approved, it carries the code it minted."""

    __tablename__ = "mcp_oauth_requests"

    id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True)
    client_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("public.mcp_oauth_clients.client_id", ondelete="CASCADE"),
        nullable=False,
    )
    redirect_uri: Mapped[str] = mapped_column(Text, nullable=False)
    redirect_uri_provided_explicitly: Mapped[bool] = mapped_column(Boolean, nullable=False)
    code_challenge: Mapped[str] = mapped_column(Text, nullable=False)
    state: Mapped[str | None] = mapped_column(Text)
    requested_scopes: Mapped[list[str]] = mapped_column(ARRAY(Text), nullable=False)
    resource: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    user_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("public.profiles.id", ondelete="CASCADE")
    )
    connection_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("public.personal_access_tokens.id", ondelete="CASCADE")
    )
    code_hash: Mapped[str | None] = mapped_column(Text, unique=True)
    code_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    code_used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    __table_args__ = (
        Index("ix_mcp_oauth_requests_client_id", "client_id"),
        Index("ix_mcp_oauth_requests_connection_id", "connection_id"),
        {"schema": "public"},
    )


class McpOAuthToken(Base):
    """An access or refresh token issued for one OAuth connection."""

    __tablename__ = "mcp_oauth_tokens"

    id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True)
    connection_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("public.personal_access_tokens.id", ondelete="CASCADE"),
        nullable=False,
    )
    kind: Mapped[Literal["access", "refresh"]] = mapped_column(Text, nullable=False)
    token_hash: Mapped[str] = mapped_column(Text, nullable=False, unique=True)
    resource: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    rotated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    __table_args__ = (
        CheckConstraint("kind IN ('access', 'refresh')", name="kind_check"),
        Index("ix_mcp_oauth_tokens_connection_id", "connection_id"),
        {"schema": "public"},
    )
