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

from app.core.logging import get_logger
from app.schemas.extraction_run import RunViewDerivedInput, RunViewDerivedJudgment
from app.services.derived_judgment_service import (
    compute_derived_judgments,
    derived_spec,
    spec_coordinates,
)

logger = get_logger(__name__)


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

    instance_by_entity_type: dict[Any, Any] = {}
    for inst in instances:
        # First instance wins, mirroring the export's ``instance_ids[0]``.
        instance_by_entity_type.setdefault(inst.entity_type_id, inst.id)
    value_by_ids = {(v.instance_id, v.field_id): v.value for v in values}

    values_by_coord: dict[tuple[str, str], Any] = {}
    known: set[tuple[str, str]] = set()
    label_by_section: dict[str, str] = {}
    for et in entity_types:
        instance_id = instance_by_entity_type.get(et.id)
        label_by_section[et.name] = getattr(et, "label", "") or et.name
        for field in et.fields:
            known.add((et.name, field.name))
            if instance_id is None:
                continue
            raw = value_by_ids.get((instance_id, field.id))
            if raw is not None:
                values_by_coord[(et.name, field.name)] = raw

    # A coordinate the template no longer carries is a definition bug that would
    # otherwise null an overall in silence: the spec is read live off the
    # template, while the coordinates come from the frozen version snapshot.
    unresolvable = sorted({c for c in spec_coordinates(spec) if c not in known})
    if unresolvable:
        logger.warning("qa_derived_spec_dangling_ref", coordinates=unresolvable)

    return [
        RunViewDerivedJudgment(
            id=d.id,
            label=d.label,
            value=d.value,
            # A collapse group names itself (it spans several sections); a plain
            # coordinate borrows its section's own label, so the breakdown reads
            # in the same words as the accordion the reviewer scrolls through.
            inputs=[
                RunViewDerivedInput(
                    label=inp.label or label_by_section.get(inp.section, inp.section),
                    value=inp.value,
                )
                for inp in d.inputs
            ],
        )
        for d in compute_derived_judgments(spec, values_by_coord)
    ]


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
