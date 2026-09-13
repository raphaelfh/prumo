"""Connections (§2) and per-user engine rows (§3.1) — SECRETS tables.

``llm_connections`` is ONE table for a user's hosted-provider key, a
project's shared key, and a user-owned custom host. ``encrypted_api_key``
is a Fernet ciphertext under a per-row derived key (``derive_encryption_key``
with input ``connection:{id}``), so the service supplies ``id`` BEFORE
insert. Both tables are API-only: migration 0072 enables RLS with a
``deny_all`` policy and revokes every privilege from ``authenticated`` /
``anon``; the backend's own role owns them and bypasses RLS.

The CHECK literals below are computed from the registry — the ONE list of
providers — and asserted equal to it by ``tests/unit/llm/test_llm_connection_model.py``
and to the live constraint by ``tests/integration/test_migration_roundtrip.py``.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any
from uuid import UUID

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, Text, func, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.llm import registry
from app.llm.registry import provider_ids
from app.models.base import Base, BaseModel

VALIDATION_STATUSES = ("unverified", "ok", "failed")


def _quoted(ids: tuple[str, ...]) -> str:
    return ", ".join(f"'{pid}'" for pid in ids)


def provider_check_literal() -> str:
    """The exact SQL text of the ``provider`` CHECK, from the registry."""
    return f"provider IN ({_quoted(provider_ids())})"


def scopes_check_literal() -> str:
    """Project-scope rows may only name providers whose ``scopes`` allow it."""
    project_ids = tuple(spec.id for spec in registry.REGISTRY if "project" in spec.scopes)
    return f"scope = 'user' OR provider IN ({_quoted(project_ids)})"


def base_url_check_literal() -> str:
    """A host is set iff the provider needs one, and only at user scope."""
    host_ids = tuple(spec.id for spec in registry.REGISTRY if spec.needs_host)
    return (
        f"((base_url IS NOT NULL) = (provider IN ({_quoted(host_ids)}))) "
        "AND (base_url IS NULL OR scope = 'user')"
    )


class LlmConnection(BaseModel):
    """A provider, a credential, and (host-bearing providers) a host."""

    __tablename__ = "llm_connections"

    scope: Mapped[str] = mapped_column(Text, nullable=False)
    user_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("public.profiles.id", ondelete="CASCADE"),
        nullable=True,
        index=True,
    )
    project_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("public.projects.id", ondelete="CASCADE"),
        nullable=True,
        index=True,
    )
    provider: Mapped[str] = mapped_column(Text, nullable=False)
    label: Mapped[str] = mapped_column(Text, nullable=False)
    base_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    encrypted_api_key: Mapped[str | None] = mapped_column(Text, nullable=True)
    allowed_models: Mapped[list[Any]] = mapped_column(
        JSONB, server_default=text("'[]'::jsonb"), nullable=False
    )
    capabilities: Mapped[dict[str, Any]] = mapped_column(
        JSONB, server_default=text("'{}'::jsonb"), nullable=False
    )
    validation_status: Mapped[str] = mapped_column(
        Text, server_default="unverified", nullable=False
    )
    last_validated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_by: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("public.profiles.id", ondelete="RESTRICT"),
        nullable=False,
    )

    __table_args__ = (
        # SHORT names: the "ck" convention in models/base.py expands each to
        # ck_llm_connections_<short> — in the model AND in migration 0072,
        # which declares the same short names (the 0047 pattern). A
        # pre-expanded ck_ literal would double-wrap and md5-truncate.
        CheckConstraint(provider_check_literal(), name="provider_check"),
        CheckConstraint(scopes_check_literal(), name="scopes_check"),
        CheckConstraint("scope IN ('user', 'project')", name="scope_check"),
        CheckConstraint(
            "(scope = 'user' AND user_id IS NOT NULL AND project_id IS NULL) "
            "OR (scope = 'project' AND project_id IS NOT NULL AND user_id IS NULL)",
            name="owner_check",
        ),
        CheckConstraint(base_url_check_literal(), name="base_url_check"),
        CheckConstraint("char_length(label) BETWEEN 1 AND 80", name="label_check"),
        CheckConstraint(
            "validation_status IN ('unverified', 'ok', 'failed')",
            name="validation_status_check",
        ),
        Index(
            "uq_llm_connections_user_identity",
            "user_id",
            "provider",
            "label",
            unique=True,
            postgresql_where=text("scope = 'user'"),
        ),
        Index(
            "uq_llm_connections_project_identity",
            "project_id",
            "provider",
            "label",
            unique=True,
            postgresql_where=text("scope = 'project'"),
        ),
        Index(
            "uq_llm_connections_user_hosted_provider",
            "user_id",
            "provider",
            unique=True,
            postgresql_where=text("scope = 'user' AND base_url IS NULL"),
        ),
        {"schema": "public"},
    )

    def __repr__(self) -> str:
        return f"<LlmConnection scope={self.scope} provider={self.provider} label={self.label!r}>"


class UserProjectEngine(Base):
    """The viewer's own engine for new runs in one project (§3.1).

    No row means "follow the project default". ``connection_id`` is nulled
    when the connection is deleted; a host-bearing row with a null pointer
    is *retired* (§3.2 step 2).
    """

    __tablename__ = "user_project_engines"

    user_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("public.profiles.id", ondelete="CASCADE"),
        primary_key=True,
    )
    project_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("public.projects.id", ondelete="CASCADE"),
        primary_key=True,
    )
    provider: Mapped[str] = mapped_column(Text, nullable=False)
    model: Mapped[str] = mapped_column(Text, nullable=False)
    connection_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("public.llm_connections.id", ondelete="SET NULL"),
        nullable=True,
    )
    mode: Mapped[str] = mapped_column(Text, server_default="fast", nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    __table_args__ = (
        # → ck_user_project_engines_mode_check
        CheckConstraint("mode IN ('fast', 'verified')", name="mode_check"),
        {"schema": "public"},
    )
