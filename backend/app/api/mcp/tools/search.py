"""search_project_text: keyword search over a project's parsed article text
(spec §5.1). Body only validates arguments and resolves an optional
`article_id`'s ownership; the query itself lives in
`article_text_search_service.search_project_text`."""

from __future__ import annotations

from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.api.mcp.errors import McpErrorCode, McpToolError
from app.api.mcp.server import agent_tool
from app.schemas.mcp_search import McpSearchResult
from app.services.article_read_service import owned_article
from app.services.article_text_search_service import (
    search_project_text as run_project_text_search,
)
from app.utils.opaque_cursor import InvalidCursorError

_QUERY_CAP = 200


@agent_tool(
    requires="read",
    project_arg="project_id",
    title="Search project text",
    description=(
        "Keyword search over the parsed text of a project's articles; returns hits with "
        "article, page, block locator and a snippet. The 'simple' config does not stem or "
        "strip accents: try variant spellings (plural, pt/en, accented). Call "
        "get_article_text with the hit's article_id and page next."
    ),
)
async def search_project_text(
    db: AsyncSession,
    project_id: UUID,
    query: str,
    article_id: UUID | None = None,
    cursor: str | None = None,
) -> McpSearchResult:
    if len(query) > _QUERY_CAP:
        raise McpToolError(
            McpErrorCode.INVALID_ARGUMENT, "query is capped at 200 characters", field="query"
        )
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
