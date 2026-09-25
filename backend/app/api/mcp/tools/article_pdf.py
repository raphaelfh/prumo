"""get_article_pdf: a short-lived signed URL for an article's PDF (spec §5.1).

The signed URL is never logged: only ``mcp.tool_call``'s own attributes
(``tool``, ``token_id``, ``project_id``, ``outcome``) are set on the span,
and the tool body never calls the logger. The storage adapter comes only
from ``mcp_session.storage_factory()``, read through the module so a test's
monkeypatch on the attribute applies (never ``create_storage_adapter``
directly, and never a cached adapter across calls).
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Annotated
from uuid import UUID

from mcp.types import CallToolResult, ResourceLink, TextContent
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.mcp import session as mcp_session
from app.api.mcp.result_json import compact_json
from app.api.mcp.server import agent_tool
from app.schemas.mcp_search import McpArticlePdfResult, McpPdfLink
from app.services import article_read_service

_SIGNED_URL_TTL_SECONDS = 600


@agent_tool(
    requires="read",
    project_arg="article_id",
    title="Get article PDF link",
    description=(
        "Return a short-lived (10 min) signed URL for the article's PDF. Download it to read "
        "figures and tables. Chat-only clients should use get_article_text instead."
    ),
)
async def get_article_pdf(
    db: AsyncSession, article_id: UUID, file_id: UUID | None = None
) -> Annotated[CallToolResult, McpArticlePdfResult]:
    # A foreign or missing file_id raises ArticleFileNotFoundError: the dispatcher maps it to NOT_FOUND.
    file = await article_read_service.resolve_article_file(
        db, article_id=article_id, file_id=file_id
    )

    if file is None or file.file_type != "application/pdf":
        result = McpArticlePdfResult(
            pdf=None,
            reason="no_pdf",
            next_step="this article has no PDF; use get_article for metadata",
        )
        structured_content = result.model_dump(mode="json")
        return CallToolResult(
            content=[TextContent(type="text", text=compact_json(structured_content))],
            structured_content=structured_content,
        )

    url = await mcp_session.storage_factory().get_signed_url(
        "articles", file.storage_key, expires_in=_SIGNED_URL_TTL_SECONDS
    )
    expires_at = datetime.now(UTC) + timedelta(seconds=_SIGNED_URL_TTL_SECONDS)
    filename = file.original_filename or file.storage_key.rsplit("/", 1)[-1]
    result = McpArticlePdfResult(
        pdf=McpPdfLink(url=url, expires_at=expires_at, filename=filename, size=file.bytes),
        reason=None,
        next_step=None,
    )
    links = [
        ResourceLink(type="resource_link", uri=url, name=filename, mime_type="application/pdf")
    ]
    structured_content = result.model_dump(mode="json")
    return CallToolResult(
        content=[TextContent(type="text", text=compact_json(structured_content)), *links],
        structured_content=structured_content,
    )
