"""Custom LLM endpoint contract (§C2) — secrets never cross this boundary.

``api_key`` is a ``SecretStr`` on both request shapes so a 422 echo, a
``repr``, or a stray ``model_dump`` never leaks key material; the read
model exposes ``has_api_key`` only — key material has NO field on any
response shape. Encryption/decryption live in the service (Fernet,
per-row derived key); these schemas only ferry the secret inward.
"""

from __future__ import annotations

from datetime import datetime
from typing import Annotated, Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, SecretStr, field_validator

from app.core.logging import get_logger

logger = get_logger(__name__)

#: Bounds for the two free-text request fields. The columns are unbounded
#: ``Text``/JSONB, so the shape is the only thing keeping a megabyte of
#: user input out of the row — and out of every log line that names it.
_BASE_URL_MAX = 2048
_MODEL_ID_MAX = 200
_ALLOWED_MODELS_MAX = 200

_OUTPUT_MODES = ("tool", "native", "prompted")

ModelId = Annotated[str, Field(max_length=_MODEL_ID_MAX)]


class LlmEndpointCapabilities(BaseModel):
    """What the probe learned about an endpoint.

    ``output_mode`` is the highest probe-ladder rung the endpoint passed
    (tool → native → prompted); ``None`` means never probed.
    ``models_seen`` is the sanitized ``/models`` listing captured at
    probe time (capped at the probe seam, not here).
    """

    output_mode: Literal["tool", "native", "prompted"] | None = None
    models_seen: list[str] = []

    @field_validator("output_mode", mode="before")
    @classmethod
    def _normalize_output_mode(cls, v: Any) -> Any:
        """An unknown stored mode degrades to ``None`` — loudly, never fatally.

        This model is re-validated from JSONB on every read (the LIST route,
        the engine-choice gate), so a value written by another build — or by
        hand — must not 500 the whole manager surface. Same posture as
        ``LlmEngineStored.mode``; ``None`` simply means "capability unknown",
        which every consumer already handles.
        """
        if v is None or v in _OUTPUT_MODES:
            return v
        logger.warning("llm_endpoint_unknown_output_mode_normalized", stored_output_mode=str(v))
        return None


class LlmEndpointCreateRequest(BaseModel):
    """POST body for a new endpoint.

    ``api_key`` is either omitted/``None`` (a keyless endpoint, e.g.
    local Ollama) or a non-empty secret — an empty string is a mistake,
    not keyless, and is rejected.
    """

    model_config = ConfigDict(extra="forbid")

    label: str = Field(min_length=1, max_length=80)
    base_url: str = Field(max_length=_BASE_URL_MAX)
    api_key: SecretStr | None = None  # None = keyless endpoint
    allowed_models: list[ModelId] = Field(default=[], max_length=_ALLOWED_MODELS_MAX)

    @field_validator("api_key")
    @classmethod
    def _reject_empty_key(cls, v: SecretStr | None) -> SecretStr | None:
        # "" is a mistake, not keyless
        if v is not None and v.get_secret_value() == "":
            raise ValueError("api_key must be omitted (keyless) or non-empty")
        return v


class LlmEndpointUpdateRequest(BaseModel):
    """PUT is full-replace for ``label``/``base_url``/``allowed_models``.

    ``api_key`` is tri-state: ``None`` = keep the stored key; ``""`` =
    clear it (endpoint becomes keyless); a non-empty string = set a new
    key. The tri-state semantics are applied by the service — this shape
    only distinguishes the three states without ever echoing the secret.
    """

    model_config = ConfigDict(extra="forbid")

    label: str = Field(min_length=1, max_length=80)
    base_url: str = Field(max_length=_BASE_URL_MAX)
    api_key: SecretStr | None = None
    allowed_models: list[ModelId] = Field(default=[], max_length=_ALLOWED_MODELS_MAX)


class LlmEndpointRead(BaseModel):
    """One endpoint as the manager-only surface renders it.

    NEVER carries key material — ``has_api_key`` is the only trace that
    a key exists. ``base_url`` is visible because this read serves the
    manager management surface only.
    """

    id: UUID
    label: str
    base_url: str  # manager-only surface
    has_api_key: bool
    allowed_models: list[str]
    capabilities: LlmEndpointCapabilities
    validation_status: Literal["unverified", "ok", "failed"]
    last_validated_at: datetime | None
    created_by_name: str | None


class LlmEndpointDeleteResult(BaseModel):
    """DELETE returns 200 + this envelope payload (house pattern —
    ``DeleteAPIKeyResult``; a 204 would violate the envelope gate)."""

    deleted: bool
    id: UUID


class LlmEndpointProbeResult(BaseModel):
    """Outcome of a verify probe, as returned to the manager.

    ``error`` is sanitized — a reason class only (timeout, refused,
    TLS, HTTP status), never raw upstream bodies or connection detail.
    """

    validation_status: Literal["ok", "failed"]
    output_mode: Literal["tool", "native", "prompted"] | None
    models_seen: list[str]
    error: str | None  # sanitized: reason class only
