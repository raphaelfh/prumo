"""Typed rendering of one stored extraction value for the researcher MCP
`get_extractions` detailed rows.

It peels the envelope with the export resolver's own `peel_envelope`, so the
two readers can never disagree on what a stored value holds, then types the
payload against the field the agent sees: numbers read as numbers (a whole
`22.0` or a legacy `"22"` reads `22`), select codes carry their option label
when it differs, absence markers read `value: null` plus the coded reason, and
long text is capped with `truncated: true`. Pure: no DB, no IO.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Any
from uuid import UUID

from app.schemas.mcp_extractions import McpValue
from app.services.exports.value_envelope import peel_envelope
from app.services.value_semantics import ABSENT_REASON_LABELS


@dataclass(frozen=True, slots=True)
class McpFieldInfo:
    """A field of the tree `get_extractions` reads: `options` maps each select
    code to its label; `unit` is the field's default unit."""

    field_id: UUID
    et_id: UUID
    label: str
    field_type: str
    options: dict[str, str]
    unit: str | None


def _capped(text: str, cap: int) -> tuple[str, bool]:
    return (text[:cap], True) if len(text) > cap else (text, False)


def _as_number(value: Any) -> int | float | None:
    """A finite number from a number or a numeric string, whole values as `int`;
    `None` for anything else (a bool is not a number)."""
    if isinstance(value, bool):
        return None
    if isinstance(value, str):
        try:
            value = float(value.strip())
        except ValueError:
            return None
    if isinstance(value, int):
        return value
    if isinstance(value, float) and math.isfinite(value):
        return int(value) if value.is_integer() else value
    return None


def _capped_list(items: list[str], cap: int) -> tuple[list[str], bool]:
    """Keep items while their total length stays within `cap`; the item that
    crosses it is cut to the remainder (dropped when nothing remains)."""
    kept: list[str] = []
    room = cap
    for item in items:
        if len(item) > room:
            if room:
                kept.append(item[:room])
            return kept, True
        kept.append(item)
        room -= len(item)
    return kept, False


def _codes_with_labels(
    codes: list[str], options: dict[str, str], cap: int
) -> tuple[list[str], list[str] | None, bool]:
    """Codes and (when any differs) their labels, each list capped to `cap`."""
    codes, codes_cut = _capped_list(codes, cap)
    labels = [options.get(code, code) for code in codes]
    if labels == codes:
        return codes, None, codes_cut
    labels, labels_cut = _capped_list(labels, cap)
    return codes, labels, codes_cut or labels_cut


def mcp_value(raw: Any, field: McpFieldInfo, *, text_cap: int) -> McpValue:
    peel = peel_envelope(raw)
    if peel.absent_reason is not None:
        return McpValue(
            value=None,
            absent_reason=peel.absent_reason,  # type: ignore[arg-type]
            label=ABSENT_REASON_LABELS[peel.absent_reason],
        )
    value = peel.value
    if value is None:
        return McpValue(value=None)

    if field.field_type == "number":
        number = _as_number(value)
        if number is not None:
            return McpValue(value=number, unit=peel.unit or field.unit)

    if isinstance(value, dict) and value.get("selected") == "other":
        other, truncated = _capped(str(value.get("other_text") or ""), text_cap)
        return McpValue(value="other", other_text=other or None, truncated=truncated or None)

    if isinstance(value, dict) and isinstance(value.get("selected"), list):
        codes, labels, codes_cut = _codes_with_labels(
            [str(c) for c in value["selected"] if c is not None], field.options, text_cap
        )
        texts = [str(t) for t in value.get("other_texts") or [] if t]
        other, other_cut = _capped("; ".join(texts), text_cap)
        return McpValue(
            value=codes,
            label=labels,
            other_text=other or None,
            truncated=(codes_cut or other_cut) or None,
        )

    if isinstance(value, list):
        codes, labels, truncated = _codes_with_labels(
            [str(c) for c in value if c is not None], field.options, text_cap
        )
        return McpValue(value=codes, label=labels, truncated=truncated or None)

    if isinstance(value, bool | int | float):
        return McpValue(value=value)

    if isinstance(value, str):
        label = field.options.get(value)
        if label is not None and label != value:
            code, code_cut = _capped(value, text_cap)
            label, label_cut = _capped(label, text_cap)
            return McpValue(value=code, label=label, truncated=(code_cut or label_cut) or None)

    text, truncated = _capped(str(value), text_cap)
    return McpValue(value=text, truncated=truncated or None)
