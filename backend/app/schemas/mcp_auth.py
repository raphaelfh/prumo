"""The MCP principal (spec §3, ADR 0020)."""

from __future__ import annotations

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict


class McpPrincipal(BaseModel):
    """The verified PAT principal for one ``/mcp`` request.

    ``user_sub`` comes from the token row, never request input (ADR 0020):
    a PAT carries no caller-supplied identity to impersonate.
    """

    model_config = ConfigDict(frozen=True)

    user_sub: UUID
    token_id: UUID
    scope: Literal["read", "read_write"]
    token_expires_at: datetime
    project_ids: frozenset[UUID] | None
    """The token's project restriction; ``None`` = every project of its user.
    Required: an omitted field must never widen a token to every project."""

    def reaches(self, project_id: UUID) -> bool:
        """THE token-restriction predicate (membership is checked separately)."""
        return self.project_ids is None or project_id in self.project_ids
