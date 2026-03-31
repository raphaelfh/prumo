"""
User API Key Model.

Modelo for armazenar API keys de provedores externos (OpenAI, Anthropic, etc.).
A criptografia e feita in the aplicacao via Fernet, seguindo o padrao de ZoteroIntegration.
"""

from datetime import datetime
from typing import TYPE_CHECKING, Any
from uuid import UUID

from sqlalchemy import Boolean, CheckConstraint, DateTime, ForeignKey, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import BaseModel

if TYPE_CHECKING:
    from app.models.user import Profile


# Provedores suportados
SUPPORTED_PROVIDERS = ("openai", "anthropic", "gemini", "grok")

# Status de validacao
VALIDATION_STATUSES = ("valid", "invalid", "pending")


class UserAPIKey(BaseModel):
    """
    API key de provedor externo por user.

    A criptografia e feita in the aplicacao via Fernet (mesmo padrao de ZoteroIntegration).
    Isso garante funcionamento tanto em ambiente local quanto em producao.

    Attributes:
        user_id: user dono da key.
        provider: Provedor da API (openai, anthropic, gemini, grok).
        encrypted_api_key: API key criptografada via Fernet.
        key_name: Nome optional for identificar a key.
        is_active: Se a key esta ativa.
        is_default: Se e a key padrao for o provedor.
        last_used_at: Ultima vez que a key foi usada.
        last_validated_at: Ultima validacao da key.
        validation_status: Status da validacao (valid, invalid, pending).
        key_metadata: Metadata extras (modelo preferido, regiao, etc.).
    """

    __tablename__ = "user_api_keys"

    user_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("public.profiles.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    provider: Mapped[str] = mapped_column(
        Text,
        nullable=False,
        index=True,
    )

    # API key criptografada via Fernet (igual ao Zotero)
    encrypted_api_key: Mapped[str] = mapped_column(
        Text,
        nullable=False,
    )

    key_name: Mapped[str | None] = mapped_column(
        Text,
        nullable=True,
    )

    is_active: Mapped[bool] = mapped_column(
        Boolean,
        default=True,
        nullable=False,
    )

    is_default: Mapped[bool] = mapped_column(
        Boolean,
        default=False,
        nullable=False,
    )

    last_used_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )

    last_validated_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )

    validation_status: Mapped[str | None] = mapped_column(
        Text,
        nullable=True,
    )

    key_metadata: Mapped[dict[str, Any] | None] = mapped_column(
        JSONB,
        default=dict,
        nullable=True,
        name="metadata",  # Nome da coluna in the banco
    )

    # Relationships
    user: Mapped["Profile"] = relationship(
        "Profile",
        back_populates="api_keys",
    )

    __table_args__ = (
        CheckConstraint(
            "provider IN ('openai', 'anthropic', 'gemini', 'grok')",
            name="user_api_keys_provider_check",
        ),
        CheckConstraint(
            "validation_status IS NULL OR validation_status IN ('valid', 'invalid', 'pending')",
            name="user_api_keys_validation_status_check",
        ),
        {"schema": "public"},
    )

    def __repr__(self) -> str:
        return f"<UserAPIKey user={self.user_id} provider={self.provider}>"
