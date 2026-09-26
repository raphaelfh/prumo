"""Response of ``DELETE /api/v1/projects/{id}``."""

from __future__ import annotations

from uuid import UUID

from pydantic import BaseModel


class ProjectDeleteRead(BaseModel):
    """The id of the project that was deleted."""

    id: UUID
