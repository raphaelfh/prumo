"""
User API Key Schemas.

Schemas Pydantic for gerenciamento de API keys of the usuarios.
"""

from typing import Any

from pydantic import BaseModel, ConfigDict, Field

from app.models.user_api_key import SUPPORTED_PROVIDERS


class CreateAPIKeyRequest(BaseModel):
    """Request for criar nova API key."""

    provider: str = Field(
        ...,
        description=f"Provedor da API. Valores: {SUPPORTED_PROVIDERS}",
    )
    api_key: str = Field(
        ...,
        alias="apiKey",
        min_length=10,
        description="API key do provedor",
    )
    key_name: str | None = Field(
        default=None,
        alias="keyName",
        max_length=100,
        description="Nome optional for identificar a key",
    )
    is_default: bool = Field(
        default=True,
        alias="isDefault",
        description="Se deve ser a key default for o provedor",
    )
    key_metadata: dict[str, Any] | None = Field(
        default=None,
        alias="metadata",
        description="Metadata extras (modelo preferido, etc.)",
    )
    validate_key: bool = Field(
        default=True,
        alias="validateKey",
        description="Se deve validar a key antes de salvar",
    )

    model_config = ConfigDict(populate_by_name=True)


class UpdateAPIKeyRequest(BaseModel):
    """Request for atualizar API key."""

    is_default: bool | None = Field(
        default=None,
        alias="isDefault",
        description="Se deve ser a key default",
    )
    is_active: bool | None = Field(
        default=None,
        alias="isActive",
        description="Se a key esta ativa",
    )
    key_name: str | None = Field(
        default=None,
        alias="keyName",
        max_length=100,
        description="Nome for identificar a key",
    )

    model_config = ConfigDict(populate_by_name=True)


class APIKeyResponse(BaseModel):
    """Resposta with data de uma API key (sem a key em si)."""

    id: str
    provider: str
    key_name: str | None = Field(alias="keyName")
    is_active: bool = Field(alias="isActive")
    is_default: bool = Field(alias="isDefault")
    validation_status: str | None = Field(alias="validationStatus")
    last_used_at: str | None = Field(alias="lastUsedAt")
    last_validated_at: str | None = Field(alias="lastValidatedAt")
    created_at: str = Field(alias="createdAt")

    model_config = ConfigDict(populate_by_name=True)


class CreateAPIKeyResponse(BaseModel):
    """Resposta apos criar API key."""

    id: str
    provider: str
    validation_status: str = Field(alias="validationStatus")
    validation_message: str | None = Field(alias="validationMessage")
    is_default: bool = Field(alias="isDefault")

    model_config = ConfigDict(populate_by_name=True)
