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


def _labels(codes: list[str], options: dict[str, str]) -> list[str] | None:
    labels = [options.get(code, code) for code in codes]
    return labels if labels != codes else None


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
        codes = [str(c) for c in value["selected"] if c is not None]
        texts = [str(t) for t in value.get("other_texts") or [] if t]
        other, truncated = _capped("; ".join(texts), text_cap)
        return McpValue(
            value=codes,
            label=_labels(codes, field.options),
            other_text=other or None,
            truncated=truncated or None,
        )

    if isinstance(value, list):
        codes = [str(c) for c in value if c is not None]
        return McpValue(value=codes, label=_labels(codes, field.options))

    if isinstance(value, bool | int | float):
        return McpValue(value=value)

    if isinstance(value, str):
        label = field.options.get(value)
        if label is not None and label != value:
            return McpValue(value=value, label=label)

    text, truncated = _capped(str(value), text_cap)
    return McpValue(value=text, truncated=truncated or None)
