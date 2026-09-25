"""list_articles / get_article: the article read tools (task 6b).

`get_article` resolves `file_id` (or the latest PDF) via
`article_read_service.resolve_article_file`, THE article-file-in-article
guard: a foreign or missing `file_id` raises `ArticleFileNotFoundError`,
which the dispatcher maps to NOT_FOUND.
"""

from __future__ import annotations

from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.api.mcp.errors import McpErrorCode, McpToolError
from app.api.mcp.server import agent_tool
from app.schemas.mcp_articles import McpArticleDetail, McpArticleList
from app.services import article_list_read_service, article_read_service
from app.services.article_text_block_read_service import get_file_outline
from app.utils.compact_json import RESULT_CAP, compact_json
from app.utils.opaque_cursor import InvalidCursorError
from app.utils.untrusted import wrap_untrusted

_QUERY_CAP = 200
_LIMIT_MIN = 1
_LIMIT_MAX = 50


@agent_tool(
    requires="read",
    project_arg="project_id",
    title="List articles",
    description=(
        "List a project's articles (title, authors, year, text_status, has_pdf, has_text), "
        "ordered by title. Page with next_cursor. Call get_article next."
    ),
)
async def list_articles(
    db: AsyncSession,
    project_id: UUID,
    query: str | None = None,
    has_pdf: bool | None = None,
    has_text: bool | None = None,
    cursor: str | None = None,
    limit: int = 25,
) -> McpArticleList:
    if query is not None and len(query) > _QUERY_CAP:
        raise McpToolError(
            McpErrorCode.INVALID_ARGUMENT, "query is capped at 200 characters", field="query"
        )
    if not _LIMIT_MIN <= limit <= _LIMIT_MAX:
        raise McpToolError(
            McpErrorCode.INVALID_ARGUMENT, "limit must be between 1 and 50", field="limit"
        )
    try:
        return await article_list_read_service.list_project_articles(
            db,
            project_id=project_id,
            query=query,
            has_pdf=has_pdf,
            has_text=has_text,
            cursor=cursor,
            limit=limit,
        )
    except InvalidCursorError as exc:
        raise McpToolError(
            McpErrorCode.INVALID_ARGUMENT, "cursor is not valid; restart without it", field="cursor"
        ) from exc


@agent_tool(
    requires="read",
    project_arg="article_id",
    title="Get article",
    description=(
        "Return an article's metadata, abstract, files and the outline of file_id or, "
        "without it, of the latest PDF. Call get_article_text or get_article_pdf next."
    ),
)
async def get_article(
    db: AsyncSession, article_id: UUID, file_id: UUID | None = None
) -> McpArticleDetail:
    detail = await article_list_read_service.get_article_detail(db, article_id=article_id)
    extraction_status = await article_list_read_service.article_template_status(
        db, project_id=detail.project_id, article_id=article_id
    )
    # A foreign or missing file_id raises ArticleFileNotFoundError: the dispatcher maps it to NOT_FOUND.
    file = await article_read_service.resolve_article_file(
        db, article_id=article_id, file_id=file_id
    )
    outline = await get_file_outline(db, article_file_id=file.id) if file is not None else None
    if outline is not None:
        # Headings are PDF-derived text (spec §5.0): wrapped like the
        # abstract. The length cap already ran in get_file_outline, on the
        # RAW heading text -- wrapping here, after that cap, keeps the
        # delimiters from eating into it.
        outline = outline.model_copy(
            update={
                "headings": [
                    heading.model_copy(update={"text": wrap_untrusted(heading.text)})
                    for heading in outline.headings
                ]
            }
        )
    return _fit_outline(
        detail.model_copy(
            update={
                "abstract": wrap_untrusted(detail.abstract) if detail.abstract else None,
                "outline": outline,
                "extraction_status": extraction_status,
            }
        )
    )


def _json_len(value: object) -> int:
    return len(compact_json(value))


def _fit_outline(detail: McpArticleDetail) -> McpArticleDetail:
    """Drop trailing outline headings until the result fits `RESULT_CAP`.

    Each field is capped on its own, but their CJK worst cases (every char a
    6-char escape) still sum past the cap; the outline is the one part with
    a truncation flag and a follow-up read (`get_article_text`), so it gives
    way. Measured like the dispatcher renders it: `compact_json` of the
    by-alias dump."""
    over = _json_len(detail.model_dump(mode="json", by_alias=True)) - RESULT_CAP
    if over <= 0 or detail.outline is None or not detail.outline.headings:
        return detail
    headings = list(detail.outline.headings)
    while over > 0 and headings:
        # a list item costs its own rendering plus the ", " separator
        over -= _json_len(headings.pop().model_dump(mode="json", by_alias=True)) + 2
    outline = detail.outline.model_copy(update={"headings": headings, "headings_truncated": True})
    return detail.model_copy(update={"outline": outline})
