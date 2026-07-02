"""Pure predicates for extraction value emptiness (no DB, no IO).

ONE rule, two polarities, shared by the two callers that previously each kept
their own copy:

- ``is_value_filled`` — the finalize completeness gate
  (``run_lifecycle_service``): a run may not publish while a required field is
  empty. The authoritative server-side mirror of the frontend ``progress.ts``
  metric, so it must never be STRICTER than the form the user just saw.
- ``is_value_empty`` — the AI-suggestion "no information" rule
  (``extraction_suggestion_read_service``): a later abstention must not bury an
  earlier real value in the dedup.

A value is empty when, after peeling one ``{"value": X}`` envelope, the value is
``None`` or the empty string. Whitespace, ``0``, ``False``, ``[]`` and
non-envelope dicts all count as filled — the frontend
``frontend/lib/extraction/valueSemantics.ts`` mirrors this rule 1:1 (a shared
cross-checked test vector keeps the two in lock-step).

**Absent-reason marker (ADR-0016).** A coordinate may also carry a coded
disposition sibling ``{"value": None, "absent_reason": <code>}`` — the source is
silent (``no_information``), the item does not apply (``not_applicable``) or was
not evaluated (``not_evaluated``). A resolved marker counts as **filled** even
though the typed value stays ``None`` (closing the numeric/date "not reported"
gap). The reason is validated against the closed :class:`AbsentReason` vocabulary,
so an out-of-vocabulary string can never sneak a required field past the finalize
gate. Both the gate and the dedup delegate here, so they inherit the marker with
no local change. Layer-legal (services, no IO) under
``scripts/fitness/check_layered_arch.py``.
"""

from __future__ import annotations

from enum import StrEnum
from typing import Any


class AbsentReason(StrEnum):
    """The closed vocabulary of coded "no value, on purpose" dispositions.

    Kept intentionally minimal (three codes, not FHIR ``dataAbsentReason``'s
    fifteen — YAGNI for evidence extraction). ``no_information`` is available on
    every field; ``not_applicable`` / ``not_evaluated`` are opt-in per field
    (surfaced in later phases). Defined once here and mirrored to the frontend
    via the generated API types once the marker rides a typed response field.
    """

    NO_INFORMATION = "no_information"
    NOT_APPLICABLE = "not_applicable"
    NOT_EVALUATED = "not_evaluated"


_ABSENT_REASON_CODES: frozenset[str] = frozenset(r.value for r in AbsentReason)


# The single source of truth for a coded disposition's human-readable label
# (ADR-0016 Phase 4). Colocated with the enum so a new code can't ship without a
# label. Reused by the export cell resolver (``exports/value_envelope``), the
# export front-matter legend, and the appraisal worst-case exclusion — all read
# THIS map so a cell, its legend row, and the roll-up can never drift. The
# frontend mirrors these exact strings via its own copy keys (FE/BE parity tests
# lock the two sides).
ABSENT_REASON_LABELS: dict[str, str] = {
    AbsentReason.NO_INFORMATION.value: "No information",
    AbsentReason.NOT_APPLICABLE.value: "Not applicable",
    AbsentReason.NOT_EVALUATED.value: "Not evaluated",
}


def unwrap_value_envelope(raw: Any) -> Any:
    """Peel a single ``{"value": X}`` envelope, matching the frontend's one-level
    unwrap in ``progress.ts`` / ``useReviewerSummary``. A bare scalar (or any dict
    without a ``value`` key) is returned untouched.
    """
    if isinstance(raw, dict) and "value" in raw:
        return raw["value"]
    return raw


def value_absent_reason(raw: Any) -> str | None:
    """The coded disposition carried by *raw*, or ``None``.

    Returns the ``absent_reason`` sibling only when it is a member of the closed
    :class:`AbsentReason` vocabulary; an absent, empty, or out-of-vocabulary
    reason yields ``None`` (so a garbage code is never treated as a resolution).
    """
    if isinstance(raw, dict):
        reason = raw.get("absent_reason")
        if isinstance(reason, str) and reason in _ABSENT_REASON_CODES:
            return reason
    return None


def is_value_empty(raw: Any) -> bool:
    """True when *raw* carries no information — no resolved ``absent_reason``
    marker, and ``None`` or the empty string after peeling one ``{"value": X}``
    envelope. The inverse of ``is_value_filled``.
    """
    if value_absent_reason(raw) is not None:
        return False
    value = unwrap_value_envelope(raw)
    return value is None or (isinstance(value, str) and value == "")


def is_value_filled(raw: Any) -> bool:
    """True when a stored value counts as "filled" for completeness — the
    negation of ``is_value_empty`` (a real value, or a resolved ``absent_reason``
    marker).
    """
    return not is_value_empty(raw)


# The in-band disposition strings retired by ADR-0016, mapped to their coded
# marker. Both encodings are covered: the CHARMS/full-word set and the PROBAST
# abbreviations ("NI" / "NA"). "Unclear" is intentionally absent — it is a
# substantive value, not a disposition.
_DISPOSITION_TO_REASON: dict[str, AbsentReason] = {
    "No information": AbsentReason.NO_INFORMATION,
    "Not applicable": AbsentReason.NOT_APPLICABLE,
    "Not evaluated": AbsentReason.NOT_EVALUATED,
    "NI": AbsentReason.NO_INFORMATION,
    "NA": AbsentReason.NOT_APPLICABLE,
}


def is_disposition_candidate(raw: Any) -> bool:
    """True when *raw*'s peeled value is one of the in-band disposition strings.

    A cheap pre-check (no DB) so a write choke-point can skip the per-field
    ``allowed_values`` lookup for the overwhelmingly common case — a real value
    or an already-resolved marker is never a candidate.
    """
    value = unwrap_value_envelope(raw)
    return isinstance(value, str) and value in _DISPOSITION_TO_REASON


def _option_values(allowed_values: Any) -> set[str]:
    """The set of option value-strings in a field's ``allowed_values`` (tolerant
    of both the plain-string and ``{"value": ...}`` option shapes)."""
    out: set[str] = set()
    if isinstance(allowed_values, list):
        for opt in allowed_values:
            if isinstance(opt, str):
                out.add(opt)
            elif isinstance(opt, dict) and isinstance(opt.get("value"), str):
                out.add(opt["value"])
    return out


def disposition_to_marker(raw: Any, allowed_values: Any) -> Any:
    """The single write-time disposition normalizer (ADR-0016 Phase 2).

    If *raw*'s peeled value is a recognized in-band disposition string **and**
    that string is one of the field's ``allowed_values`` (i.e. the domain treats
    it as a disposition), return the coded marker
    ``{"value": None, "absent_reason": <code>}``. Otherwise *raw* is returned
    unchanged — so a coincidental free-text ``"NA"`` (a text field has no
    ``allowed_values``), a substantive value, an already-resolved marker, or a
    multiselect list is never rewritten. Pure; no DB. Domain-scoped exactly like
    the Phase-3 data migration so the two agree.
    """
    value = unwrap_value_envelope(raw)
    if not isinstance(value, str):
        return raw
    reason = _DISPOSITION_TO_REASON.get(value)
    if reason is None or value not in _option_values(allowed_values):
        return raw
    return {"value": None, "absent_reason": reason.value}
