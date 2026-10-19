"""get_ai_runs and cancel_ai_run: reading and cancelling the caller's own AI
extraction runs (ADR 0021).

``get_ai_runs`` (``read``) lists or details the caller's own runs in a
project, UI- or agent-started; ``cancel_ai_run`` (``ai_run``) cancels one
through the one conditional cancel path, audited only when it applied.
"""

from __future__ import annotations

from dataclasses import replace
from datetime import UTC, datetime
from typing import Annotated, Any
from uuid import UUID

from pydantic import Field
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.mcp.asgi_auth import current_principal
from app.api.mcp.audit import AuditScope, record_applied_write, refuse
from app.api.mcp.errors import NOT_FOUND_MESSAGE, McpErrorCode, McpToolError, reject_nul
from app.api.mcp.server import agent_tool
from app.api.mcp.tools.ai_runs import title_text
from app.api.v1.endpoints._integrity import is_deadlock
from app.schemas.extraction_batch import ExtractionBatchDetail, ExtractionBatchSummary
from app.schemas.mcp_ai_runs import (
    McpAiRunAttentionItem,
    McpAiRunCancelled,
    McpAiRunDetail,
    McpAiRuns,
    McpAiRunSummary,
)
from app.services.extraction_batch_service import BatchNotFoundError, ExtractionBatchService
from app.services.project_read_service import project_name
from app.utils.opaque_cursor import (
    InvalidCursorError,
    cursor_position,
    decode_cursor,
    encode_cursor,
)
from app.utils.text_caps import cap_json_weight

_RUN_LIST_LIMIT = 20
_ATTENTION_PAGE = 50
_MESSAGE_WEIGHT = 300  # compact-JSON chars of one engine or stop message
_ATTENTION: frozenset[str] = frozenset(
    {"needs_attention", "done_with_issues", "skipped", "not_run"}
)


def _message(value: str | None) -> str | None:
    return None if value is None else cap_json_weight(value, _MESSAGE_WEIGHT)[0]


def _run_summary(summary: ExtractionBatchSummary) -> dict[str, Any]:
    return {
        "batch_id": summary.id,
        "template_name": title_text(summary.template_name),
        "state": summary.state,
        "stalled": summary.stalled,
        "started_by_agent": summary.started_by_agent,
        "agent_token_name": title_text(summary.agent_token_name)
        if summary.agent_token_name is not None
        else None,
        "created_at": summary.created_at,
        "finished_at": summary.finished_at,
        "counts": summary.counts,
        "stop_code": summary.stop_code,
        "stop_message": _message(summary.stop_message),
    }


def _in_flight(detail: ExtractionBatchDetail) -> int:
    return sum(1 for item in detail.items if item.outcome == "running")


def _not_found(exc: Exception) -> McpToolError:
    error = McpToolError(McpErrorCode.NOT_FOUND, NOT_FOUND_MESSAGE)
    error.__cause__ = exc
    return error


async def _run_detail(
    svc: ExtractionBatchService,
    owner_id: UUID,
    project_id: UUID,
    batch_id: UUID,
    cursor: str | None,
    now: datetime,
) -> McpAiRuns:
    try:
        decoded = decode_cursor(cursor, arity=1)
        offset = 0 if decoded is None else cursor_position(decoded[0])
    except InvalidCursorError as exc:
        raise McpToolError(
            McpErrorCode.INVALID_ARGUMENT, "cursor is not valid; restart without it", field="cursor"
        ) from exc
    try:
        detail, work = await svc.detail_with_work(
            owner_id, batch_id, now=now, project_id=project_id
        )
    except BatchNotFoundError as exc:
        raise _not_found(exc) from exc
    attention = [item for item in detail.items if item.outcome in _ATTENTION]
    end = offset + _ATTENTION_PAGE
    return McpAiRuns(
        mode="detail",
        project_id=project_id,
        project_name=title_text(detail.project_name),
        runs=[],
        run=McpAiRunDetail(
            **_run_summary(detail),
            suggestions_created=work.suggestions_created,
            tokens_used=work.tokens_used,
            attention_items=[
                McpAiRunAttentionItem(
                    article_id=item.article_id,
                    title=title_text(item.title),
                    outcome=item.outcome,  # type: ignore[arg-type]  # filtered by _ATTENTION
                    reason_code=item.reason_code,
                    message=_message(item.message),
                    failed_sections=item.failed_sections,
                    total_sections=item.total_sections,
                )
                for item in attention[offset:end]
            ],
            next_cursor=encode_cursor([end]) if end < len(attention) else None,
        ),
    )


