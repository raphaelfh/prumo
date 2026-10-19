"""get_template's `changes` view: every row Publish would apply, paged.

Rows are flattened destructive, semantic, additive, cosmetic (most at stake
first) and cut into pages that fit the 32,000-char result cap, measured on
the same ``compact_json`` rendering as the cap. The cursor is
``[fingerprint[:12], offset]``: a draft that moved between two pages changes
the fingerprint, so a stale cursor is refused instead of silently skipping
or repeating rows."""

from __future__ import annotations

from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.api.mcp.draft_diff import capped_labels, display_value
from app.api.mcp.errors import McpErrorCode, McpToolError
from app.schemas.hitl_session import TemplateChangeRowRead, TemplateConfigDiffRead
from app.schemas.mcp_templates import McpTemplateChangeRow, McpTemplateView
from app.services.template_versioning import get_template_config_diff
from app.utils.compact_json import RESULT_CAP, compact_json
from app.utils.opaque_cursor import (
    CURSOR_RESERVE,
    InvalidCursorError,
    cursor_position,
    decode_cursor,
    encode_cursor,
)

_TIER_ORDER = ("destructive", "semantic", "additive", "cosmetic")
_PREFIX = 12
_INVALID = "cursor is not valid; restart without it"
_STALE = "the draft changed; restart without cursor"


async def changes_view(
    db: AsyncSession,
    *,
    project_id: UUID,
    template_id: UUID,
    cursor: str | None,
    envelope: McpTemplateView,
) -> McpTemplateView:
    """`envelope` (sections empty) filled with one page of the draft's changes."""
    diff = await get_template_config_diff(db, project_id=project_id, template_id=template_id)
    page = envelope.model_copy(
        update={
            "fingerprint": diff.fingerprint,
            "status": str(diff.status),
            "counts": {tier: len(getattr(diff.changes, tier)) for tier in _TIER_ORDER},
            "changes": [],
            "note": _note(diff),
        }
    )
    budget = max(1, RESULT_CAP - _json_len(page) - CURSOR_RESERVE)
    rows, nxt = page_changes(diff, cursor, budget=budget)
    return page.model_copy(update={"changes": rows, "next_cursor": nxt})


def page_changes(
    diff: TemplateConfigDiffRead, cursor: str | None, *, budget: int
) -> tuple[list[McpTemplateChangeRow], str | None]:
    """The rows from the cursor's offset that fit `budget` (at least one, so
    paging always progresses), and the next cursor (None on the last page)."""
    rows = [_row(tier, row) for tier in _TIER_ORDER for row in getattr(diff.changes, tier)]
    start = _validated_offset(cursor, diff.fingerprint, len(rows))
    out: list[McpTemplateChangeRow] = []
    used = 0
    for offset in range(start, len(rows)):
        cost = _json_len(rows[offset]) + 2  # + the ", " joining it to its neighbour
        if out and used + cost > budget:
            assert diff.fingerprint is not None  # rows exist only for an available diff
            return out, encode_cursor([diff.fingerprint[:_PREFIX], offset])
        out.append(rows[offset])
        used += cost
    return out, None


def _validated_offset(cursor: str | None, fingerprint: str | None, row_count: int) -> int:
    try:
        raw = decode_cursor(cursor, arity=2)
        if raw is None:
            return 0
        offset = cursor_position(raw[1])
    except InvalidCursorError as exc:
        raise McpToolError(McpErrorCode.INVALID_ARGUMENT, _INVALID, field="cursor") from exc
    if fingerprint is None or raw[0] != fingerprint[:_PREFIX]:
        raise McpToolError(McpErrorCode.INVALID_ARGUMENT, _STALE, field="cursor")
    if offset >= row_count:
        raise McpToolError(McpErrorCode.INVALID_ARGUMENT, _INVALID, field="cursor")
    return offset


def _row(tier: str, row: TemplateChangeRowRead) -> McpTemplateChangeRow:
    return McpTemplateChangeRow(
        id=row.id,
        tier=tier,
        variant=str(row.variant),
        label_path=capped_labels(row.label_path),
        attribute=row.attribute,
        before=display_value(row.before),
        after=display_value(row.after),
        affects_recorded_data=row.affects_recorded_data,
        affects_ai=row.affects_ai,
    )


def _note(diff: TemplateConfigDiffRead) -> str | None:
    # `fingerprint` is None exactly for initial_version and baseline_too_old.
    if diff.fingerprint is not None:
        return None
    return (
        f"No row-by-row changes are available: the diff status is {diff.status}, "
        "so there is no comparable published version."
    )


def _json_len(model: McpTemplateView | McpTemplateChangeRow) -> int:
    return len(compact_json(model.model_dump(mode="json")))
