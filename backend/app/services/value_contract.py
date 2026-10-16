"""The write-time value contract: one canonical envelope per field type.

``canonicalize_value`` turns a raw decision value plus the field it is written
to into the one canonical envelope ``{"value": X[, "unit"]}`` (or a coded
absent marker ``{"value": None, "absent_reason": code}``), or refuses it with a
:class:`ValueContractError` (``VALUE_CONTRACT_VIOLATION``, 422) naming the
field and a reason from a closed set. Every shape the reviewer UI sends today
is accepted. Pure: no DB, no IO.

Where it runs: human reviewer decisions (``ExtractionReviewService.record_decision``)
and consensus manual overrides sent by a person
(``ExtractionConsensusService.record_consensus``), both against the field as
pinned in the run's template version.

Where it deliberately does not run: AI proposal landing, the system
carry-overs (QA materialization at the extract->consensus advance, the reopen
carry-over) and approve-and-finalize's publish of agreed values. Those values
were stored under earlier rules; refusing them inside a stage transition would
strand the run. The read-only value-envelope audit covers them instead.
"""

from __future__ import annotations

import math
from datetime import date
from typing import Any, Literal
from uuid import UUID

from app.core.error_handler import AppError
from app.schemas.extraction_run import RunViewField
from app.services.value_semantics import AbsentReason, disposition_to_marker

ValueContractReason = Literal[
    "MALFORMED_ENVELOPE",
    "MARKER_NOT_ALLOWED",
    "NOT_AN_OPTION",
    "NOT_A_NUMBER",
    "UNIT_NOT_ALLOWED",
    "NOT_A_DATE",
    "NOT_A_BOOLEAN",
    "NOT_TEXT",
]


class ValueContractError(AppError):
    """A written value breaks its field's contract (rendered by the global handler)."""

    def __init__(self, *, field_id: UUID, reason: ValueContractReason, message: str) -> None:
        super().__init__(
            code="VALUE_CONTRACT_VIOLATION",
            message=message,
            status_code=422,
            details={"field_id": str(field_id), "reason": reason},
        )


_ENVELOPE_KEYS = frozenset({"value", "unit", "absent_reason"})

_MARKER_FLAG: dict[str, str] = {
    AbsentReason.NO_INFORMATION.value: "allows_no_information",
    AbsentReason.NOT_APPLICABLE.value: "allows_not_applicable",
    AbsentReason.NOT_EVALUATED.value: "allows_not_evaluated",
}


def _refuse(field: RunViewField, reason: ValueContractReason, accepts: str) -> ValueContractError:
    return ValueContractError(
        field_id=field.id, reason=reason, message=f"'{field.label}' accepts {accepts}."
    )


def _is_envelope(raw: Any) -> bool:
    return isinstance(raw, dict) and "value" in raw and set(raw) <= _ENVELOPE_KEYS


def _envelope(raw: Any, field: RunViewField) -> dict[str, Any]:
    """Rule 1: a strict envelope, with one UI double wrap merged up."""
    malformed = _refuse(field, "MALFORMED_ENVELOPE", 'a {"value": ...} envelope')
    if not _is_envelope(raw):
        raise malformed
    inner = raw["value"]
    if not (isinstance(inner, dict) and "value" in inner):
        return dict(raw)
    if not _is_envelope(inner) or (isinstance(inner["value"], dict) and "value" in inner["value"]):
        raise malformed
    # The inner envelope's siblings fill in only what the outer one lacks.
    outer = {k: v for k, v in raw.items() if k != "value" and v is not None}
    return {**inner, **outer}


def _marker(raw: dict[str, Any], field: RunViewField) -> dict[str, Any]:
    """Rule 3: a coded absent marker the field opts into."""
    code = raw["absent_reason"]
    flag = _MARKER_FLAG.get(code) if isinstance(code, str) else None
    if flag is None or raw["value"] is not None or not getattr(field, flag):
        raise _refuse(field, "MARKER_NOT_ALLOWED", "only the absent markers it allows")
    return {"value": None, "absent_reason": code}


def _option_codes(field: RunViewField) -> set[str]:
    return {o.value for o in field.allowed_values or []}


