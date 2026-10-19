"""Result models for `search_project_text` and `get_article_pdf` (spec §5.1,
task 7b). Each `Mcp*Result` is the exact `outputSchema` of its tool."""

from __future__ import annotations

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field

#: The parser's closed block-type vocabulary (`infrastructure.parsing.base.BLOCK_TYPES`);
#: a unit test pins the parity.
BlockTypeLiteral = Literal[
    "paragraph",
    "heading",
    "list_item",
    "table_cell",
    "figure_caption",
    "figure",
    "header",
    "footer",
]


class McpSearchHit(BaseModel):
    locator: str
    page: int
    block_index: int
    block_type: str
    snippet: str


def _is_none(value: object) -> bool:
    return value is None


class McpSearchLocator(BaseModel):
    locator: str
    page: int
    block_index: int
    block_type: str
    file_id: UUID


class McpSearchArticle(BaseModel):
    """Block mode: one article file's hits on this page, in rank order (an
    article whose hits span two files appears once per file). Article mode:
    one row per article with its `hit_count`, top `locators` and best
    `snippet`; `file_id` is None and `hits` is empty. Block mode omits the
    article-mode fields from the payload."""

    article_id: UUID
    title: str
    title_truncated: bool
    file_id: UUID | None
    hits: list[McpSearchHit] = []
    hit_count: int | None = Field(default=None, exclude_if=_is_none)
    locators: list[McpSearchLocator] | None = Field(default=None, exclude_if=_is_none)
    snippet: str | None = Field(default=None, exclude_if=_is_none)


class McpSearchResult(BaseModel):
    articles: list[McpSearchArticle]
    next_cursor: str | None
    note: str | None
    references_excluded: bool
    untrusted_content: Literal[True] = True
    untrusted_fields: list[str] = [
        "articles[].title",
        "articles[].hits[].snippet",
        "articles[].snippet",
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
