"""Model output → :class:`ProposalCandidate` rows, with grounded evidence.

Runs after the model calls and before the landing: every field the model
answered becomes ONE candidate, mapped in order (ADR-0016 Amendment
2026-10): an offered ``absent_reason`` becomes its typed marker (an un-offered
code is logged, never written); an in-domain option answer (e.g. ``NI``) is
kept whatever the status; an uncertainty scale's ``not_found`` stores the
scale's own ``Unclear`` code; any other ``not_found`` becomes the
no-information marker when the field allows it, else a bare null — traceable,
never silently dropped; a ``found`` / ``ambiguous`` value lands as answered.
Each cited ``{block_ref, quote}`` of a candidate that stores something (a
value or a marker other than no-information) becomes an evidence row anchored
to the run's parsed blocks (the cited block's window first): a grounded row
stores the source slice and the anchor's page, never a page from the model; an
unanchored one stores no page and is flagged ``ungroundable`` whatever its
status. Grounded quotes of found values (never of a marker) go through the
entailment gate.
"""

from __future__ import annotations

from typing import Any, cast
from uuid import UUID

from app.domain.evidence_block_refs import parse_block_ref, ref_window
from app.infrastructure.parsing.base import concat_page_text
from app.llm.claim_value import value_str_for_claim
from app.llm.entailment import GateSpec, run_entailment_gate
from app.llm.extractor import LlmUsage
from app.llm.schema import offered_absent_codes, option_codes, uncertain_code
from app.llm.verify import VerificationAnnotation, VerifyVerdict
from app.models.extraction import ExtractionEvidence, ExtractionRun
from app.schemas.extraction import PositionV1
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
    grounding_retries: int = 0,
) -> tuple[Any, list[ProposalCandidate], LlmUsage]:
    """``(live section, candidates, entailment usage)`` for one field call;
    the usage is summed over the entailment judge calls that answered (zero
    when none ran).

    Field names resolve against the LIVE entity type — the prompt carried
    live names (``Pipeline.live_field_intersection``); a name it no longer
    has is skipped loudly. ``verdicts`` (Verified mode) are ANNOTATION only,
    the ``verification`` sibling on a found value — never a mutation (§IX).
    ``grounding_retries`` (the validator's send-backs for this call) is
    logged with the grounded/ungrounded counts as ``evidence_grounding``.
    """
    if not extracted:
        p.logger.info(
            "no_data_to_create_suggestions",
            trace_id=p.trace_id,
            entity_type_id=str(entity_type_id),
        )
        return None, [], LlmUsage()
    section = await p.entity_types.get_with_fields(entity_type_id)
    if not section:
        p.logger.error(
            "entity_type_not_found", trace_id=p.trace_id, entity_type_id=str(entity_type_id)
        )
        return None, [], LlmUsage()
    by_name = {f.name: f for f in section.fields or []}
    # Drift guard: a verdict keyed outside the field vocabulary would
    # silently annotate nothing — be loud instead.
    for unmatched in set(verdicts or ()) - set(by_name):
        p.logger.warning("verify_verdict_unmatched", trace_id=p.trace_id, field=unmatched)

    candidates: list[ProposalCandidate] = []
    gate_specs: list[GateSpec] = []
    gate_rows: list[ExtractionEvidence] = []
    page_texts = concat_page_text(p.anchor_blocks) if p.anchor_blocks else {}
    grounded = ungrounded = 0
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
        candidate = _candidate(spec, answer, verdicts, logger=p.logger)
        candidates.append(candidate)
        stored = candidate.proposed_value
        judged = answer.get("status") == "found" and "absent_reason" not in stored
        for rank, quote in enumerate(_quotes(answer, stored)[:EVIDENCE_CAP]):
            row, pos = _evidence(p, run, quote, rank, page_texts)
            candidate.evidence.append(row)
            if pos is None:
                ungrounded += 1
                continue
            grounded += 1
            if not judged:
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
                    # The judge reads the source slice a grounded row always
                    # carries, never the model's words.
                    quote=cast(str, row.text_content),
                    pos=pos,
                    anchor_blocks=p.anchor_blocks,
                )
            )
            gate_rows.append(row)

    p.logger.info(
        "evidence_grounding",
        trace_id=p.trace_id,
        entity_type_id=str(entity_type_id),
        grounded=grounded,
        ungrounded=ungrounded,
        retried=grounding_retries,
    )
    entailment_usage = LlmUsage()
    if gate_specs:
        await p.before_external_work()
        labels, entailment_usage = await run_entailment_gate(
            gate_specs, p.wire_model(), p.logger, extract=p.llm
        )
        for row, label in zip(gate_rows, labels, strict=True):
            if label is not None:
                row.attribution_label = label
    return section, candidates, entailment_usage