def _select(value: Any, field: RunViewField) -> Any:
    if isinstance(value, str) and value in _option_codes(field):
        return value
    if (
        field.allow_other
        and isinstance(value, dict)
        and set(value) == {"selected", "other_text"}
        and value["selected"] == "other"
        and isinstance(value["other_text"], str)
    ):
        return value
    raise _refuse(field, "NOT_AN_OPTION", "one of its options")


def _codes(items: Any, field: RunViewField) -> list[str] | None:
    """Unique option codes with empty strings dropped, or ``None`` when invalid."""
    if not isinstance(items, list) or not all(isinstance(i, str) for i in items):
        return None
    kept = [i for i in items if i]
    if len(set(kept)) != len(kept) or not set(kept) <= _option_codes(field):
        return None
    return kept


def _multiselect(value: Any, field: RunViewField) -> Any:
    codes = _codes(value, field)
    if codes is not None:
        return codes
    if field.allow_other and isinstance(value, dict) and set(value) == {"selected", "other_texts"}:
        selected = _codes(value["selected"], field)
        texts = value["other_texts"]
        if (
            selected is not None
            and isinstance(texts, list)
            and all(isinstance(t, str) for t in texts)
        ):
            return {"selected": selected, "other_texts": [t for t in texts if t]}
    raise _refuse(field, "NOT_AN_OPTION", "a list of its options")


def _number(value: Any, field: RunViewField) -> int | float:
    """An integer stays an exact ``int`` (no float round-trip above 2**53);
    a finite non-integral number is a ``float``."""
    if isinstance(value, int) and not isinstance(value, bool):
        return value
    if isinstance(value, str):
        try:
            return int(value)
        except ValueError:
            pass
    number: float | None = None
    if isinstance(value, float):
        number = value
    elif isinstance(value, str):
        try:
            number = float(value)
        except ValueError:
            number = None
    if number is None or not math.isfinite(number):
        raise _refuse(field, "NOT_A_NUMBER", "a finite number")
    return int(number) if number.is_integer() else number


def _unit(unit: Any, field: RunViewField) -> str | None:
    if unit is None:
        return None
    allowed = set(field.allowed_units) if isinstance(field.allowed_units, list) else set()
    if field.unit is not None:
        allowed.add(field.unit)
    if not isinstance(unit, str) or unit not in allowed:
        raise _refuse(field, "UNIT_NOT_ALLOWED", "only its allowed units")
    return unit


def _date(value: Any, field: RunViewField) -> str:
    if isinstance(value, str) and len(value) == 10:
        try:
            date.fromisoformat(value)
        except ValueError:
            pass
        else:
            return value
    raise _refuse(field, "NOT_A_DATE", "a YYYY-MM-DD date")


def _boolean(value: Any, field: RunViewField) -> bool:
    if isinstance(value, bool):
        return value
    raise _refuse(field, "NOT_A_BOOLEAN", "true or false")


def _text(value: Any, field: RunViewField) -> str:
    if isinstance(value, str):
        return value
    raise _refuse(field, "NOT_TEXT", "text")


def canonicalize_value(raw: Any, field: RunViewField) -> dict[str, Any]:
    """The canonical envelope for *raw* on *field*, or a :class:`ValueContractError`."""
    envelope = _envelope(raw, field)
    envelope = disposition_to_marker(
        envelope, field.allowed_values, allows_no_information=field.allows_no_information
    )
    if envelope.get("absent_reason") is not None:
        return _marker(envelope, field)

    value = envelope["value"]
    field_type = field.field_type
    if value is None or (value == "" and field_type in ("number", "date")):
        return {"value": None}

    if field_type == "number":
        canonical: dict[str, Any] = {"value": _number(value, field)}
        unit = _unit(envelope.get("unit"), field)
        if unit is not None:
            canonical["unit"] = unit
        return canonical
    if field_type == "select":
        return {"value": _select(value, field)}
    if field_type == "multiselect":
        return {"value": _multiselect(value, field)}
    if field_type == "date":
        return {"value": _date(value, field)}
    if field_type == "boolean":
        return {"value": _boolean(value, field)}
    return {"value": _text(value, field)}
