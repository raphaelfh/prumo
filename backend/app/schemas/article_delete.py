"""Request and response of ``POST /api/v1/projects/{id}/articles/delete``."""

from __future__ import annotations

from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class ArticleIdsSelection(BaseModel):
    """An explicit list of article ids, all of which must belong to the project."""

    model_config = ConfigDict(extra="forbid")

    mode: Literal["ids"]
    ids: list[UUID] = Field(min_length=1, max_length=10_000)


ArticleSelection = Annotated[ArticleIdsSelection, Field(discriminator="mode")]


class ArticleDeleteRequest(BaseModel):
    """Which articles to delete: the whole selection is deleted or none of it is."""

    model_config = ConfigDict(extra="forbid")

    selection: ArticleSelection


class ArticleDeleteRead(BaseModel):
    """How many articles were deleted, and how many PDFs storage failed to remove."""

    deleted: int
    storage_failures: int