def _candidate(
    spec: Any,
    answer: dict[str, Any],
    verdicts: dict[str, VerifyVerdict] | None,
    *,
    logger: Any,
) -> ProposalCandidate:
    """One field's proposal, by the first rule that applies (module
    docstring). The JSONB value is always wrapped (``{"value": ...}``) so
    scalars and lists read back uniformly. A marker or a ``not_found`` answer
    drops the confidence (a not_found 0.0 reads as a misleading 0%) and keeps
    the reasoning. Flags are read from the LIVE row while the form reads the
    run's frozen snapshot — a mid-run republish can skew them."""
    reasoning = answer.get("reasoning")
    code = _offered_absent_reason(spec, answer, logger)
    if code is not None:
        return _proposal(spec, {"value": None, "absent_reason": code}, None, reasoning)
    value = answer.get("value")
    not_found = answer.get("status") == "not_found"
    if not_found and not _in_domain(spec, value):
        unclear = uncertain_code(spec)
        if unclear is not None:
            # An uncertainty scale answers Unclear, never a marker (PRU-66).
            return _proposal(spec, {"value": unclear}, None, reasoning)
        absent: dict[str, Any] = {"value": None}
        # Gated by ``allows_no_information`` (0062) like the human write path:
        # on an opted-out field the marker would be invisible AND unclearable
        # yet still count as filled.
        if AbsentReason.NO_INFORMATION.value in offered_absent_codes(spec):
            absent["absent_reason"] = AbsentReason.NO_INFORMATION.value
        return _proposal(spec, absent, None, reasoning)
    stored: dict[str, Any] = {"value": value}
    if verdicts and spec.name in verdicts:
        stored["verification"] = VerificationAnnotation(verdict=verdicts[spec.name]).model_dump()
    confidence = None if not_found else answer.get("confidence")
    return _proposal(spec, stored, confidence, reasoning)


def _proposal(
    spec: Any, value: dict[str, Any], confidence: float | None, reasoning: str | None
) -> ProposalCandidate:
    return ProposalCandidate(spec.id, spec.name, value, confidence, reasoning)


def _offered_absent_reason(spec: Any, answer: dict[str, Any], logger: Any) -> str | None:
    """The answer's ``absent_reason`` when the field offers it; an un-offered
    code is logged and read as null (it is never written)."""
    code = answer.get("absent_reason")
    if not code:
        return None
    if code in offered_absent_codes(spec):
        return str(code)
    logger.warning("absent_reason_not_offered", field=spec.name, code=code)
    return None


def _in_domain(spec: Any, value: Any) -> bool:
    """True when ``value`` is one of the field's option codes — for a list,
    non-empty with every item a code. A field without options has no domain."""
    codes = set(option_codes(spec))
    if not codes:
        return False
    if isinstance(value, list):
        return bool(value) and all(item in codes for item in value)
    return value in codes


def _quotes(answer: dict[str, Any], stored: dict[str, Any]) -> list[dict[str, Any]]:
    """The cited ``{quote, block_ref}`` entries with a quote; a stored bare
    null or no-information marker cites none."""
    if stored.get("value") is None and stored.get("absent_reason") in (
        None,
        AbsentReason.NO_INFORMATION.value,
    ):
        return []
    return [
        {"quote": str(e["quote"]).strip(), "block_ref": e.get("block_ref")}
        for e in answer.get("evidence") or []
        if (e.get("quote") or "").strip()
    ]


def _evidence(
    p: Pipeline,
    run: ExtractionRun,
    quote: dict[str, Any],
    rank: int,
    page_texts: dict[int, str],
) -> tuple[ExtractionEvidence, PositionV1 | None]:
    """The evidence row for one quote, anchored to the run's parsed blocks —
    the cited block's window first (``build_anchor``'s ``hint``).

    Grounded: page and ``position`` from the anchor (whose ``quote`` keeps
    the model's words) and ``text_content`` the exact source slice.
    Ungrounded: no page, ``position={}``, the model's quote, ``ungroundable``
    (e.g. a value only a figure states) — the model never supplies a page.
    """
    ref = parse_block_ref(quote["block_ref"] or "")
    window = ref_window(p.block_ref_index, ref) if ref else None
    pos = build_anchor(quote["quote"], p.anchor_blocks, hint=window) if p.anchor_blocks else None
    if pos is None or pos.anchor.kind == "region":
        row = ExtractionEvidence(
            project_id=run.project_id,
            article_id=run.article_id,
            run_id=run.id,
            page_number=None,
            text_content=quote["quote"],
            position={},
            attribution_label="ungroundable",
            rank=rank,
            created_by=UUID(p.user_id),
        )
        return row, None
    span = pos.anchor.range
    row = ExtractionEvidence(
        project_id=run.project_id,
        article_id=run.article_id,
        article_file_id=p.anchor_file_id,
        content_version=p.anchor_content_version,
        run_id=run.id,
        page_number=span.page,
        text_content=page_texts[span.page][span.char_start : span.char_end],
        position=pos.model_dump(by_alias=True, mode="json"),
        rank=rank,
        created_by=UUID(p.user_id),
    )
    return row, pos
