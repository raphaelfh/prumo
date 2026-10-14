"""The MCP view of a template's draft diff, bounded so the tool result that
carries it stays inside the 32,000-char result cap. Shared by
``get_template`` and ``edit_template_draft``.

Rows are kept tier by tier while they fit BOTH ``DIFF_ROW_CAP`` and a
character budget measured with ``compact_json`` -- the same rendering the
cap is measured on (non-ASCII raw, one char each; quotes, backslashes and
control characters escaped). Each before/after value is cut to 200 chars and each
``label_path`` element to 100 before measuring. Any dropped row sets
``changes_truncated``; ``counts`` always reports the full diff."""

from __future__ import annotations

from app.schemas.hitl_session import TemplateChangeRowRead, TemplateConfigDiffRead
from app.schemas.mcp_templates import McpDraftChange, McpDraftDiff
from app.utils.compact_json import RESULT_CAP, compact_json

DIFF_ROW_CAP = 40
DIFF_CHAR_BUDGET = RESULT_CAP // 2
"""Default diff budget: half the result cap, the rest left to the envelope."""
_TIER_ORDER = ("additive", "cosmetic", "semantic", "destructive")
_VALUE_CAP = 200
_LABEL_CAP = 100
_ITEM_SEPARATOR = len(", ")


def capped_diff(diff: TemplateConfigDiffRead, *, budget: int = DIFF_CHAR_BUDGET) -> McpDraftDiff:
    """The diff with at most ``DIFF_ROW_CAP`` rows whose ``compact_json``
    rendering is at most ``budget`` chars (rows that do not fit are dropped,
    in order, and ``changes_truncated`` is set)."""
    buckets = {
        "additive": diff.changes.additive,
        "cosmetic": diff.changes.cosmetic,
        "semantic": diff.changes.semantic,
        "destructive": diff.changes.destructive,
    }
    counts = {tier: len(rows) for tier, rows in buckets.items()}
    # Measured with `changes_truncated=False`: "false" is the longer literal.
    used = _json_len(
        McpDraftDiff(status=str(diff.status), counts=counts, changes=[], changes_truncated=False)
    )
    changes: list[McpDraftChange] = []
    truncated = False
    for tier in _TIER_ORDER:
        for row in buckets[tier]:
            change = _change(tier, row)
            cost = _json_len(change) + (_ITEM_SEPARATOR if changes else 0)
            if len(changes) >= DIFF_ROW_CAP or used + cost > budget:
                truncated = True
                break
            changes.append(change)
            used += cost
        if truncated:
            break
    return McpDraftDiff(
        status=str(diff.status), counts=counts, changes=changes, changes_truncated=truncated
    )


def _change(tier: str, row: TemplateChangeRowRead) -> McpDraftChange:
    return McpDraftChange(
        tier=tier,
        variant=str(row.variant),
        label_path=[label[:_LABEL_CAP] for label in row.label_path],
        attribute=row.attribute,
        before=_trunc(row.before),
        after=_trunc(row.after),
    )


def _json_len(model: McpDraftChange | McpDraftDiff) -> int:
    return len(compact_json(model.model_dump(mode="json")))


def _trunc(value: str | bool | None) -> str | None:
    if value is None:
        return None
    return str(value)[:_VALUE_CAP]
