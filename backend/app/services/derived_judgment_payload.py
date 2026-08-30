"""Assemble the run-view payload for a template's computed overall judgments.

Its own module, separate from both neighbours on purpose: `derived_judgment_service`
is the pure RULE and knows nothing about runs or schemas, while
`extraction_run_read_service` is the run-reading query layer. This is the thin
seam between them — it resolves the spec's ``(section, field)`` coordinates
against a run's frozen entity_types tree and instances, and decides which value
set the derivation reads.
"""

from __future__ import annotations

from collections.abc import Sequence
from typing import Any

from app.schemas.extraction_run import RunViewDerivedInput, RunViewDerivedJudgment
from app.services.derived_judgment_service import (
    compute_derived_judgments,
    coordinate_of,
    derived_spec,
    is_out_of_scope,
    is_recommendation,
    judgment_of,
    out_of_scope_sections,
    scope_filtered_values,
    warn_dangling_spec_refs,
)
from app.services.value_semantics import unwrap_value_envelope

# Wire contract, alongside the rules' own "unreported"/"in-progress": clients
# switch on the STRING. Named here because the payload — not a rule — stamps it.
_OUT_OF_SCOPE = "out-of-scope"


def _rationale_is_empty(raw: Any) -> bool:
    """Mirror of the client's ``rationaleIsEmpty`` — NOT ``is_value_filled``.

    Two deliberate departures from the shared emptiness predicate, both so the
    requirement can never be stricter than the box that satisfies it:
    whitespace is empty here (``is_value_filled`` calls ``"  "`` filled), and a
    disposition marker peels to None and counts as empty (``is_value_filled``
    calls any marker filled). A missing value is empty for the same reason the
    client reads an absent key as empty.
    """
    value = unwrap_value_envelope(raw)
    return value is None or (isinstance(value, str) and value.strip() == "")


def _rationale_required(
    entry: Any,
    default: str | None,
    values_by_coord: Any,
) -> bool:
    """Whether this entry's STORED judgment overrides its derived default unsaid.

    The single implementation of the rule the finalize backstop enforces and
    the QA screen renders — computed here because this is where a coordinate
    becomes a value, and computed ONCE so the screen can never disagree with
    the refusal it is meant to prevent. The caller's value set decides what
    "stored" means: the reviewer's own answers on the form, the published set
    at finalize.

    False for anything that is not a live override: an overall (no target), an
    incomplete default, a blank or N/A target, a target that agrees, and an
    out-of-scope section (§2a dropped its value, so the default is None). A
    ``no_information`` marker on the target IS a judgment here — the instrument
    reads NI as Unclear on a domain — so overriding a default with it owes a
    rationale like any other pick.
    """
    if default is None or not isinstance(entry, dict):
        return False
    target, rationale = entry.get("target"), entry.get("rationale")
    if not isinstance(target, dict) or not isinstance(rationale, dict):
        return False
    judgment = judgment_of(
        values_by_coord.get(coordinate_of(target)), no_information_as_unclear=True
    )
    if judgment is None or judgment == default:
        return False
    return _rationale_is_empty(values_by_coord.get(coordinate_of(rationale)))


def first_instance_by_entity_type(instances: Sequence[Any]) -> dict[Any, Any]:
    """Entity type -> the instance whose values represent it: the FIRST one.

    Mirrors the export's ``instance_ids[0]``. Shared rather than repeated
    because the finalize backstop looks a published value up by the instance
    this picks: if the two ever disagreed, the gate would silently be checking
    a different row than the one the default was computed from.
    """
    by_entity_type: dict[Any, Any] = {}
    for inst in instances:
        by_entity_type.setdefault(inst.entity_type_id, inst.id)
    return by_entity_type


def _group_label(sections: tuple[str, ...], label_by_section: dict[str, str]) -> str:
    """Name a breakdown row from the section label(s) behind it.

    One section names itself. A collapse group takes what its members SHARE:
    the three PROBAST+AI D4 sections are labelled "Evaluation D4: Analysis
    (apparent performance / internal validation / external validation)", whose
    common prefix is the domain's own name. Deriving it beats naming the group
    after its first member — that would tell a reviewer their D4 row is about
    apparent performance when it spans all three — and it needs no backfill for
    the specs already in production, which carry no explicit group label.
    """
    labels = [label_by_section.get(name, name) for name in sections if name]
    if not labels:
        return ""
    if len(labels) == 1:
        return labels[0]
    shared = labels[0]
    for other in labels[1:]:
        limit = min(len(shared), len(other))
        cut = 0
        while cut < limit and shared[cut] == other[cut]:
            cut += 1
        shared = shared[:cut]
    # A prefix that stops mid-word or on the opening bracket of the part that
    # differs is not a name; trim back to the last complete word.
    shared = shared.rstrip().rstrip("([-–—:,;/").rstrip()
    return shared or labels[0]


