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

from typing import Any, Protocol, runtime_checkable

from app.models.extraction import ExtractionFieldType

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


def resolve_value(raw: Any, *, field: _FieldLike | None = None) -> ResolvedScalar:
    """Resolve a persisted value envelope to one openpyxl-writable scalar.

    See the redesign spec §6 / §6.2-A1 for the exhaustive shape contract.
    Never returns a dict or a list.
    """
    if raw is None:
        return None

    # --- Recursive single-wrap {"value": inner} ---------------------------
    # Handles {"value": x}, double-wrapped {"value": {"value": x}}, and
    # {"value": {"value": n, "unit": u}} from the decisions/proposals write
    # path (section_extraction_service wraps {"value": inner}). The single
    # wrap carries no unit of its own. When the inner is itself an envelope
    # (a {"value"} or {"value", "unit"} dict) it has already resolved any
    # unit, so we must NOT re-decorate it. Only a bare scalar inner takes
    # the field's unit as a fallback.
    if isinstance(raw, dict) and set(raw.keys()) == {"value"}:
        inner_raw = raw["value"]
        resolved = resolve_value(inner_raw, field=field)
        if _is_value_envelope(inner_raw):
            return resolved
        return _apply_unit(resolved, None, field)

    # --- number+unit {"value": n, "unit": u} ------------------------------
    if isinstance(raw, dict) and set(raw.keys()) == {"value", "unit"}:
        inner = resolve_value(raw["value"], field=field)
        unit = raw.get("unit")
        return _apply_unit(inner, unit, field)

    # --- single "other" {"selected": "other", "other_text": t} ------------
    if isinstance(raw, dict) and raw.get("selected") == "other" and "other_text" in raw:
        text = raw.get("other_text")
        return str(text) if text is not None else None

    # --- multi "other" {"selected": [...], "other_texts": [...]} ----------
    if (
        isinstance(raw, dict)
        and isinstance(raw.get("selected"), list)
        and isinstance(raw.get("other_texts"), list)
    ):
        parts = [str(item) for item in [*raw["selected"], *raw["other_texts"]] if item is not None]
        return "; ".join(parts)

    # --- any other dict shape — collapse deterministically, never leak ----
    if isinstance(raw, dict):
        return "; ".join(f"{k}: {v}" for k, v in raw.items())

    # --- list (multiselect) ----------------------------------------------
    if isinstance(raw, list):
        return "; ".join(str(item) for item in raw if item is not None)

    # --- scalar ----------------------------------------------------------
    if (
        field is not None
        and getattr(field, "type", None) is ExtractionFieldType.BOOLEAN
        and isinstance(raw, bool)
    ):
        return "Yes" if raw else "No"

    return raw


def _is_value_envelope(raw: Any) -> bool:
    """True iff ``raw`` is itself a ``{"value"}`` / ``{"value", "unit"}`` dict.

    These nested envelopes have already resolved (and unit-decorated)
    themselves, so the enclosing single-wrap branch must not re-apply a
    field-unit fallback on top of their result.
    """
    return isinstance(raw, dict) and set(raw.keys()) in ({"value"}, {"value", "unit"})


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
