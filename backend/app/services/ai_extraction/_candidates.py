"""Model output → :class:`ProposalCandidate` rows, with grounded evidence.

Runs after the model calls and before the landing: every field the model
answered becomes ONE candidate — a found value, an ``ambiguous`` value (a
needs-attention proposal, ADR-0016 Phase 1), or a ``not_found`` abstention
recorded as the coded no-information marker so the outcome is traceable
instead of silently dropped. Each cited quote becomes an evidence row
anchored to the run's parsed blocks; anchored quotes of found values go
through the entailment gate, unanchored ones are flagged ``ungroundable``.
"""

from __future__ import annotations

from typing import Any
from uuid import UUID

from app.llm.claim_value import value_str_for_claim
from app.llm.entailment import GateSpec, run_entailment_gate
from app.llm.verify import VerificationAnnotation, VerifyVerdict
from app.models.extraction import ExtractionEvidence, ExtractionRun
from app.services.ai_extraction._pipeline import Pipeline
from app.services.ai_extraction.landing import ProposalCandidate
from app.services.evidence_anchor_service import build_anchor
from app.services.value_semantics import AbsentReason

#: Evidence rows written per extracted field, at most.
EVIDENCE_CAP = 3


async def build_candidates(
    p: Pipeline,
    *,
    run: ExtractionRun,
    entity_type_id: UUID,
    extracted: dict[str, Any],
    verdicts: dict[str, VerifyVerdict] | None,
) -> tuple[Any, list[ProposalCandidate]]:
    """``(live section, candidates)`` for one field call.

    Field names resolve against the LIVE entity type — the prompt carried
    live names (``Pipeline.live_field_intersection``); a name it no longer
    has is skipped loudly. ``verdicts`` (Verified mode) are ANNOTATION only,
    the ``verification`` sibling on a found value — never a mutation (§IX).
    """
    if not extracted:
        p.logger.info(
            "no_data_to_create_suggestions",
            trace_id=p.trace_id,
            entity_type_id=str(entity_type_id),
        )
        return None, []
    section = await p.entity_types.get_with_fields(entity_type_id)
    if not section:
        p.logger.error(
            "entity_type_not_found", trace_id=p.trace_id, entity_type_id=str(entity_type_id)
        )
        return None, []
    by_name = {f.name: f for f in section.fields or []}
    # Drift guard: a verdict keyed outside the field vocabulary would
    # silently annotate nothing — be loud instead.
    for unmatched in set(verdicts or ()) - set(by_name):
        p.logger.warning("verify_verdict_unmatched", trace_id=p.trace_id, field=unmatched)

    candidates: list[ProposalCandidate] = []
    gate_specs: list[GateSpec] = []
    gate_rows: list[ExtractionEvidence] = []
    for field_name, answer in extracted.items():
        spec = by_name.get(field_name)
        if spec is None:
            p.logger.warning(
                "field_not_found_for_suggestion",
                trace_id=p.trace_id,
                field_name=field_name,
                available_fields=list(by_name),
            )
            continue
        candidate = _candidate(spec, answer, verdicts)
        candidates.append(candidate)
        found = answer.get("status") == "found"
        for rank, quote in enumerate(_quotes(answer)[:EVIDENCE_CAP]):
            row, pos = _evidence(p, run, quote, rank)
            candidate.evidence.append(row)
            if not found:
                continue
            if pos is None:
                # No text anchor → the value cannot be grounded in the document
                # (e.g. it appears only in a figure): flag it for a human.
                row.attribution_label = "ungroundable"
                continue
            gate_specs.append(
                GateSpec(
                    field_label=spec.label or spec.name,
                    # A select/boolean CODE ("Y") reads as its label ("Yes")
                    # in the judge claim; numbers, dates and text pass through.
                    value_str=value_str_for_claim(
                        field_type=spec.field_type,
                        allowed_values=spec.allowed_values,
                        value=answer.get("value"),
                    ),
                    quote=quote["text"],
                    pos=pos,
                    anchor_blocks=p.anchor_blocks,
                )
            )
            gate_rows.append(row)

    if gate_specs:
        await p.before_external_work()
        labels = await run_entailment_gate(gate_specs, p.wire_model(), p.logger, extract=p.llm)
        for row, label in zip(gate_rows, labels, strict=True):
            if label is not None:
                row.attribution_label = label
    return section, candidates


def _candidate(
    spec: Any, answer: dict[str, Any], verdicts: dict[str, VerifyVerdict] | None
) -> ProposalCandidate:
    """One field's proposal. The JSONB value is always wrapped
    (``{"value": ...}``) so scalars and lists read back uniformly."""
    if answer.get("status") == "not_found":
        # The no-info value is null — never the status dict; the abstention
        # confidence is dropped (a not_found 0.0 reads as a misleading 0%) and
        # the "why not found" reasoning kept. The coded marker is gated by
        # ``allows_no_information`` (0062) like the human write path: on an
        # opted-out field it would be invisible AND unclearable yet still
        # count as filled. Reads the LIVE row while the form reads the run's
        # frozen snapshot — a mid-run republish can skew them.
        value: dict[str, Any] = {"value": None}
        if spec.allows_no_information:
            value["absent_reason"] = AbsentReason.NO_INFORMATION.value
        return ProposalCandidate(spec.id, spec.name, value, None, answer.get("reasoning"))
    value = {"value": answer.get("value")}
    if verdicts and spec.name in verdicts:
        value["verification"] = VerificationAnnotation(verdict=verdicts[spec.name]).model_dump()
    return ProposalCandidate(
        spec.id, spec.name, value, answer.get("confidence"), answer.get("reasoning")
    )


def _quotes(answer: dict[str, Any]) -> list[dict[str, Any]]:
    """The cited quotes with text; a no-info answer cites none."""
    if answer.get("status") == "not_found":
        return []
    return [
        {"text": str(e["text"]).strip(), "page_number": e.get("page_number")}
        for e in answer.get("evidence") or []
        if (e.get("text") or "").strip()
    ]


def _evidence(
    p: Pipeline, run: ExtractionRun, quote: dict[str, Any], rank: int
) -> tuple[ExtractionEvidence, Any]:
    """The evidence row for one quote, anchored to the run's parsed blocks
    (``position={}`` and the model's page when no anchor resolves)."""
    pos = build_anchor(quote["text"], p.anchor_blocks) if p.anchor_blocks else None
    if pos is not None:
        position: dict[str, Any] = pos.model_dump(by_alias=True, mode="json")
        page: int | None = pos.anchor.page if pos.anchor.kind == "region" else pos.anchor.range.page
    else:
        position, page = {}, quote.get("page_number")
    row = ExtractionEvidence(
        project_id=run.project_id,
        article_id=run.article_id,
        article_file_id=p.anchor_file_id if pos is not None else None,
        run_id=run.id,
        proposal_record_id=None,
        page_number=page,
        text_content=quote["text"],
        position=position,
        rank=rank,
        created_by=UUID(p.user_id),
    )
    return row, pos
