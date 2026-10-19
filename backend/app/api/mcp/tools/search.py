"""search_project_text: keyword search over a project's parsed article text
(spec §5.1). Body only validates arguments and resolves an optional
`article_id`'s ownership; the query itself lives in
`article_text_search_service.search_project_text`."""

from __future__ import annotations

from typing import Annotated, Literal
from uuid import UUID

from pydantic import Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.mcp.errors import McpErrorCode, McpToolError
from app.api.mcp.server import agent_tool
from app.schemas.mcp_search import BlockTypeLiteral, McpSearchResult
from app.services.article_read_service import owned_article
from app.services.article_text_search_service import (
    EmptySearchQueryError,
)
from app.services.article_text_search_service import (
    search_project_text as run_project_text_search,
)
from app.utils.opaque_cursor import InvalidCursorError


@agent_tool(
    requires="read",
    project_arg="project_id",
    title="Search project text",
    destructive=False,
    description=(
        "Keyword search over the parsed text of a project's articles; returns one row per "
        "article file, each with its hits (page, block locator, snippet). Words are ANDed; "
        '"quoted phrase", or and -term work; & and ! are ignored; no stemming or accent '
        "folding. Try variant spellings (plural, pt/en, accented). "
        "Call get_article_text with the row's article_id and the hit's page next. "
        "group_by='article' returns one row per article instead, with its hit_count, top "
        "locators and best snippet. exclude_references (on by default) skips hits under a "
        "References or Bibliography heading and says so when that hid every hit. "
        "block_types limits hits to those block types (e.g. ['table_cell'])."
    ),
)
async def search_project_text(
    db: AsyncSession,
    project_id: UUID,
    query: Annotated[str, Field(max_length=200)],
    article_id: UUID | None = None,
    cursor: str | None = None,
    group_by: Literal["block", "article"] = "block",
    exclude_references: bool = True,
    block_types: list[BlockTypeLiteral] | None = None,
) -> McpSearchResult:
    if article_id is not None:
        # A foreign or missing article_id raises ArticleNotFoundError: the dispatcher maps it to NOT_FOUND.
        await owned_article(db, project_id=project_id, article_id=article_id)
    try:
        return await run_project_text_search(
            db,
            project_id=project_id,
            query=query,
            article_id=article_id,
            cursor=cursor,
            group_by=group_by,
            exclude_references=exclude_references,
            block_types=block_types,
        )
    except EmptySearchQueryError as exc:
        raise McpToolError(
            McpErrorCode.INVALID_ARGUMENT, "the query has no searchable terms", field="query"
        ) from exc
    except InvalidCursorError as exc:
        raise McpToolError(
            McpErrorCode.INVALID_ARGUMENT, "cursor is not valid; restart without it", field="cursor"
        ) from exc
