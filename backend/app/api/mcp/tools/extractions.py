"""get_extractions: the blind-aware extraction-data read tool (task 8b).

Validation, ownership and default-format resolution live here; every value
read is delegated to `extraction_agent_read_service.list_agent_extractions`,
which is the ONE place blind review is applied (never re-implemented at this
layer)."""

from __future__ import annotations

from typing import Literal, cast
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.api.mcp.asgi_auth import current_principal
from app.api.mcp.errors import McpErrorCode, McpToolError
from app.api.mcp.server import agent_tool
from app.schemas.mcp_extractions import McpExtractionsPage
from app.services.article_read_service import owned_article
from app.services.extraction_agent_read_service import list_agent_extractions
from app.services.project_template_active_service import owned_template
from app.utils.opaque_cursor import InvalidCursorError

_LIMIT_MIN = 1
_LIMIT_MAX = 10
_FORMATS = ("concise", "detailed")


@agent_tool(
    requires="read",
    project_arg="project_id",
    title="Get extractions",
    description=(
        "Review data extractions for a template: one current run per article, values keyed by "
        "field_id. concise = article x question matrix; detailed = per-field value, decider and "
        "evidence. Blind review applies: peer_values_hidden=true means other reviewers' values "
        "are withheld from you, not that none exist. Paged by next_cursor."
    ),
)
async def get_extractions(
    db: AsyncSession,
    project_id: UUID,
    template_id: UUID,
    article_id: UUID | None = None,
    response_format: str | None = None,
    cursor: str | None = None,
    limit: int = 10,
) -> McpExtractionsPage:
    if not _LIMIT_MIN <= limit <= _LIMIT_MAX:
        raise McpToolError(
            McpErrorCode.INVALID_ARGUMENT, "limit must be between 1 and 10", field="limit"
        )
    if response_format is not None and response_format not in _FORMATS:
        raise McpToolError(
            McpErrorCode.INVALID_ARGUMENT,
            'response_format must be "concise" or "detailed"',
            field="response_format",
        )
    fmt = response_format or ("detailed" if article_id is not None else "concise")

    # ProjectTemplateNotFoundError / ArticleNotFoundError propagate: the dispatcher answers NOT_FOUND.
    template = await owned_template(db, project_id=project_id, template_id=template_id)
    if article_id is not None:
        await owned_article(db, project_id=project_id, article_id=article_id)

    try:
        return await list_agent_extractions(
            db,
            project_id=project_id,
            template_id=template_id,
            template_kind=template.kind,
            caller_id=current_principal().user_sub,
            article_id=article_id,
            response_format=cast(Literal["concise", "detailed"], fmt),
            cursor=cursor,
            limit=limit,
        )
    except InvalidCursorError as exc:
        raise McpToolError(
            McpErrorCode.INVALID_ARGUMENT, "cursor is not valid; restart without it", field="cursor"
        ) from exc
