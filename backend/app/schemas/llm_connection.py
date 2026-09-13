"""Connection contract (§2, §4) — secrets never cross this boundary.

``api_key`` is a ``SecretStr`` on every request shape; the read model
carries ``has_api_key`` only. The registry is the validator: an unknown
provider, a host on a host-less provider, a missing host, a missing key
where the provider needs one, or a project-scope request naming a
host-bearing provider are all 422s here — the DB CHECKs are the backstop.
"""

from __future__ import annotations

from datetime import datetime
from typing import Annotated, ClassVar, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, SecretStr, field_validator, model_validator

from app.llm.registry import get_provider
from app.schemas.llm_endpoint import LlmEndpointCapabilities

_BASE_URL_MAX = 2048
ModelId = Annotated[str, Field(max_length=200)]


def _non_empty_secret(v: SecretStr | None) -> SecretStr | None:
    if v is not None and v.get_secret_value() == "":
        raise ValueError("api_key must be omitted or non-empty")
    return v


class _ConnectionCreateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    scope: ClassVar[Literal["user", "project"]]

    provider: str = Field(max_length=50)
    label: str = Field(min_length=1, max_length=80)
    api_key: SecretStr | None = None
    base_url: str | None = Field(default=None, max_length=_BASE_URL_MAX)
    allowed_models: list[ModelId] = Field(default=[], max_length=200)

    _reject_empty_key = field_validator("api_key")(_non_empty_secret)

    @model_validator(mode="after")
    def _registry_rules(self) -> _ConnectionCreateRequest:
        spec = get_provider(self.provider)
        if spec is None:
            raise ValueError(f"provider: {self.provider!r} is not a registry provider")
        if self.scope not in spec.scopes:
            raise ValueError(f"provider: {self.provider!r} cannot be stored at {self.scope} scope")
        if spec.needs_host and not self.base_url:
            raise ValueError(f"base_url: {self.provider!r} requires a host")
        if not spec.needs_host and self.base_url is not None:
            raise ValueError(f"base_url: {self.provider!r} is a hosted provider; no host allowed")
        if not spec.key_optional and self.api_key is None:
            raise ValueError(f"api_key: {self.provider!r} requires a key")
        return self


class UserConnectionCreateRequest(_ConnectionCreateRequest):
    scope = "user"


class ProjectConnectionCreateRequest(_ConnectionCreateRequest):
    scope = "project"


class LlmConnectionUpdateRequest(BaseModel):
    """Full-replace ``label`` / ``base_url`` / ``allowed_models``; ``api_key``
    tri-state: ``None`` keeps, ``""`` clears (host-bearing providers only —
    the service refuses it elsewhere), non-empty re-encrypts."""

    model_config = ConfigDict(extra="forbid")

    label: str = Field(min_length=1, max_length=80)
    api_key: SecretStr | None = None
    base_url: str | None = Field(default=None, max_length=_BASE_URL_MAX)
    allowed_models: list[ModelId] = Field(default=[], max_length=200)


class LlmConnectionRead(BaseModel):
    id: UUID
    scope: Literal["user", "project"]
    provider: str
    label: str
    base_url: str | None
    has_api_key: bool
    allowed_models: list[str]
    capabilities: LlmEndpointCapabilities
    validation_status: Literal["unverified", "ok", "failed"]
    last_validated_at: datetime | None
    last_used_at: datetime | None
    created_by_name: str | None
    created_at: datetime


class LlmConnectionDeleteResult(BaseModel):
    deleted: bool
    id: UUID


class LlmConnectionVerifyResult(BaseModel):
    validation_status: Literal["ok", "failed"]
    output_mode: Literal["tool", "native", "prompted"] | None
    models_seen: list[str]
    error: str | None


class ProviderRead(BaseModel):
    """§4 ``GET /me/providers`` row; ``global_key_available`` is per deployment."""

    id: str
    label: str
    description: str
    docs_url: str | None
    needs_host: bool
    key_optional: bool
    scopes: list[str]
    global_key_available: bool
