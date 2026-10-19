"""Schemas for the ``/api/v1/oauth`` consent routes and the
``/api/v1/me/oauth-connections`` connected-apps routes (ADR 0022).

Class docstrings and ``Field(description=...)`` are published in
``openapi.json``.
"""

from __future__ import annotations

from datetime import datetime
from enum import StrEnum
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.personal_access_token import TokenScope, TokenStatus


class OAuthConsentRefusalCode(StrEnum):
    """Why a consent route refused.

    409 ``REQUEST_ALREADY_DECIDED``: the request was already approved or
    denied (in this tab, another tab, or by a concurrent approval for the same
    app). Slice-local, like ``PersonalAccessTokenRefusalCode``.
    """

    REQUEST_ALREADY_DECIDED = "REQUEST_ALREADY_DECIDED"


class OAuthConsentRequestRead(BaseModel):
    """A pending authorization request, as the consent page shows it."""

    client_name: str = Field(description="The name the app registered with.")
    redirect_host: str = Field(
        description="Host (and port, when present) the app's redirect URI points at."
    )
    requested_scopes: list[str] = Field(
        description="The scopes the app asked for; always includes `read`."
    )
    offers_write: bool = Field(
        description="True when the app asked for `write`, so the page may offer it."
    )
    offers_ai_run: bool = Field(
        description=(
            "True when the app asked for `ai_run`, so the page may offer it "
            "(a separate box, unchecked by default)."
        )
    )
    expires_at: datetime = Field(description="When the request stops accepting a decision.")


class OAuthConsentDecisionRequest(BaseModel):
    """Body of ``POST /api/v1/oauth/requests/{request_id}/decision``."""

    model_config = ConfigDict(extra="forbid")

    approve: bool = Field(description="True to connect the app, false to deny it.")
    write: bool = Field(
        description=(
            "Grant `write` too. Ignored on a deny and on a request that did not ask for it."
        )
    )
    ai_run: bool = Field(
        default=False,
        description=(
            "Grant `ai_run` too. Ignored on a deny and on a request that did not ask for it."
        ),
    )


class OAuthConsentDecisionRead(BaseModel):
    """Where the browser goes next: back to the app, with a code or an error."""

    redirect_url: str = Field(description="The app's redirect URI with the decision's query.")


class OAuthConsentRefusalError(BaseModel):
    code: OAuthConsentRefusalCode
    message: str


class OAuthConsentRefusalResponse(BaseModel):
    """The 409 (``REQUEST_ALREADY_DECIDED``) body, declared so the generated
    client types the refusal."""

    ok: bool = False
    error: OAuthConsentRefusalError
    trace_id: str | None = None


class OAuthConnectionRead(BaseModel):
    """An app the user connected through OAuth; never carries a token."""

    id: UUID
    client_name: str = Field(description="The name the app registered with.")
    scope: TokenScope = Field(description="What the user granted the app.")
    ai_run: bool = Field(description="Whether the user let the app start AI extraction runs.")
    status: TokenStatus
    created_at: datetime = Field(description="When the user approved the app.")
    last_used_at: datetime | None = Field(description="Last time the app called `/mcp`.")
    expires_at: datetime = Field(
        description="When the connection ends unless the user approves the app again."
    )
