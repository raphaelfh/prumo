"""Result models for `search_project_text` and `get_article_pdf` (spec §5.1,
task 7b). Each `Mcp*Result` is the exact `outputSchema` of its tool."""

from __future__ import annotations

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel


class McpSearchHit(BaseModel):
    locator: str
    page: int
    block_index: int
    block_type: str
    snippet: str


class McpSearchArticle(BaseModel):
    """One article file's hits on this page, in rank order. An article whose
    hits span two files appears once per file."""

    article_id: UUID
    title: str
    title_truncated: bool
    file_id: UUID
    hits: list[McpSearchHit]


class McpSearchResult(BaseModel):
    articles: list[McpSearchArticle]
    next_cursor: str | None
    note: str | None
    untrusted_content: Literal[True] = True
    untrusted_fields: list[str] = [
        "articles[].title",
        "articles[].hits[].snippet",
    ]


class McpPdfLink(BaseModel):
    url: str
    expires_at: datetime
    filename: str
    size: int | None


class McpArticlePdfResult(BaseModel):
    pdf: McpPdfLink | None
    reason: Literal["no_pdf"] | None
    next_step: str | None
    untrusted_content: Literal[True] = True
    untrusted_fields: list[str] = [
        "pdf.filename",
    ]
