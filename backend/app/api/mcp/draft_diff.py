"""The MCP view of a template's draft diff, bounded so the tool result that
carries it stays inside the 32,000-char result cap. Shared by
``get_template`` and ``edit_template_draft``.

Rows are kept tier by tier while they fit BOTH ``DIFF_ROW_CAP`` and a
character budget measured with ``compact_json`` -- the same rendering the
cap is measured on (non-ASCII raw, one char each; quotes, backslashes and
control characters escaped). Each before/after value is cut to 200 chars (a
boolean renders as ``"true"``/``"false"``) and each ``label_path`` element to
100 before measuring. Any dropped row sets ``changes_truncated``; ``counts``
and ``fingerprint`` always describe the full diff, so an agent pages every row
with ``get_template(view="changes")``."""

from __future__ import annotations

from app.schemas.hitl_session import TemplateChangeRowRead, TemplateConfigDiffRead
from app.schemas.mcp_templates import McpDraftChange, McpDraftDiff
from app.utils.compact_json import RESULT_CAP, compact_json
from app.utils.text_caps import cap_text

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
        McpDraftDiff(
            status=str(diff.status),
            counts=counts,
            changes=[],
            changes_truncated=False,
            fingerprint=diff.fingerprint,
        )
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
        status=str(diff.status),
        counts=counts,
        changes=changes,
        changes_truncated=truncated,
        fingerprint=diff.fingerprint,
    )


def _change(tier: str, row: TemplateChangeRowRead) -> McpDraftChange:
    return McpDraftChange(
        id=row.id,
        tier=tier,
        variant=str(row.variant),
        label_path=capped_labels(row.label_path),
        attribute=row.attribute,
        before=display_value(row.before),
        after=display_value(row.after),
    )


def capped_labels(label_path: list[str]) -> list[str]:
    """A row's ``label_path`` with each label cut to 100 chars."""
    return [cap_text(label, _LABEL_CAP)[0] for label in label_path]


def display_value(value: str | bool | None) -> str | None:
    """A row's before/after as MCP shows it: a boolean as ``"true"``/``"false"``,
    text cut to 200 chars."""
    if value is None:
        return None
    if isinstance(value, bool):
        return "true" if value else "false"
    return cap_text(value, _VALUE_CAP)[0]


def _json_len(model: McpDraftChange | McpDraftDiff) -> int:
    return len(compact_json(model.model_dump(mode="json")))
