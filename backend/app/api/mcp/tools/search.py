"""search_project_text: keyword search over a project's parsed article text
(spec §5.1). Body only validates arguments and resolves an optional
`article_id`'s ownership; the query itself lives in
`article_text_search_service.search_project_text`."""

from __future__ import annotations

from typing import Annotated
from uuid import UUID

from pydantic import Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.mcp.errors import McpErrorCode, McpToolError
from app.api.mcp.server import agent_tool
from app.schemas.mcp_search import McpSearchResult
from app.services.article_read_service import owned_article
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
        "article file, each with its hits (page, block locator, snippet). The 'simple' config "
        "does not stem or strip accents: try variant spellings (plural, pt/en, accented). "
        "Call get_article_text with the row's article_id and the hit's page next."
    ),
)
async def search_project_text(
    db: AsyncSession,
    project_id: UUID,
    query: Annotated[str, Field(max_length=200)],
    article_id: UUID | None = None,
    cursor: str | None = None,
) -> McpSearchResult:
    if article_id is not None:
        # A foreign or missing article_id raises ArticleNotFoundError: the dispatcher maps it to NOT_FOUND.
        await owned_article(db, project_id=project_id, article_id=article_id)
    try:
        return await run_project_text_search(
            db, project_id=project_id, query=query, article_id=article_id, cursor=cursor
        )
    except InvalidCursorError as exc:
        raise McpToolError(
            McpErrorCode.INVALID_ARGUMENT, "cursor is not valid; restart without it", field="cursor"
        ) from exc
