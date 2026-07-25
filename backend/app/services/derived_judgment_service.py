"""Computed overall judgments for quality-assessment templates.

PROBAST+AI (Moons et al., BMJ 2025) step 4 defines four *overall* judgments as
a deterministic function of the domain judgments — they are never entered by a
reviewer, so an overall can never contradict its own domains.
``extraction_fields`` has no computed-field concept, so the overalls are not
stored at all: this module is THE implementation, and both the run-view payload
and the xlsx export call it. Do not re-implement the rule anywhere else.

The derivation is configured as data on the template's ``schema`` JSONB
(``derived_judgments``), so a future checklist with different roll-ups needs no
code change here. NOTE: ``schema`` is NOT part of the frozen version snapshot
(``extraction_snapshot.SNAPSHOT_SQL`` freezes entity_types only), so the rule is
read live while its coordinates come from the snapshot. Renaming a seeded
section or judgment field without updating the spec silently nulls every
overall — callers should surface a dangling reference (see ``spec_coordinates``)
rather than fail closed.

Two aggregations, deliberately different:

* ``worst_of`` — collapse across the evaluation-D4 performance types
  (apparent / internal / external). LENIENT: an unreported type is ignored,
  because "the study did not do external validation" is not a gap in the
  assessment. Null only when no type was judged at all.
* ``worst_domain`` — aggregate across domains. STRICT: if any domain is
  unjudged, the overall is None ("incomplete"), never Low. One does not
  conclude low risk of bias from an assessment that is not finished.
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from typing import Any

from app.services.value_semantics import (
    AbsentReason,
    unwrap_value_envelope,
    value_absent_reason,
)

# Severity order for the Low / High / Unclear judgment vocabulary. Higher is
# worse; ``max`` over this mapping is the "worst" operator.
JUDGMENT_SEVERITY: dict[str, int] = {"Low": 0, "Unclear": 1, "High": 2}

# The judgment a ``no_information`` marker resolves to on a domain (see
# ``_judgment``). Named so the mapping is greppable from the instrument text.
_UNCLEAR = "Unclear"

_COLLAPSE_KEY = "collapse"

# ``worst_domain`` is currently the only rule. A spec declaring anything else is
# a definition this code cannot honour, so it resolves to None rather than being
# silently treated as worst-domain.
_SUPPORTED_RULE = "worst_domain"


@dataclass(frozen=True)
class DerivedJudgment:
    """One computed overall. ``value`` is None when the inputs are incomplete."""

    id: str
    label: str
    value: str | None


def _judgment(raw: Any, *, no_information_as_unclear: bool = False) -> str | None:
    """The canonical judgment carried by *raw*, or None when it is not one.

    A ``no_information`` marker is context-dependent, and the instrument says
    so in two places that pull in opposite directions:

    * On a DOMAIN judgment it IS a judgment — "NI que impeça julgar leva a
      Unclear" (methodology.md §4b). The reviewer answered; the answer is
      "cannot determine", which the Low/High/Unclear scale encodes as Unclear.
      This matters because the AI extraction path returns ``status="not_found"``
      for an undeterminable judgment, which the pipeline stores as this marker
      — so treating it as an absence left every overall permanently blank on a
      fully-answered assessment.
    * On an evaluation-D4 performance type it means "the study did not report
      this type", and "não se julga o que o estudo não fez" (methodology.md
      §5): it must be excluded, never counted as Unclear, or a study would be
      marked down for validation it never claimed to perform.

    Hence the flag: ``worst_domain`` sets it, ``worst_of`` (the D4 collapse)
    does not. ``not_applicable`` / ``not_evaluated`` are never judgments in
    either context — a PROBAST+AI domain cannot legitimately be N/A.
    """
    reason = value_absent_reason(raw)
    if reason is not None:
        if no_information_as_unclear and reason == AbsentReason.NO_INFORMATION.value:
            return _UNCLEAR
        return None
    value = unwrap_value_envelope(raw)
    if not isinstance(value, str):
        return None
    text = value.strip()
    for known in JUDGMENT_SEVERITY:
        if text.casefold() == known.casefold():
            return known
    return None


def worst_of(values: Iterable[Any]) -> str | None:
    """Worst judgment among *values*, IGNORING unjudged entries (lenient).

    Used for the evaluation-D4 collapse, so a ``no_information`` marker is an
    unreported performance type and drops out rather than becoming Unclear.
    """
    ranked = [j for j in (_judgment(v) for v in values) if j is not None]
    if not ranked:
        return None
    return max(ranked, key=JUDGMENT_SEVERITY.__getitem__)


def worst_domain(values: Iterable[Any]) -> str | None:
    """Worst judgment among *values*, None if ANY entry is unjudged (strict).

    A ``no_information`` marker counts as Unclear here (see ``_judgment``); a
    genuinely missing value still yields None, so an overall is never concluded
    from an unfinished assessment.
    """
    judgments = [_judgment(v, no_information_as_unclear=True) for v in values]
    if not judgments or any(j is None for j in judgments):
        return None
    ranked = [j for j in judgments if j is not None]
    return max(ranked, key=JUDGMENT_SEVERITY.__getitem__)


def derived_spec(template_schema: Any) -> list[dict[str, Any]]:
    """The ``derived_judgments`` list on a template's ``schema`` JSONB, or []."""
    if not isinstance(template_schema, dict):
        return []
    spec = template_schema.get("derived_judgments")
    if not isinstance(spec, list):
        return []
    return [item for item in spec if isinstance(item, dict)]


