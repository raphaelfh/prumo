"""Envelope-aware value resolver for extraction exports.

The single source of truth for collapsing a persisted extraction value
envelope to one openpyxl-writable scalar. It replaces the too-narrow
``_unwrap_value`` and is shared by every value map (consensus /
single-user / all-users) and the AI-metadata value columns.

PURE: no DB, no storage, no network, no openpyxl. Layer-legal (services,
no IO) under ``scripts/fitness/check_layered_arch.py``.

Key invariant: ``resolve_value`` NEVER returns a ``dict`` and NEVER
returns a raw ``list`` — every envelope shape collapses to a scalar or
``str``, so no Python-repr dict string can ever reach a worksheet cell.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Protocol, runtime_checkable

from app.models.extraction import ExtractionFieldType
from app.services.value_contract import is_envelope
from app.services.value_semantics import (
    ABSENT_REASON_LABELS,
    strip_verification,
    value_absent_reason,
)

# An openpyxl-writable scalar. NEVER a dict, NEVER a list.
ResolvedScalar = str | int | float | bool | None


@runtime_checkable
class _FieldLike(Protocol):
    """Structural view of FieldDescriptor used by the resolver.

    Declared structurally to keep this module free of an import cycle
    with ``extraction_export_service`` (which the builder imports from).
    ``FieldDescriptor`` satisfies it once it carries ``type`` + ``unit``.
    """

    type: ExtractionFieldType
    unit: str | None


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


def resolve_value(raw: Any, *, field: _FieldLike | None = None) -> ResolvedScalar:
    """Resolve a persisted value envelope to one openpyxl-writable scalar.

    See the redesign spec §6 / §6.2-A1 for the exhaustive shape contract.
    Never returns a dict or a list.
    """
    bare = strip_verification(raw)
    peeled = peel_envelope(bare)
    # ADR-0016: a coded disposition renders its stable per-code label from the
    # single source in value_semantics (the export legend and the appraisal
    # roll-up read the same map, so a cell, its legend row and the roll-up can
    # never drift). Never "value: None; absent_reason: ..." in a cell.
    if peeled.absent_reason is not None:
        return ABSENT_REASON_LABELS[peeled.absent_reason]
    rendered = _render_payload(peeled.value, field)
    # A unit decorates only a value that came in an envelope: a bare number
    # (an AI-metadata column, say) is already final.
    if not is_envelope(bare):
        return rendered
    return _apply_unit(rendered, peeled.unit, field)


def _render_payload(inner: Any, field: _FieldLike | None) -> ResolvedScalar:
    """Collapse an already-peeled payload to one scalar (never a dict or list)."""
    # --- single "other" {"selected": "other", "other_text": t} ------------
    if isinstance(inner, dict) and inner.get("selected") == "other" and "other_text" in inner:
        text = inner.get("other_text")
        return str(text) if text is not None else None

    # --- multi "other" {"selected": [...], "other_texts": [...]} ----------
    if (
        isinstance(inner, dict)
        and isinstance(inner.get("selected"), list)
        and isinstance(inner.get("other_texts"), list)
    ):
        parts = [
            str(item) for item in [*inner["selected"], *inner["other_texts"]] if item is not None
        ]
        return "; ".join(parts)

    # --- any other dict shape — collapse deterministically, never leak ----
    if isinstance(inner, dict):
        return "; ".join(f"{k}: {v}" for k, v in inner.items())

    # --- list (multiselect) ----------------------------------------------
    if isinstance(inner, list):
        return "; ".join(str(item) for item in inner if item is not None)

    # --- scalar ----------------------------------------------------------
    if (
        field is not None
        and getattr(field, "type", None) is ExtractionFieldType.BOOLEAN
        and isinstance(inner, bool)
    ):
        return "Yes" if inner else "No"

    return inner  # type: ignore[no-any-return]  # a scalar payload is already final


def _apply_unit(
    inner: ResolvedScalar,
    envelope_unit: Any,
    field: _FieldLike | None,
) -> ResolvedScalar:
    """Append a unit to a NUMERIC scalar (``"5 mg"``); bare scalar otherwise.

    A unit only makes sense for a number, so a non-numeric inner (bool,
    str, ``None``) is returned untouched — never ``"Yes kg"`` or
    ``"approx mg"``. Envelope ``unit`` wins; ``field.unit`` is the
    fallback. A null/empty unit yields the bare scalar (native numeric
    type preserved).
    """
    if not _is_number(inner):
        return inner
    unit = envelope_unit
    if unit is None or unit == "":
        unit = getattr(field, "unit", None) if field is not None else None
    if unit is None or unit == "":
        return inner
    return f"{inner} {unit}"


def _is_number(value: Any) -> bool:
    """True for ``int``/``float`` but NOT ``bool`` (a ``bool`` is an ``int``)."""
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def format_export_scalar(value: ResolvedScalar, *, field: _FieldLike | None = None) -> Any:
    """Shape an ALREADY-RESOLVED scalar for an openpyxl cell.

    Shared by the matrix cells and the AI-metadata value columns so
    number+unit / select / multiselect / boolean render consistently.
    Must NEVER receive a dict — ``resolve_value`` is the only unwrapper
    and is always applied first; a dict here is a programming error and
    is allowed to raise downstream rather than be silently stringified.

    * ``bool`` + BOOLEAN field -> ``"Yes"``/``"No"`` (idempotent: a
      pre-resolved ``"Yes"`` passes through).
    * tz-aware ``datetime`` -> naive (openpyxl rejects tz-aware).
    * everything else -> returned unchanged (scalars are already final).
    """
    from datetime import datetime as _dt

    if value is None:
        return None
    if (
        isinstance(value, bool)
        and field is not None
        and getattr(field, "type", None) is ExtractionFieldType.BOOLEAN
    ):
        return "Yes" if value else "No"
    if isinstance(value, _dt) and value.tzinfo is not None:
        return value.replace(tzinfo=None)
    return value