@agent_tool(
    requires="read",
    project_arg="project_id",
    title="List or inspect your AI extraction runs",
    description=(
        "List the caller's own AI extraction runs in a project (started in prumo or by an "
        "agent), active first, or one run's detail with the articles that need attention. "
        "Owner-only. Check status only when the user asks; do not poll."
    ),
    destructive=False,
)
async def get_ai_runs(
    db: AsyncSession,
    project_id: UUID,
    batch_id: UUID | None = None,
    cursor: Annotated[str, Field(max_length=200)] | None = None,
) -> McpAiRuns:
    owner = current_principal().user_sub
    now = datetime.now(UTC)
    svc = ExtractionBatchService(db)
    if batch_id is not None:
        return await _run_detail(svc, owner, project_id, batch_id, cursor, now)
    summaries = await svc.list_for_owner(owner, project_id=project_id, active_only=False, now=now)
    # Stable sort: newest first within the active and the ended runs.
    ordered = sorted(summaries, key=lambda s: s.state != "active")[:_RUN_LIST_LIMIT]
    name = summaries[0].project_name if summaries else await project_name(db, project_id)
    return McpAiRuns(
        mode="list",
        project_id=project_id,
        project_name=title_text(name),
        runs=[McpAiRunSummary(**_run_summary(s)) for s in ordered],
        run=None,
    )


def _cancelled(detail: ExtractionBatchDetail, cancelled: int | None) -> McpAiRunCancelled:
    """``cancelled`` is ``None`` when this call cancelled nothing."""
    return McpAiRunCancelled(
        batch_id=detail.id,
        already_finished=cancelled is None,
        state=detail.state,
        cancelled_queued=cancelled or 0,
        in_flight_finishing=_in_flight(detail),
    )


async def _cancel(
    db: AsyncSession,
    svc: ExtractionBatchService,
    scope: AuditScope,
    first: ExtractionBatchDetail,
    now: datetime,
) -> McpAiRunCancelled:
    """The conditional cancel, its applied row and the commit; a run that
    already ended (or that a concurrent halt won) writes nothing. Every
    reply after the conditional write reads the run again."""
    owner = current_principal().user_sub
    if first.state == "finished":
        return _cancelled(first, None)
    try:
        cancelled = await svc.cancel(owner, first.id, now=now, project_id=scope.project_id)
        after = await svc.detail(owner, first.id, now=now, project_id=scope.project_id)
        if cancelled is None:  # a concurrent cancel or stop won the row
            return _cancelled(after, None)
        reply = _cancelled(after, cancelled)
        await record_applied_write(
            db,
            scope,
            before={"state": first.state},
            after={"batch_id": str(first.id), "cancelled_queued": cancelled},
        )
        await db.commit()  # inside the try: a deadlock here is an audited RETRY too
    except BatchNotFoundError as exc:
        raise _not_found(exc) from exc
    except DBAPIError as exc:
        if not is_deadlock(exc):
            raise  # INTERNAL_ERROR via the dispatcher: logged, no row
        raise McpToolError(
            McpErrorCode.RETRY, "A concurrent write won; nothing was cancelled."
        ) from exc
    return reply


@agent_tool(
    requires="ai_run",
    role="member",
    tier="ai_cancel",
    read_only=False,
    open_world=False,
    requires_user_interaction=False,
    destructive=False,
    idempotent=True,
    project_arg="project_id",
    title="Cancel an AI extraction run",
    description=(
        "Cancel one of the caller's own AI extraction runs: queued articles are not run; at "
        "most 2 in-flight articles finish. Safe to repeat."
    ),
)
async def cancel_ai_run(db: AsyncSession, project_id: UUID, batch_id: UUID) -> McpAiRunCancelled:
    owner = current_principal().user_sub
    now = datetime.now(UTC)
    svc = ExtractionBatchService(db)
    # The project's AI policy is never read: a cancel is always allowed.
    scope = AuditScope(
        tool="cancel_ai_run",
        project_id=project_id,
        template_id=None,
        input={"project_id": str(project_id), "batch_id": str(batch_id)},
    )
    try:
        reject_nul(scope.input)
        try:
            first = await svc.detail(owner, batch_id, now=now, project_id=project_id)
        except BatchNotFoundError as exc:
            raise _not_found(exc) from exc
        scope = replace(scope, template_id=first.template_id)
        reply = await _cancel(db, svc, scope, first, now)
    except McpToolError as error:
        await refuse(db, scope, error)
    return reply