def build_derived_judgments_payload(
    *,
    template_schema: Any,
    entity_types: Sequence[Any],
    instances: Sequence[Any],
    values: Sequence[Any],
) -> list[RunViewDerivedJudgment]:
    """Compute the template's overall judgments from *values*.

    Resolves the spec's ``(section_name, field_name)`` coordinates against the
    frozen entity_types tree plus this run's instances, then delegates the RULE
    to ``derived_judgment_service`` — the single implementation shared with the
    xlsx export. The caller chooses *values*: the canonical set once peers are
    revealed, the caller's own while blind (see ``build_run_view``).
    """
    spec = derived_spec(template_schema)
    if not spec:
        return []

    instance_by_entity_type = first_instance_by_entity_type(instances)
    value_by_ids = {(v.instance_id, v.field_id): v.value for v in values}

    values_by_coord: dict[tuple[str, str], Any] = {}
    # Coordinate name -> (entity_type_id, field_id) from the frozen tree: the
    # existence set for the dangling warning AND the resolver for the spec's
    # target/rationale/summary pointers.
    ids_by_coord: dict[tuple[str, str], tuple[Any, Any]] = {}
    label_by_section: dict[str, str] = {}
    label_by_coord: dict[tuple[str, str], str] = {}
    for et in entity_types:
        instance_id = instance_by_entity_type.get(et.id)
        label_by_section[et.name] = getattr(et, "label", "") or et.name
        for field in et.fields:
            ids_by_coord[(et.name, field.name)] = (et.id, field.id)
            label_by_coord[(et.name, field.name)] = getattr(field, "label", "") or field.name
            if instance_id is None:
                continue
            raw = value_by_ids.get((instance_id, field.id))
            if raw is not None:
                values_by_coord[(et.name, field.name)] = raw

    # §2a — scope. Resolve the excluded sections from the UNFILTERED values
    # (the classifier's own section is never excluded), then drop their values
    # before the rules run. The aggregations need no scope knowledge: with
    # nothing to judge they already yield None. Stored values are untouched.
    out_of_scope = out_of_scope_sections(template_schema, values_by_coord)
    values_by_coord = scope_filtered_values(values_by_coord, out_of_scope)

    # A coordinate the template no longer carries is a definition bug that
    # would otherwise null an overall (or unpair a recommendation) in silence.
    warn_dangling_spec_refs(spec, set(ids_by_coord))

    def _pointer_field_ids(entry: Any, key: str) -> tuple[Any, Any]:
        pointer = entry.get(key) if isinstance(entry, dict) else None
        if not isinstance(pointer, dict):
            return None, None
        coord = coordinate_of(pointer)
        return ids_by_coord.get(coord, (None, None))

    # Pointer resolution is keyed by entry id: compute_derived_judgments skips
    # malformed entries, so positional zipping against the spec would misalign.
    entry_by_id = {str(e.get("id", "")): e for e in spec if isinstance(e, dict)}

    def _input_label(inp: Any, *, recommendation: bool) -> str:
        # The spec's own name for a group wins. A RECOMMENDATION's plain rows
        # are individual signaling questions inside ONE section, so they are
        # named after the QUESTION (field label) — the section label would
        # repeat identically on every sibling row and leave the reviewer
        # unable to tell which answer caused the default. Overalls keep the
        # section (domain) name, which is the row's identity there.
        if inp.label:
            return str(inp.label)
        if recommendation and inp.field and inp.sections:
            question = label_by_coord.get((inp.sections[0], inp.field))
            if question:
                return question
        return _group_label(inp.sections, label_by_section)

    payload: list[RunViewDerivedJudgment] = []
    for d in compute_derived_judgments(spec, values_by_coord):
        entry = entry_by_id.get(d.id, {})
        recommendation = is_recommendation(entry)
        target_et_id, target_field_id = _pointer_field_ids(entry, "target")
        _, rationale_field_id = _pointer_field_ids(entry, "rationale")
        _, summary_field_id = _pointer_field_ids(entry, "summary")
        payload.append(
            RunViewDerivedJudgment(
                id=d.id,
                label=d.label,
                value=d.value,
                inputs=[
                    RunViewDerivedInput(
                        label=_input_label(inp, recommendation=recommendation),
                        value=inp.value,
                        # An excluded row contributed nothing by construction —
                        # §2a dropped its value before the rule ran — so only
                        # the state stamp is needed, and it replaces whatever
                        # the rule inferred from the resulting silence.
                        contribution=inp.contribution,
                        state=_OUT_OF_SCOPE if is_out_of_scope(inp, out_of_scope) else inp.state,
                    )
                    for inp in d.inputs
                ],
                rationale_required=_rationale_required(entry, d.value, values_by_coord),
                target_entity_type_id=target_et_id,
                target_field_id=target_field_id,
                rationale_field_id=rationale_field_id,
                summary_field_id=summary_field_id,
            )
        )
    return payload


def values_for_derivation(
    *,
    peers_revealed: bool,
    published_states: Sequence[Any],
    current_values: Sequence[Any],
) -> Sequence[Any]:
    """Which value set the overalls are computed from, by stage and reveal.

    Once peers are revealed (consensus / finalized) the canonical answer is the
    PUBLISHED STATE — using the caller-scoped ``current_values`` there would show
    an arbitrator the reviewer's own overalls instead of the published ones.
    While blind, the caller's own values are the only correct source.

    A ConsensusDecision is deliberately NOT a value carrier and is never read
    here: for ``mode='select_existing'`` the resolved value lives on the
    PublishedState while the decision row keeps a null, so treating decisions as
    values would read every such coordinate as unjudged and null all four
    overalls. ``record_consensus`` writes both rows together, so a revealed run
    mid-consensus simply has a partial published set — and a partial set means
    an unjudged domain, which correctly yields an incomplete overall.
    """
    if peers_revealed and published_states:
        return published_states
    return current_values
