"""Validated bound coordinates of a durable extraction attempt."""

from uuid import UUID

from pydantic import BaseModel, ConfigDict


class AttemptScope(BaseModel):
    model_config = ConfigDict(extra="forbid")

    project_id: UUID
    article_id: UUID
    template_id: UUID
    run_id: UUID
