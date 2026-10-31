"""Typed export values: one projection of a stored envelope for every export surface.

``to_export_value`` classifies a stored value envelope against its field into an
``ExportValue`` (status plus typed columns); ``display_value`` renders it as the
matrix cell. PURE: no DB, no storage, no openpyxl. Lives directly under
``exports/`` (not ``exports/extraction/``): that package's ``__init__`` imports
the workbook, which imports the export service, so a runtime import from it
closes a cycle. The descriptors are therefore TYPE_CHECKING-only.
"""

from __future__ import annotations

import json
import math
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any, Literal
from uuid import UUID

from app.models.extraction import ExtractionFieldType
from app.services.value_contract import is_envelope
from app.services.value_semantics import (
    ABSENT_REASON_LABELS,
    strip_verification,
    value_absent_reason,
)

if TYPE_CHECKING:
    from app.services.exports.extraction.sheet_spec import CellValue
    from app.services.extraction_export_service import FieldDescriptor, SectionDescriptor

ExportStatus = Literal["answered", "absent", "rejected", "cleared", "nonconforming"]
OptionLabels = Mapping[tuple[UUID, str], str]  # (field_id, code) -> label


@dataclass(frozen=True, slots=True)
class PeeledValue:
    """A stored value envelope with every wrap removed: the inner payload,
    the envelope's unit (if any) and its coded absent reason (if a marker)."""

    value: Any
    unit: str | None
    absent_reason: str | None


def peel_envelope(raw: Any) -> PeeledValue:
    """The one envelope peel shared by the export resolver and the MCP renderer.

    Strips the ``verification`` annotation, then unwraps ``{"value": ...}``
    envelopes (legacy rows may be double-wrapped) while each level's keys stay
    within ``ENVELOPE_KEYS``. The outermost non-empty ``unit`` wins, as the
    write-time contract merges a double wrap. A closed-vocabulary marker at any
    level ends the peel with ``value=None``; an out-of-vocabulary reason is not
    a marker and peels like any other sibling.
    """
    unit: str | None = None
    while True:
        raw = strip_verification(raw)
        reason = value_absent_reason(raw)
        if reason is not None:
            return PeeledValue(value=None, unit=None, absent_reason=reason)
        if not is_envelope(raw):
            return PeeledValue(value=raw, unit=unit, absent_reason=None)
        if unit is None and isinstance(raw.get("unit"), str) and raw["unit"]:
            unit = raw["unit"]
        raw = raw["value"]


@dataclass(frozen=True, slots=True)
class ExportValue:
    raw: Any  # the stored envelope, untouched
    status: ExportStatus
    value_num: int | float | None = None
    value_text: str | None = None
    value_bool: bool | None = None
    value_label: str | None = None
    unit: str | None = None  # the ENVELOPE's unit only (D9)
    other_text: str | None = None
    absent_code: str | None = None
    out_of_scope: bool = False


def build_option_labels(active: Sequence[SectionDescriptor]) -> OptionLabels:
    return {
        (f.field_id, av.value): av.label
        for s in active
        for f in s.fields
        for av in f.allowed_values
    }


def _parse_finite_number(payload: Any) -> int | float | None:
    if isinstance(payload, bool):
        return None
    if isinstance(payload, (int, float)):
        return payload if math.isfinite(payload) else None
    if isinstance(payload, str):
        for parse in (int, float):
            try:
                num = parse(payload)
            except ValueError:
                continue
            return num if math.isfinite(num) else None
    return None


def _nonconforming(raw: Any, payload: Any) -> ExportValue:
    if isinstance(payload, (dict, list)):
        text = json.dumps(payload, sort_keys=True, ensure_ascii=False)
    else:
        text = str(payload)
    return ExportValue(raw=raw, status="nonconforming", value_text=text)


def _select_value(
    raw: Any, payload: Any, field: FieldDescriptor, labels: OptionLabels
) -> ExportValue | None:
    fid = field.field_id
    if field.type is ExtractionFieldType.SELECT:
        if isinstance(payload, str):
            return ExportValue(
                raw=raw,
                status="answered",
                value_text=payload,
                value_label=labels.get((fid, payload), payload),
            )
        if (
            isinstance(payload, dict)
            and payload.get("selected") == "other"
            and isinstance(payload.get("other_text"), str)
        ):
            return ExportValue(raw=raw, status="answered", other_text=payload["other_text"])
        return None
    codes: list[Any]
    others: list[Any] = []
    if isinstance(payload, list):
        codes = payload
    elif (
        isinstance(payload, dict)
        and isinstance(payload.get("selected"), list)
        and isinstance(payload.get("other_texts"), list)
    ):
        codes, others = payload["selected"], payload["other_texts"]
    else:
        return None
    if not all(isinstance(c, str) for c in [*codes, *others]):
        return None
    return ExportValue(
        raw=raw,
        status="answered",
        value_text="; ".join(codes) or None,
        value_label="; ".join(labels.get((fid, c), c) for c in codes) or None,
        other_text="; ".join(others) or None,
    )


def to_export_value(
    raw: Any, field: FieldDescriptor, labels: OptionLabels, *, rejected: bool = False
) -> ExportValue:
    if rejected:
        return ExportValue(raw=raw, status="rejected")
    peeled = peel_envelope(raw)
    if peeled.absent_reason is not None:
        return ExportValue(raw=raw, status="absent", absent_code=peeled.absent_reason)
    payload = peeled.value
    if payload is None or payload == "" or payload == []:
        return ExportValue(raw=raw, status="cleared")
    ftype = field.type
    if ftype is ExtractionFieldType.NUMBER:
        num = _parse_finite_number(payload)
        if num is None:
            return _nonconforming(raw, payload)
        return ExportValue(raw=raw, status="answered", value_num=num, unit=peeled.unit)
    if ftype in (ExtractionFieldType.TEXT, ExtractionFieldType.DATE):
        if isinstance(payload, (str, int, float)):
            return ExportValue(raw=raw, status="answered", value_text=str(payload))
    elif ftype is ExtractionFieldType.BOOLEAN:
        if isinstance(payload, bool):
            return ExportValue(raw=raw, status="answered", value_bool=payload)
    else:
        selected = _select_value(raw, payload, field, labels)
        if selected is not None:
            return selected
    return _nonconforming(raw, payload)


def display_value(v: ExportValue, field: FieldDescriptor) -> CellValue:
    if v.out_of_scope:
        return ABSENT_REASON_LABELS["not_applicable"]
    if v.status == "absent":
        assert v.absent_code is not None
        return ABSENT_REASON_LABELS[v.absent_code]
    if v.status in ("rejected", "cleared"):
        return None
    if v.status == "nonconforming":
        return v.value_text
    if v.value_num is not None:
        unit = v.unit or field.unit
        return f"{v.value_num} {unit}" if unit else v.value_num
    if v.value_bool is not None:
        return "Yes" if v.value_bool else "No"
    if v.value_label is not None or v.other_text is not None:
        parts = [v.value_label] if v.value_label else []
        parts += [f"Other: {t}" for t in (v.other_text or "").split("; ") if t]
        return "; ".join(parts)
    return v.value_text
