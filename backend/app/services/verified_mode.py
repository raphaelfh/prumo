"""Verified-mode glue + the per-section snapshot build (§5).

Policy glue in the ``run_engine_freeze.py`` shape — pure functions of
explicit params, shared by the three extraction call sites in
``SectionExtractionService``. The service no longer builds the section
snapshot itself: ``_extract_with_llm`` stashes :class:`SectionSnapshotInputs`
and the glue builds the snapshot ONCE, post-verify, so ``mode_executed`` /
``passes`` are typed params of the single build — never a post-hoc dict
poke into service state.

Execution truth lives ONLY in the section snapshot
(``results.provenance.sections[et_id].mode_executed`` / ``passes``); the
frozen engine dict's mode fields are a request-echo (see
``schemas/llm_target.py``).
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING, Any
from uuid import UUID

from app.llm.claim_value import value_str_for_claim
from app.llm.extractor import LlmUsage
from app.llm.prompts import quality_assessment, section_extraction
from app.llm.provider import build_model
from app.llm.verify import VerifyVerdict, run_verify_pass
from app.schemas.llm_target import LlmTarget
from app.schemas.prompt_composition import PromptComposition, PromptCompositionArticleRef
from app.schemas.run_prompt_context import RunPromptContext
from app.services.run_engine_freeze import build_run_provenance

if TYPE_CHECKING:
    from app.services.api_key_service import KeyScope
    from app.services.extraction_prompt_input import PromptInputInfo


@dataclass(frozen=True)
class SectionSnapshotInputs:
    """Everything ``build_section_snapshot`` needs from the extract pass.

    ``fields`` are the fields actually SENT to the LLM (the human-settled
    override when a QA re-run filtered some out, #481, else the entity
    type's full set) — they name the composition's ``fields_requested`` and
    resolve verify-claim labels/types.
    """

    prompt_name: str
    prompt_version: str
    section_name: str
    #: The entity type's human LABEL — what the verify prompt grounds its
    #: ENTITY line in (the composition keeps ``section_name`` = the name).
    section_label: str
    system_prompt: str
    section_instruction: str
    fields: list[Any]
    llm_calls: int


def render_section_prompts(
    *,
    kind: str,
    framework: str | None,
    entity_name: str,
    entity_description: str,
    article_text: str,
    article_marker: str,
    memory_context: list[dict[str, str]] | None,
    prompt_context: RunPromptContext | None,
) -> tuple[str, str, str, str, str]:
    """(prompt_name, prompt_version, system_prompt, user_prompt, section_instruction).

    Renders the SAME template twice — once with the real article, once with
    the article replaced by *article_marker* — so the persisted composition
    is byte-faithful to what was sent without duplicating the
    (multi-thousand-token) article per section.

    ``prompt_context`` is unpacked HERE rather than by the caller: the prompt
    modules take plain strings (no schema import), and doing it at the one
    seam keeps ``section_extraction_service`` — which sits on its file-size
    ratchet cap — free of the extra lines.
    """
    context = prompt_context or RunPromptContext()
    if kind == "quality_assessment":
        module: Any = quality_assessment
        system_prompt = quality_assessment.system_prompt(framework)
        user_prompt, section_instruction = (
            quality_assessment.render(
                entity_name=entity_name,
                entity_description=entity_description,
                article_text=text,
                framework=framework,
                memory_context=memory_context,
                general_instructions=context.general_instructions,
                review_context=context.review_context,
            )
            for text in (article_text, article_marker)
        )
    else:
        module = section_extraction
        system_prompt = section_extraction.SYSTEM_PROMPT
        user_prompt, section_instruction = (
            section_extraction.render(
                entity_name=entity_name,
                entity_description=entity_description,
                article_text=text,
                memory_context=memory_context,
                general_instructions=context.general_instructions,
                review_context=context.review_context,
            )
            for text in (article_text, article_marker)
        )
    return module.NAME, module.VERSION, system_prompt, user_prompt, section_instruction


async def verify_section(
    *,
    engine: LlmTarget,
    api_key: str | None,
    base_url: str | None = None,
    kind: str,
    pdf_text: str,
    extracted_data: dict[str, Any],
    fields: list[Any],
    entity_type_label: str,
    run_id: UUID,
    entity_type_id: UUID,
    trace_id: str,
    logger: Any,
) -> tuple[dict[str, VerifyVerdict] | None, LlmUsage, str, int]:
    """The verify pass, mode check INSIDE (so every fast path executes the
    call site); returns ``(verdicts | None, verify_usage, mode_executed,
    passes)``.

    Fast mode is a pure no-op. A ``quality_assessment`` run SKIPS the pass
    even when the engine says verified: the prompt judges whether the text
    states a value — inapplicable to evaluative PROBAST-style judgments,
    which would draw systematic "uncertain" chips on legitimate assessments.
    The skip records ``("fast", 1)`` under its own DISTINCT log
    (``verify_skipped_qa_kind``), never confusable with a flake. Verified
    runs one ``run_verify_pass`` on the run's frozen engine over the FOUND
    fields only (a no-info proposal has no value to check); an all-no-info
    section short-circuits as ``("verified", 1)`` — nothing needed
    verifying, not a degrade, and ``passes`` counts LLM passes that RAN.
    Any failure degrades to ``(None, zero usage, "fast", 1)`` — recorded in
    the section snapshot, never aborting the run (design 3). ``base_url``
    rides along with the key: an endpoint engine (C2) has no host without
    it, and ``build_model`` would raise inside the degrade path — every
    Verified section on a custom endpoint would silently execute fast.
    """
    if engine.mode_requested != "verified":
        return None, LlmUsage(), engine.mode_requested, 1
    context = {
        "run_id": str(run_id),
        "entity_type_id": str(entity_type_id),
        "trace_id": trace_id,
    }
    if kind == "quality_assessment":
        logger.info("verify_skipped_qa_kind", **context)
        return None, LlmUsage(), "fast", 1
    by_name = {f.name: f for f in fields}
    proposals: list[tuple[str, str, str]] = []
    for field_name, value in extracted_data.items():
        if not (isinstance(value, dict) and value.get("status") == "found"):
            continue
        field = by_name.get(field_name)
        proposals.append(
            (
                field_name,
                str(getattr(field, "label", None) or field_name),
                value_str_for_claim(
                    field_type=getattr(field, "field_type", None),
                    allowed_values=getattr(field, "allowed_values", None),
                    value=value.get("value", value),
                ),
            )
        )
    if not proposals:
        logger.info("verify_skipped_empty", **context)
        return {}, LlmUsage(), "verified", 1
    try:
        model = build_model(engine.provider, engine.model, api_key=api_key, base_url=base_url)
    except Exception as exc:
        logger.warning("verify_pass_failed", error=str(exc), **context)
        return None, LlmUsage(), "fast", 1
    outcome = await run_verify_pass(
        pdf_text=pdf_text,
        entity_type_label=entity_type_label,
        proposals=proposals,
        model=model,
        logger=logger,
        log_context=context,
    )
    if outcome is None:
        return None, LlmUsage(), "fast", 1
    verdicts, usage = outcome
    return verdicts, usage, "verified", 2


async def verify_and_snapshot(
    *,
    engine: LlmTarget,
    api_key: str | None,
    base_url: str | None = None,
    kind: str,
    key_scope: KeyScope | None,
    ran_by_user_id: str,
    pdf_text: str,
    extracted_data: dict[str, Any],
    extract_usage: LlmUsage,
    inputs: SectionSnapshotInputs | None,
    prompt_input_info: PromptInputInfo | None,
    run_id: UUID,
    entity_type_id: UUID,
    trace_id: str,
    logger: Any,
) -> tuple[dict[str, VerifyVerdict] | None, LlmUsage, dict[str, Any] | None]:
    """The service's one glue call: verify (mode + kind checks inside), then
    the ONE post-verify section-snapshot build with the extract + verify
    usage sum.

    ``inputs is None`` (no LLM ran) is a pure pass-through — nothing to
    verify, nothing to snapshot.
    """
    if inputs is None:
        return None, extract_usage, None
    verdicts, verify_usage, mode_executed, passes = await verify_section(
        engine=engine,
        api_key=api_key,
        base_url=base_url,
        kind=kind,
        pdf_text=pdf_text,
        extracted_data=extracted_data,
        fields=inputs.fields,
        entity_type_label=inputs.section_label,
        run_id=run_id,
        entity_type_id=entity_type_id,
        trace_id=trace_id,
        logger=logger,
    )
    usage = extract_usage + verify_usage
    snapshot = build_section_snapshot(
        inputs=inputs,
        ran_by_user_id=ran_by_user_id,
        engine=engine,
        key_scope=key_scope,
        usage=usage,
        prompt_input_info=prompt_input_info,
        mode_executed=mode_executed,
        passes=passes,
    )
    return verdicts, usage, snapshot


def build_section_snapshot(
    *,
    inputs: SectionSnapshotInputs,
    ran_by_user_id: str,
    engine: LlmTarget,
    key_scope: KeyScope | None,
    usage: LlmUsage,
    prompt_input_info: PromptInputInfo | None,
    mode_executed: str,
    passes: int,
) -> dict[str, Any]:
    """The ONE post-verify section-snapshot build (composition + provenance).

    *usage* is the extract + verify sum, so the section tokens report what
    the section actually cost; ``mode_requested`` comes off the frozen
    engine (the ask), ``mode_executed``/``passes`` off the verify outcome
    (the truth).
    """
    info = prompt_input_info
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
    return build_run_provenance(
        ran_by_user_id=ran_by_user_id,
        engine=engine,
        key_scope=key_scope,
        prompt_name=inputs.prompt_name,
        prompt_version=inputs.prompt_version,
        usage=usage,
        prompt_composition=composition,
        mode_requested=engine.mode_requested,
        mode_executed=mode_executed,
        passes=passes,
    )
