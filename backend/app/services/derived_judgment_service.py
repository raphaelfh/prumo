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

from app.services.value_semantics import unwrap_value_envelope, value_absent_reason

# Severity order for the Low / High / Unclear judgment vocabulary. Higher is
# worse; ``max`` over this mapping is the "worst" operator.
JUDGMENT_SEVERITY: dict[str, int] = {"Low": 0, "Unclear": 1, "High": 2}

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


def _judgment(raw: Any) -> str | None:
    """The canonical judgment carried by *raw*, or None when it is not one.

    A coded disposition marker ("no information" / "not applicable") is NOT a
    judgment: it is excluded here and therefore counts as unjudged upstream.
    """
    if value_absent_reason(raw) is not None:
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
    """Worst judgment among *values*, IGNORING unjudged entries (lenient)."""
    ranked = [j for j in (_judgment(v) for v in values) if j is not None]
    if not ranked:
        return None
    return max(ranked, key=JUDGMENT_SEVERITY.__getitem__)


def worst_domain(values: Iterable[Any]) -> str | None:
    """Worst judgment among *values*, None if ANY entry is unjudged (strict)."""
    judgments = [_judgment(v) for v in values]
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
