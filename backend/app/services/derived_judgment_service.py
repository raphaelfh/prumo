"""Computed judgments for quality-assessment templates.

PROBAST+AI (Moons et al., BMJ 2025) defines two computed layers, and this
module is THE implementation of both — the run-view payload and the xlsx
export call it. Do not re-implement the rules anywhere else.

* Step 4 *overalls* (``worst_domain`` entries, no ``target``): a
  deterministic roll-up of the stored domain judgments — never entered by a
  reviewer, never stored, so an overall cannot contradict its own domains.
* Domain-judgment *recommendations* (``signaling_worst`` entries, with a
  ``target``): the derived DEFAULT the instrument's signaling questions flag
  ("N/PN flags the potential for bias; you will need to use your judgement").
  The assessor records the final value on the ``target`` field — the
  recommendation itself is advice, never stored, never fed to the overalls.

The derivation is configured as data on the template's ``schema`` JSONB
(``derived_judgments``), so a future checklist with different roll-ups needs no
code change here. NOTE: ``schema`` is NOT part of the frozen version snapshot
(``extraction_snapshot.SNAPSHOT_SQL`` freezes entity_types only), so the rule is
read live while its coordinates come from the snapshot. Renaming a seeded
section or judgment field without updating the spec silently nulls every
overall — callers should surface a dangling reference (see ``spec_coordinates``)
rather than fail closed.

Aggregations, deliberately different:

* ``worst_of`` — collapse across the evaluation-D4 performance types
  (apparent / internal / external). LENIENT: an unreported type is ignored,
  because "the study did not do external validation" is not a gap in the
  assessment. Null only when no type was judged at all.
* ``worst_domain`` — aggregate across domains. STRICT below High: if any
  domain is unjudged, the overall is None ("incomplete"), never Low — but a
  single High propagates regardless (the official step-4 tables say "at
  least one domain high → high" without requiring the rest to be rated).
* ``signaling_worst`` — map each signaling answer (Y/PY → Low, PN/N → High,
  unclear/NI → Unclear), then aggregate with High monotone and Low/Unclear
  completeness-gated; collapse groups model the D4 performance types with
  unreported-vs-in-progress semantics (see ``_signaling_group_state``).
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass
from typing import Any, Literal

from app.core.logging import get_logger
from app.services.value_semantics import (
    ABSENT_REASON_LABELS,
    AbsentReason,
    unwrap_value_envelope,
    value_absent_reason,
)

# The judgment an unjudgeable domain resolves to (see ``_judgment``). Declared
# first so it is the same token as the severity key below, not a parallel copy.
_UNCLEAR = "Unclear"

# Severity order for the Low / High / Unclear judgment vocabulary. Higher is
# worse; ``max`` over this mapping is the "worst" operator.
JUDGMENT_SEVERITY: dict[str, int] = {"Low": 0, _UNCLEAR: 1, "High": 2}

# The two callers hand us DIFFERENT shapes for the same stored value: the run
# view passes the raw jsonb envelope, while the export passes a value_map whose
# entries ``resolve_value`` has already collapsed to a display label. Mapping
# the labels back to their codes is what keeps "screen and workbook cannot
# drift" true — without it a marker reads as Unclear on the banner and as
# nothing at all in the xlsx.
_LABEL_TO_ABSENT_REASON: dict[str, str] = {
    label.casefold(): code for code, label in ABSENT_REASON_LABELS.items()
}

_COLLAPSE_KEY = "collapse"

# The two rules a spec may declare. Anything else is a definition this code
# cannot honour, so it resolves to None rather than being silently treated as
# one of these.
_WORST_DOMAIN_RULE = "worst_domain"
_SIGNALING_RULE = "signaling_worst"

# A RECOMMENDATION entry computes the derived default for a stored judgment
# field, which it names via ``target``; an entry without one is an OVERALL.
# The single discriminator — the export and the payload both use it instead of
# probing the raw key themselves.
_RECOMMENDATION_KEY = "target"

# What one signaling answer contributes to its domain's derived default.
# ``excluded`` = a deliberate non-NI absent-reason marker (the instrument's
# conditional NA rows); ``missing`` = unanswered or out-of-vocabulary — never
# a silent Low.
Contribution = Literal["Low", "High", "Unclear", "excluded", "missing"]

_SIGNALING_MAP: dict[str, Contribution] = {
    "y": "Low",
    "py": "Low",
    "pn": "High",
    "n": "High",
    # QUADAS-2's third answer (§11 adoption) — same casefolded lookup.
    "unclear": "Unclear",
}


@dataclass(frozen=True)
class DerivedInput:
    """One input's contribution to a derived judgment, exactly as the rule saw it.

    Carried so a client can explain the result instead of just showing it: a
    reviewer who blanks one domain judgment gets a dash on the overall, and
    without the contributions there is nothing on screen saying WHICH domain
    caused it — the failure mode that prompted this.

    ``sections`` are the coordinates it came from — one for a plain input, all
    of them for a collapse group — so a caller holding the entity_types tree can
    name it. ``label`` is the spec's own name for a collapse group; empty when
    the spec does not carry one, which every spec seeded before the key existed
    does not.

    ``value`` is the DISPLAY value: for ``worst_domain`` rows the judgment the
    rule consumed; for ``signaling_worst`` plain rows the RAW stored answer in
    the reviewer's own vocabulary (``"PN"``, a marker label, or None when
    unanswered); None on group rows (the group has no single stored answer).
    ``contribution`` is uniformly the Low/High/Unclear the rule consumed from
    this row — None when it contributed nothing (unjudged, excluded,
    unreported, in-progress). Clients highlight and color by ``contribution``
    only, so no answer-mapping knowledge ever leaves this module.
    """

    sections: tuple[str, ...]
    label: str
    value: str | None
    contribution: str | None = None
    # The plain input's field name ("" for collapse groups) — with
    # ``sections[0]`` it is the full coordinate, so the payload can name a
    # recommendation row after the QUESTION (field label) instead of the
    # section every sibling row shares.
    field: str = ""


@dataclass(frozen=True)
class DerivedJudgment:
    """One computed overall. ``value`` is None when the inputs are incomplete."""

    id: str
    label: str
    value: str | None
    inputs: tuple[DerivedInput, ...] = ()


def _absent_reason(raw: Any) -> str | None:
    """The disposition code carried by *raw*, from either caller's shape.

    Accepts the raw envelope (run view) and the already-resolved display label
    (export), so both read a marker identically.
    """
    reason = value_absent_reason(raw)
    if reason is not None:
        return reason
    value = unwrap_value_envelope(raw)
    if isinstance(value, str):
        return _LABEL_TO_ABSENT_REASON.get(value.strip().casefold())
    return None


def _judgment(raw: Any, *, no_information_as_unclear: bool = False) -> str | None:
    """The canonical judgment carried by *raw*, or None when it is not one.

    A ``no_information`` marker means opposite things at the two levels, and
    the instrument says so in two places:

    * On a DOMAIN judgment it IS a judgment — "NI que impeça julgar leva a
      Unclear" (methodology.md §4b): the Low/High/Unclear scale encodes
      "cannot determine" as Unclear.
    * On an evaluation-D4 performance type it means "the study did not report
      this type", and "não se julga o que o estudo não fez" (methodology.md
      §5) — excluding it is what stops a study being marked down for
      validation it never claimed to perform.

    Hence the flag: ``worst_domain`` sets it, ``worst_of`` (the D4 collapse)
    does not. ``not_applicable`` / ``not_evaluated`` are never judgments in
    either context — a PROBAST+AI domain cannot legitimately be N/A.
    """
    reason = _absent_reason(raw)
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
    """Worst judgment among *values*; None if any entry is unjudged — below High.

    A single High propagates regardless of unrated siblings: the official
    step-4 tables say "at least one domain high → high" without requiring the
    rest to be rated (spec 2026-08-22 §1). Below High the strictness holds —
    a ``no_information`` marker counts as Unclear (see ``_judgment``), but a
    genuinely missing value yields None, so Low/Unclear are never concluded
    from an unfinished assessment.
    """
    judgments = [_judgment(v, no_information_as_unclear=True) for v in values]
    if any(j == "High" for j in judgments):
        return "High"
    if not judgments or any(j is None for j in judgments):
        return None
    ranked = [j for j in judgments if j is not None]
    return max(ranked, key=JUDGMENT_SEVERITY.__getitem__)


def _signaling_contribution(raw: Any) -> Contribution:
    """What one stored signaling answer contributes (spec 2026-08-22 §1).

    Accepts both caller shapes (raw envelope and resolved display label) via
    the same ``_absent_reason``/``unwrap_value_envelope`` pair as ``_judgment``
    — the screen/workbook parity invariant.
    """
    reason = _absent_reason(raw)
    if reason == AbsentReason.NO_INFORMATION.value:
        return "Unclear"
    if reason is not None:
        return "excluded"
    value = unwrap_value_envelope(raw)
    if value is None or (isinstance(value, str) and not value.strip()):
        return "missing"
    return _SIGNALING_MAP.get(str(value).strip().casefold(), "missing")


def _raw_display(raw: Any) -> str | None:
    """The stored answer as the reviewer sees it, for a breakdown row.

    Traceability means naming the cause in the reviewer's own vocabulary
    (``"PN"``, ``"No information"``) — never the mapped judgment.
    """
    reason = _absent_reason(raw)
    if reason is not None:
        return ABSENT_REASON_LABELS.get(reason, reason)
    value = unwrap_value_envelope(raw)
    if value is None:
        return None
    text = str(value).strip()
    return text or None


# A collapse group's resolved state: a judgment, or one of the two
# non-judgment outcomes the aggregation treats differently — ``unreported``
# (every member unanswered/excluded: the study never claimed this
# performance type, so it drops out) vs ``in-progress`` (partially answered:
# the assessment is unfinished, so the default is withheld).
_GROUP_UNREPORTED = "unreported"
_GROUP_IN_PROGRESS = "in-progress"


def _signaling_group_state(raws: Iterable[Any]) -> str:
    contributions = [_signaling_contribution(r) for r in raws]
    if all(c in ("excluded", "missing") for c in contributions):
        return _GROUP_UNREPORTED
    if any(c == "High" for c in contributions):
        return "High"
    if any(c == "missing" for c in contributions):
        return _GROUP_IN_PROGRESS
    judged = [c for c in contributions if c in JUDGMENT_SEVERITY]
    return max(judged, key=JUDGMENT_SEVERITY.__getitem__)


def _aggregate_signaling(plain: list[str], groups: list[str]) -> str | None:
    """Aggregate resolved inputs — High is monotone, Low/Unclear are not."""
    reported = [g for g in groups if g != _GROUP_UNREPORTED]
    if any(s == "High" for s in plain) or any(g == "High" for g in reported):
        return "High"
    if any(s == "missing" for s in plain) or any(g == _GROUP_IN_PROGRESS for g in reported):
        return None
    judged = [s for s in plain if s in JUDGMENT_SEVERITY] + [
        g for g in reported if g in JUDGMENT_SEVERITY
    ]
    if not judged:
        return None
    return max(judged, key=JUDGMENT_SEVERITY.__getitem__)


def _compute_signaling_entry(
    items: Sequence[Mapping[str, Any]],
    values_by_coord: Mapping[tuple[str, str], Any],
) -> tuple[str | None, tuple[DerivedInput, ...]]:
    """value + breakdown rows for one ``signaling_worst`` recommendation."""
    plain_states: list[str] = []
    group_states: list[str] = []
    rows: list[DerivedInput] = []
    for item in items:
        sections, label = _input_identity(item)
        if _COLLAPSE_KEY in item:
            nested = item.get("inputs")
            subs = [s for s in nested if isinstance(s, dict)] if isinstance(nested, list) else []
            raws = [
                values_by_coord.get((str(s.get("section", "")), str(s.get("field", ""))))
                for s in subs
            ]
            state = _signaling_group_state(raws)
            group_states.append(state)
            rows.append(
                DerivedInput(
                    sections=sections,
                    label=label,
                    value=None,
                    contribution=state if state in JUDGMENT_SEVERITY else None,
                )
            )
        else:
            field_name = str(item.get("field", ""))
            raw = values_by_coord.get((str(item.get("section", "")), field_name))
            state = _signaling_contribution(raw)
            plain_states.append(state)
            rows.append(
                DerivedInput(
                    sections=sections,
                    label=label,
                    value=_raw_display(raw),
                    contribution=state if state in JUDGMENT_SEVERITY else None,
                    field=field_name,
                )
            )
    return _aggregate_signaling(plain_states, group_states), tuple(rows)


def is_recommendation(entry: Mapping[str, Any]) -> bool:
    """True for entries that compute a derived DEFAULT for a stored judgment.

    Recommendations name their assessor-owned field via ``target``; entries
    without one are computed overalls. Export columns and payload id
    resolution both discriminate through here — never probe the key directly.
    """
    return _RECOMMENDATION_KEY in entry


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

    Walks ``inputs`` plus the assessor-owned pointers (``target`` /
    ``rationale`` / ``summary``), so the dangling-reference warning covers the
    coordinates the LLM exclusion and the UI pairing depend on too. Callers
    use this to warn about references that resolve to nothing — a renamed
    section would otherwise null an overall (or silently un-exclude an
    assessor-owned field) with nothing on screen saying so.
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
        if not isinstance(derived, dict):
            continue
        _walk(derived.get("inputs"))
        found.extend(_assessor_pointers(derived))
    return found


logger = get_logger(__name__)


def warn_dangling_spec_refs(spec: Any, known: set[tuple[str, str]]) -> None:
    """Log ``qa_derived_spec_dangling_ref`` for spec coordinates *known* lacks.

    The one emitter for the full-spec surfaces (run-view payload, xlsx
    export): the spec is read live off the template while coordinates come
    from a frozen tree, and a rename must never null an overall — or
    un-pair a recommendation — in silence. ``known`` is the caller's
    ``(section_name, field_name)`` existence set.
    """
    unresolvable = sorted({c for c in spec_coordinates(spec) if c not in known})
    if unresolvable:
        logger.warning("qa_derived_spec_dangling_ref", coordinates=unresolvable)


def _assessor_pointers(derived: Mapping[str, Any]) -> list[tuple[str, str]]:
    """The entry's assessor-owned coordinates: target, rationale, summary."""
    pointers: list[tuple[str, str]] = []
    for key in (_RECOMMENDATION_KEY, "rationale", "summary"):
        pointer = derived.get(key)
        if isinstance(pointer, dict):
            pointers.append((str(pointer.get("section", "")), str(pointer.get("field", ""))))
    return pointers


