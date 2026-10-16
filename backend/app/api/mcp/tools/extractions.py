"""get_extractions: the blind-aware extraction-data read tool (task 8b).

Validation, ownership and default-format resolution live here; every value
read is delegated to `extraction_agent_read_service.list_agent_extractions`,
which is the ONE place blind review is applied (never re-implemented at this
layer)."""

from __future__ import annotations

from typing import Annotated, Literal
from uuid import UUID

from pydantic import Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.mcp.asgi_auth import current_principal
from app.api.mcp.errors import McpErrorCode, McpToolError
from app.api.mcp.server import agent_tool
from app.schemas.mcp_extractions import McpExtractionsPage
from app.services.article_read_service import owned_article
from app.services.extraction_agent_read_service import list_agent_extractions
from app.services.project_template_active_service import owned_template
from app.utils.opaque_cursor import InvalidCursorError


@agent_tool(
    requires="read",
    project_arg="project_id",
    title="Get extractions",
    destructive=False,
    description=(
        "Review data extractions for a template: one current run per article, values keyed by "
        "field_id. concise = article x question matrix; detailed = per-field value, decider and "
        "evidence. Blind review applies: peer_values_hidden=true means other reviewers' values "
        "are withheld from you, not that none exist. Paged by next_cursor. Each value is "
        "{value, label?, unit?, absent_reason?, other_text?, truncated?}: value is the stored "
        "code or number (null when empty or marked absent); label is the option's display text "
        "when it differs from the code; absent_reason is no_information, not_applicable or "
        "not_evaluated."
    ),
)
async def get_extractions(
    db: AsyncSession,
    project_id: UUID,
    template_id: UUID,
    article_id: UUID | None = None,
    response_format: Literal["concise", "detailed"] | None = None,
    cursor: str | None = None,
    limit: Annotated[int, Field(ge=1, le=10)] = 10,
) -> McpExtractionsPage:
    fmt: Literal["concise", "detailed"] = response_format or (
        "detailed" if article_id is not None else "concise"
    )

    # ProjectTemplateNotFoundError / ArticleNotFoundError propagate: the dispatcher answers NOT_FOUND.
    template = await owned_template(db, project_id=project_id, template_id=template_id)
    if article_id is not None:
        await owned_article(db, project_id=project_id, article_id=article_id)

    try:
        return await list_agent_extractions(
            db,
            project_id=project_id,
            template_id=template_id,
            template_name=template.name,
            template_kind=template.kind,
            caller_id=current_principal().user_sub,
            article_id=article_id,
            response_format=fmt,
            cursor=cursor,
            limit=limit,
        )
    except InvalidCursorError as exc:
        raise McpToolError(
            McpErrorCode.INVALID_ARGUMENT, "cursor is not valid; restart without it", field="cursor"
        ) from exc
