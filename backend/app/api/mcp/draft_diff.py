"""The MCP view of a template's draft diff: at most ``DIFF_ROW_CAP`` rows,
tier by tier, each before/after value cut to 200 chars. Shared by
``get_template`` and ``edit_template_draft`` so both stay inside the
32,000-char result cap."""

from __future__ import annotations

from app.schemas.hitl_session import TemplateConfigDiffRead
from app.schemas.mcp_templates import McpDraftChange, McpDraftDiff

DIFF_ROW_CAP = 40
_TIER_ORDER = ("additive", "cosmetic", "semantic", "destructive")
_VALUE_CAP = 200


def capped_diff(diff: TemplateConfigDiffRead) -> McpDraftDiff:
    buckets = {
        "additive": diff.changes.additive,
        "cosmetic": diff.changes.cosmetic,
        "semantic": diff.changes.semantic,
        "destructive": diff.changes.destructive,
    }
    counts = {tier: len(rows) for tier, rows in buckets.items()}
    changes: list[McpDraftChange] = []
    truncated = False
    for tier in _TIER_ORDER:
        for row in buckets[tier]:
            if len(changes) >= DIFF_ROW_CAP:
                truncated = True
                break
            changes.append(
                McpDraftChange(
                    tier=tier,
                    variant=str(row.variant),
                    label_path=row.label_path,
                    attribute=row.attribute,
                    before=_trunc(row.before),
                    after=_trunc(row.after),
                )
            )
        if truncated:
            break
    return McpDraftDiff(
        status=str(diff.status), counts=counts, changes=changes, changes_truncated=truncated
    )


def _trunc(value: str | bool | None) -> str | None:
    if value is None:
        return None
    return str(value)[:_VALUE_CAP]