def excluded_field_coordinates(spec: Any) -> set[tuple[str, str]]:
    """The assessor-owned ``(section, field)`` names the LLM must never see (§3).

    The union of every entry's target/rationale/summary pointers — declared
    data, no name conventions, kind-agnostic: a template without a spec
    yields an empty set and the extraction field list passes through
    untouched.
    """
    excluded: set[tuple[str, str]] = set()
    for derived in spec if isinstance(spec, list) else []:
        if isinstance(derived, dict):
            excluded.update(_assessor_pointers(derived))
    return excluded


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


def _input_identity(item: Mapping[str, Any]) -> tuple[tuple[str, ...], str]:
    """``(sections, label)`` naming one input, for the client-facing breakdown.

    A collapse group spans several sections, so the instrument's name for the
    domain lives on the spec item. Every sub-section is returned as well: a spec
    seeded before that key existed carries no label, and naming the group after
    just one of its members would claim a three-section row belongs to a single
    performance type. The caller derives the group name from all of them.
    """
    if _COLLAPSE_KEY in item:
        nested = item.get("inputs")
        subs = [sub for sub in nested if isinstance(sub, dict)] if isinstance(nested, list) else []
        return tuple(str(sub.get("section", "")) for sub in subs), str(item.get("label", ""))
    return (str(item.get("section", "")),), ""


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
        rule = str(derived.get("rule", _WORST_DOMAIN_RULE))
        items = [item for item in inputs if isinstance(item, dict)]
        if rule == _SIGNALING_RULE:
            value, contributions = _compute_signaling_entry(items, values_by_coord)
        else:
            resolved = [_resolve_input(item, values_by_coord) for item in items]
            # The per-domain breakdown reuses the SAME ``_judgment`` the rule
            # applies, so what the client explains is what the rule consumed —
            # it can never narrate a contribution the overall was not actually
            # computed from.
            contributions = tuple(
                DerivedInput(
                    sections=sections,
                    label=label,
                    value=(judged := _judgment(raw, no_information_as_unclear=True)),
                    contribution=judged,
                )
                for (sections, label), raw in zip(
                    (_input_identity(item) for item in items), resolved, strict=True
                )
            )
            value = worst_domain(resolved) if rule == _WORST_DOMAIN_RULE else None
        results.append(
            DerivedJudgment(
                id=str(derived.get("id", "")),
                label=str(derived.get("label", "")),
                value=value,
                inputs=contributions,
            )
        )
    return results
