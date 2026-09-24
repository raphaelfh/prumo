"""Schemas for the ``/api/v1/me/tokens`` personal access token routes.

Class docstrings and ``Field(description=...)`` are published in
``openapi.json``.
"""

from __future__ import annotations

from datetime import datetime
from enum import StrEnum
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

TokenScope = Literal["read", "read_write"]
"""``read`` allows only MCP read tools; ``read_write`` also allows write tools."""

TokenStatus = Literal["active", "expired", "revoked"]


class PersonalAccessTokenRefusalCode(StrEnum):
    """Why ``POST /api/v1/me/tokens`` returned 409.

    Slice-local, like ``TemplateDraftLockRefusalCode``
    (``app/schemas/hitl_session.py``): one endpoint's outcome, not part of
    the cross-cutting ``ApiErrorCode`` vocabulary.
    """

    TOKEN_LIMIT_REACHED = "TOKEN_LIMIT_REACHED"


class PersonalAccessTokenCreateRequest(BaseModel):
    """Body of ``POST /api/v1/me/tokens``."""

    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=80, description="Caller-chosen label for the token.")
    scope: TokenScope = Field(description="Which MCP tool tier the token may call.")
    expires_in_days: int = Field(
        ge=1, le=365, description="Token lifetime, in days, from creation."
    )


class PersonalAccessTokenRead(BaseModel):
    """A token row, never including the secret."""

    id: UUID
    name: str
    token_prefix: str = Field(
        description="First characters of the secret, shown for identification."
    )
    scope: TokenScope
    status: TokenStatus
    expires_at: datetime
    last_used_at: datetime | None
    revoked_at: datetime | None
    created_at: datetime


class PersonalAccessTokenCreated(BaseModel):
    """Response of ``POST /api/v1/me/tokens``.

    The only response that ever carries the secret: it is shown once, at
    creation, and never again — only its SHA-256 hash is stored.
    """

    token: PersonalAccessTokenRead
    secret: str = Field(description="The bearer secret. Shown once; store it now.")


class PersonalAccessTokenRefusalError(BaseModel):
    code: PersonalAccessTokenRefusalCode
    message: str


class PersonalAccessTokenRefusalResponse(BaseModel):
    """The 409 body, declared so the generated client types the refusal."""

    ok: bool = False
    error: PersonalAccessTokenRefusalError
    trace_id: str | None = None
