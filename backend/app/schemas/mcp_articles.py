"""Result models for the researcher MCP article read tools (`list_articles`,
`get_article`, task 6b). Each is the exact `outputSchema` of its tool: no
field beyond what the model needs."""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel


class McpArticleRow(BaseModel):
    article_id: UUID
    title: str
    authors: list[str]
    authors_total: int
    year: int | None
    text_status: str | None
    removed_at_source: bool
    has_pdf: bool
    has_text: bool


class McpArticleList(BaseModel):
    articles: list[McpArticleRow]
    next_cursor: str | None
    untrusted_content: bool = True


class McpOutlineHeading(BaseModel):
    page: int
    block_index: int
    text: str


class McpFileOutline(BaseModel):
    article_file_id: UUID
    page_count: int
    block_count: int
    headings: list[McpOutlineHeading]
    headings_truncated: bool


class McpArticleFileRow(BaseModel):
    article_file_id: UUID
    role: str | None
    file_type: str
    original_filename: str | None
    extraction_status: str | None
    created_at: datetime


class McpArticleDetail(BaseModel):
    article_id: UUID
    project_id: UUID
    title: str
    authors: list[str]
    year: int | None
    journal_title: str | None
    doi: str | None
    pmid: str | None
    publication_status: str | None
    removed_at_source: bool
    abstract: str | None
    abstract_truncated: bool
    files: list[McpArticleFileRow]
    outline: McpFileOutline | None
    untrusted_content: bool = True