def spec_coordinates(spec: Any) -> list[tuple[str, str]]:
    """Every ``(section, field)`` coordinate a spec references, collapses included.

    Callers use this to warn about references that resolve to nothing — a
    renamed section would otherwise null every overall in silence.
    """
    found: list[tuple[str, str]] = []

    def _walk(items: Any) -> None:
        if not isinstance(items, list):
            return
        for item in items:
            if not isinstance(item, dict):
                continue
            if _COLLAPSE_KEY in item:
                _walk(item.get("inputs"))
            else:
                found.append((str(item.get("section", "")), str(item.get("field", ""))))

    for derived in spec if isinstance(spec, list) else []:
        if isinstance(derived, dict):
            _walk(derived.get("inputs"))
    return found


def _resolve_input(
    item: Mapping[str, Any],
    values_by_coord: Mapping[tuple[str, str], Any],
) -> Any:
    """One overall input: either a coordinate, or a nested collapse group."""
    if _COLLAPSE_KEY in item:
        nested = item.get("inputs")
        if not isinstance(nested, list):
            return None
        return worst_of(
            _resolve_input(sub, values_by_coord) for sub in nested if isinstance(sub, dict)
        )
    return values_by_coord.get((str(item.get("section", "")), str(item.get("field", ""))))


def compute_derived_judgments(
    spec: Any,
    values_by_coord: Mapping[tuple[str, str], Any],
) -> list[DerivedJudgment]:
    """Compute every overall in *spec* from the stored domain judgments.

    ``values_by_coord`` maps ``(section_name, field_name)`` to the RAW stored
    value (envelope or scalar); unwrapping happens here so every caller feeds
    the same shape.
    """
    results: list[DerivedJudgment] = []
    for derived in spec if isinstance(spec, list) else []:
        if not isinstance(derived, dict):
            continue
        inputs = derived.get("inputs")
        if not isinstance(inputs, list):
            continue
        rule = str(derived.get("rule", _SUPPORTED_RULE))
        resolved = [
            _resolve_input(item, values_by_coord) for item in inputs if isinstance(item, dict)
        ]
        results.append(
            DerivedJudgment(
                id=str(derived.get("id", "")),
                label=str(derived.get("label", "")),
                value=worst_domain(resolved) if rule == _SUPPORTED_RULE else None,
            )
        )
    return results
