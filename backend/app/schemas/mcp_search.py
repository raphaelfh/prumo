"""Result models for `search_project_text` and `get_article_pdf` (spec §5.1,
task 7b). Each `Mcp*Result` is the exact `outputSchema` of its tool."""

from __future__ import annotations

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel


class McpSearchHit(BaseModel):
    article_id: UUID
    title: str
    title_truncated: bool
    article_file_id: UUID
    page: int
    block_id: UUID
    block_index: int
    block_type: str
    locator: str
    snippet: str


class McpSearchResult(BaseModel):
    hits: list[McpSearchHit]
    next_cursor: str | None
    note: str | None
    untrusted_content: bool = True


class McpPdfLink(BaseModel):
    url: str
    expires_at: datetime
    filename: str
    size: int | None


class McpArticlePdfResult(BaseModel):
    pdf: McpPdfLink | None
    reason: Literal["no_pdf"] | None
    next_step: str | None
