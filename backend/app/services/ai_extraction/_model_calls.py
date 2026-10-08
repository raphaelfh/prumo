"""The two model calls of a section: extract its fields, then (Verified
mode) verify them — and the ONE post-verify section snapshot.

Execution truth lives only in the section snapshot
(``results.provenance.sections[et_id].mode_executed`` / ``passes``); the
frozen engine's mode fields are a request-echo (``schemas/llm_target.py``).
Every call goes through the pipeline's ``StructuredCall``.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any
from uuid import UUID

from app.llm.claim_value import value_str_for_claim
from app.llm.extractor import LlmUsage
from app.llm.prompts import Scope
from app.llm.prompts.section import render_section_prompt
from app.llm.schema import build_output_models, dump_extraction
from app.llm.validators import evidence_is_plausible
from app.llm.verify import VerifyVerdict, run_verify_pass
from app.schemas.prompt_composition import PromptComposition, PromptCompositionArticleRef
from app.schemas.run_prompt_context import RunPromptContext
from app.services.ai_extraction._pipeline import Pipeline
from app.services.llm_field_filter import LlmFieldFilter
from app.services.run_engine_freeze import build_run_provenance

#: Stands in for the article text inside the persisted section_instruction,
#: so the composition is byte-faithful to the prompt without duplicating the
#: (multi-thousand-token) article per section.
ARTICLE_MARKDOWN_MARKER = "[[ARTICLE_MARKDOWN]]"


@dataclass(frozen=True)
class _SnapshotInputs:
    """What the section snapshot records about the extract call.

    ``fields`` are the fields actually SENT (the human-settled and
    assessor-owned ones already subtracted) — they name the composition's
    ``fields_requested`` and resolve the verify claims' labels and types.
    """

    prompt_name: str
    prompt_version: str
    section_name: str
    #: The entity type's human LABEL — the verify prompt's ENTITY line.
    section_label: str
    system_prompt: str
    section_instruction: str
    fields: list[Any]
    llm_calls: int


@dataclass(frozen=True)
class FieldCall:
    """One section's extraction: ``{field_name: {value, confidence,
    reasoning, evidence, status}}``, its usage, and — when a model ran —
    what the snapshot records about it."""

    extracted: dict[str, Any] = field(default_factory=dict)
    usage: LlmUsage = field(default_factory=LlmUsage)
    inputs: _SnapshotInputs | None = None


async def extract_fields(
    p: Pipeline,
    *,
    pdf_text: str,
    entity_type: Any,
    kind: str,
    framework: str | None,
    fields: list[Any] | None,
    memory_context: list[dict[str, str]] | None,
    prompt_context: RunPromptContext | None,
    field_filter: LlmFieldFilter,
    entry_scope: Scope | None,
) -> FieldCall:
    """Ask the model for one section's fields.

    ``fields`` is the exact list to send (``None``: the entity type's own),
    minus the template's assessor-owned coordinates in ``field_filter`` —
    subtracted HERE, the one seam every path funnels through, so none reaches
    the model. Oversized sections are split across calls and merged.
    """
    entity_name = str(entity_type.name)
    context = prompt_context or RunPromptContext()
    prompt = render_section_prompt(
        kind=kind,
        framework=framework,
        entity_name=entity_name,
        entity_description=getattr(entity_type, "description", None) or "",
        article_text=pdf_text,
        article_marker=ARTICLE_MARKDOWN_MARKER,
        memory_context=memory_context,
        general_instructions=context.general_instructions,
        review_context=context.review_context,
        entry_scope=entry_scope,
    )
    effective: list[Any] = fields if fields is not None else list(entity_type.fields or [])
    excluded = {f for s, f in field_filter.excluded_coordinates if s == entity_name}
    if excluded:
        effective = [f for f in effective if str(f.name) not in excluded]
    output_models = build_output_models(entity_type, fields=effective)
    if not output_models:
        p.logger.info(
            "extraction_skipped_no_fields", trace_id=p.trace_id, entity_type_name=entity_name
        )
        return FieldCall()

    await p.before_external_work()
    model = p.wire_model()
    extracted: dict[str, Any] = {}
    usage = LlmUsage()
    for output_model in output_models:
        output, call_usage = await p.llm(
            output_model=output_model,
            system_prompt=prompt.system_prompt,
            user_prompt=prompt.user_prompt,
            model=model,
            prompt_name=prompt.name,
            prompt_version=prompt.version,
            validators=[evidence_is_plausible],
        )
        extracted.update(dump_extraction(output))
        usage = usage + call_usage
    inputs = _SnapshotInputs(
        prompt_name=prompt.name,
        prompt_version=prompt.version,
        section_name=entity_name,
        section_label=str(getattr(entity_type, "label", None) or entity_name),
        system_prompt=prompt.system_prompt,
        section_instruction=prompt.section_instruction,
        fields=effective,
        llm_calls=len(output_models),
    )
    return FieldCall(extracted, usage, inputs)


async def verify_and_snapshot(
    p: Pipeline,
    *,
    run_id: UUID,
    entity_type_id: UUID,
    kind: str,
    pdf_text: str,
    call: FieldCall,
) -> tuple[dict[str, VerifyVerdict] | None, LlmUsage, dict[str, Any] | None]:
    """``(verdicts, usage, snapshot)``: the verify pass (mode and kind checks
    inside), then the ONE post-verify section snapshot with the extract +
    verify usage sum. No model ran → nothing to verify, no snapshot."""
    if call.inputs is None:
        return None, call.usage, None
    verdicts, verify_usage, mode_executed, passes = await _verify(
        p,
        kind=kind,
        pdf_text=pdf_text,
        extracted=call.extracted,
        inputs=call.inputs,
        log_context={
            "run_id": str(run_id),
            "entity_type_id": str(entity_type_id),
            "trace_id": p.trace_id,
        },
    )
    usage = call.usage + verify_usage
    snapshot = _section_snapshot(
        p, inputs=call.inputs, usage=usage, mode_executed=mode_executed, passes=passes
    )
    return verdicts, usage, snapshot


async def _verify(
    p: Pipeline,
    *,
    kind: str,
    pdf_text: str,
    extracted: dict[str, Any],
    inputs: _SnapshotInputs,
    log_context: dict[str, Any],
) -> tuple[dict[str, VerifyVerdict] | None, LlmUsage, str, int]:
    """``(verdicts | None, usage, mode_executed, passes)``.

    Fast mode is a no-op. A ``quality_assessment`` run SKIPS the pass even
    when the engine says verified: the prompt judges whether the text states
    a value — inapplicable to evaluative PROBAST-style judgments — and the
    skip records ``("fast", 1)`` under its own log. Verified runs one pass
    over the FOUND fields (a no-info proposal has no value to check); an
    all-no-info section short-circuits as ``("verified", 1)``. Any failure
    degrades to ``(None, zero usage, "fast", 1)`` and never aborts the run.
    """
    engine = p.engine
    if engine.mode_requested != "verified":
        return None, LlmUsage(), engine.mode_requested, 1
    if kind == "quality_assessment":
        p.logger.info("verify_skipped_qa_kind", **log_context)
        return None, LlmUsage(), "fast", 1
    by_name = {f.name: f for f in inputs.fields}
    proposals: list[tuple[str, str, str]] = []
    for field_name, value in extracted.items():
        if value.get("status") != "found":
            continue
        spec = by_name.get(field_name)
        proposals.append(
            (
                field_name,
                str(getattr(spec, "label", None) or field_name),
                value_str_for_claim(
                    field_type=getattr(spec, "field_type", None),
                    allowed_values=getattr(spec, "allowed_values", None),
                    value=value.get("value"),
                ),
            )
        )
    if not proposals:
        p.logger.info("verify_skipped_empty", **log_context)
        return {}, LlmUsage(), "verified", 1
    try:
        model = p.wire_model()
    except Exception as exc:
        p.logger.warning("verify_pass_failed", error=str(exc), **log_context)
        return None, LlmUsage(), "fast", 1
    outcome = await run_verify_pass(
        pdf_text=pdf_text,
        entity_type_label=inputs.section_label,
        proposals=proposals,
        model=model,
        logger=p.logger,
        log_context=log_context,
        extract=p.llm,
    )
    if outcome is None:
        return None, LlmUsage(), "fast", 1
    verdicts, usage = outcome
    return verdicts, usage, "verified", 2


def _section_snapshot(
    p: Pipeline,
    *,
    inputs: _SnapshotInputs,
    usage: LlmUsage,
    mode_executed: str,
    passes: int,
) -> dict[str, Any]:
    """Composition + provenance for one section: ``mode_requested`` off the
    frozen engine (the ask), ``mode_executed``/``passes`` off the verify
    outcome (the truth), plus the engine identity a proposal row carries."""
    info = p.prompt_input
    composition = PromptComposition(
        section_name=inputs.section_name,
        system_prompt=inputs.system_prompt,
        section_instruction=inputs.section_instruction,
        article_ref=PromptCompositionArticleRef(
            file_id=str(info.anchor_file_id) if info and info.anchor_file_id else None,
            file_name=info.file_name if info else None,
            truncated=info.truncated if info else False,
            est_tokens=info.est_tokens if info else None,
        ),
        fields_requested=[str(f.name) for f in inputs.fields],
        llm_calls=inputs.llm_calls,
    )
    snapshot = build_run_provenance(
        ran_by_user_id=p.user_id,
        engine=p.engine,
        key_scope=p.credentials.key_scope,
        prompt_name=inputs.prompt_name,
        prompt_version=inputs.prompt_version,
        usage=usage,
        prompt_composition=composition,
        mode_requested=p.engine.mode_requested,
        mode_executed=mode_executed,
        passes=passes,
    )
    return {**snapshot, "connection_id": p.engine.connection_id, "deviation": p.engine.deviation}
