"""One section into its instances: a singleton, or identify → resolve →
extract per entry for a repeating group.

A ``cardinality='many'`` section at any depth that declares an entry key
(``is_entity_key``) is an entry group. The identification prompt lists the
entries the article describes — grounded in the identities the article
already holds at this coordinate, so a re-run returns the existing spelling
instead of a new one (identity spec §5.2). Each entry's instance is reused or
created at the ``(article, entity_type, parent_instance)`` coordinate (§5.1),
then the section's fields are extracted once per entry with the prompt scoped
to that entry. A singleton runs extract → verify → land against the one
instance its coordinate has. Identity never branches on ``role``: the model
container reaches this code through the same door as a nested table.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any
from uuid import UUID

from app.llm.extractor import LlmUsage
from app.llm.prompts import Ancestor, Scope, entry_identification
from app.models.extraction import ExtractionInstance, ExtractionRun
from app.schemas.run_prompt_context import RunPromptContext
from app.services.ai_extraction._ancestry import ancestry_of, noun_of
from app.services.ai_extraction._candidates import build_candidates
from app.services.ai_extraction._model_calls import FieldCall, extract_fields, verify_and_snapshot
from app.services.ai_extraction._pipeline import Pipeline
from app.services.ai_extraction.landing import Generation, SingletonSlot
from app.services.entity_key import existing_keys, key_field_of


@dataclass(frozen=True)
class SectionOutcome:
    """What extracting one section into its instances produced.

    ``extracted_data`` is the LAST call's payload — the batch path summarizes
    it into the memory context, where one entry's shape is as good a hint as
    any. ``skipped`` marks a singleton whose every field was already
    human-settled, so no model call was spent.
    """

    suggestions_created: int = 0
    usage: LlmUsage = field(default_factory=LlmUsage)
    extracted_data: dict[str, Any] = field(default_factory=dict)
    skipped: bool = False


async def extract_into_instances(
    p: Pipeline,
    *,
    run: ExtractionRun,
    entity_type: Any,
    fields: list[Any] | None,
    parent_instance_id: UUID | None,
    pdf_text: str,
    kind: str = "extraction",
    framework: str | None = None,
    memory_context: list[dict[str, str]] | None = None,
    prompt_context: RunPromptContext | None = None,
    skip_fields_with_human_proposals: bool = False,
) -> SectionOutcome:
    """Extract one section into its instances — the seam every flow shares.

    A keyless repeating group refuses HERE, before any model call
    (``MissingEntityKeyError``). ``fields`` None means the entity type's own
    list (the live-row fallback of the single-section path).
    """
    args = _SectionArgs(
        run=run,
        entity_type=entity_type,
        parent_instance_id=parent_instance_id,
        pdf_text=pdf_text,
        kind=kind,
        framework=framework,
        memory_context=memory_context,
        prompt_context=prompt_context,
        skip_settled=skip_fields_with_human_proposals,
    )
    key_field = key_field_of(entity_type)
    if key_field is None:
        return await _extract_singleton(p, args, fields)
    entry_fields = fields if fields is not None else list(entity_type.fields or [])
    return await _extract_entry_group(p, args, key_field, entry_fields)


@dataclass(frozen=True)
class _SectionArgs:
    run: ExtractionRun
    entity_type: Any
    parent_instance_id: UUID | None
    pdf_text: str
    kind: str
    framework: str | None
    memory_context: list[dict[str, str]] | None
    prompt_context: RunPromptContext | None
    skip_settled: bool


async def _extract_singleton(
    p: Pipeline, a: _SectionArgs, fields: list[Any] | None
) -> SectionOutcome:
    """Extract → verify → land against the section's one instance."""
    if a.skip_settled and fields:
        instance = await _root_instance(p, a.run, a.entity_type.id)
        if instance is not None:
            fields = await p.fields_left_for(a.run, instance.id, fields)
            if not fields:
                return SectionOutcome(skipped=True)
    # The chain this singleton belongs to, re-verified ahead of the model
    # call; empty at the root, where there is nothing to scope to.
    ancestors = await ancestry_of(p, a.run, a.parent_instance_id)
    scope = Scope(entry_label=ancestors[-1].noun, ancestors=ancestors) if ancestors else None
    call = await _ask(p, a, fields, scope)
    count, usage = await _verify_and_land(p, a, SingletonSlot(a.parent_instance_id), call)
    return SectionOutcome(suggestions_created=count, usage=usage, extracted_data=call.extracted)


async def _extract_entry_group(
    p: Pipeline, a: _SectionArgs, key_field: Any, fields: list[Any]
) -> SectionOutcome:
    """Identify → resolve → extract, once per entry of a repeating group.

    Nested groups are scoped by ``parent_instance_id``: two models may each
    own an ``internal`` validation, and each gets its own instance under its
    own parent, with the prompt naming the whole chain above it.
    """
    ancestors = await ancestry_of(p, a.run, a.parent_instance_id)
    entry_label = noun_of(a.entity_type)
    names, usage = await _identify_entries(p, a, key_field, entry_label, ancestors)

    count = 0
    extracted: dict[str, Any] = {}
    for idx, name in enumerate(names):
        slot = await p.landing.open_entry(
            a.run,
            a.entity_type,
            parent_instance_id=a.parent_instance_id,
            key_value=name,
            sort_order=idx,
            fields=fields,
            attempt_id=p.attempt_id,
        )
        if slot is None:
            continue
        p.logger.info(
            "entry_instance_created" if slot.created else "entry_instance_reused",
            trace_id=p.trace_id,
            instance_id=str(slot.instance.id),
            entity_type_id=str(a.entity_type.id),
            key=name,
        )
        entry_fields = slot.fields
        if a.skip_settled and not slot.created:
            # A field the human already settled on THIS entry is not re-asked.
            entry_fields = await p.fields_left_for(a.run, slot.instance.id, entry_fields)
            if not entry_fields:
                continue
        scope = Scope(
            entry_label=entry_label,
            key_label=key_field.label,
            key_value=name,
            ancestors=ancestors,
        )
        call = await _ask(p, a, entry_fields, scope)
        written, call_usage = await _verify_and_land(p, a, slot.instance, call)
        count += written
        usage = usage + call_usage
        extracted = call.extracted
    return SectionOutcome(suggestions_created=count, usage=usage, extracted_data=extracted)


async def _ask(
    p: Pipeline, a: _SectionArgs, fields: list[Any] | None, scope: Scope | None
) -> FieldCall:
    return await extract_fields(
        p,
        pdf_text=a.pdf_text,
        entity_type=a.entity_type,
        kind=a.kind,
        framework=a.framework,
        fields=fields,
        memory_context=a.memory_context,
        prompt_context=a.prompt_context,
        field_filter=await p.field_filter(a.run),
        entry_scope=scope,
    )


async def _verify_and_land(
    p: Pipeline,
    a: _SectionArgs,
    instance: ExtractionInstance | SingletonSlot,
    call: FieldCall,
) -> tuple[int, LlmUsage]:
    """Verify the call, build its candidates, land them; ``(written, usage)``."""
    verdicts, usage, snapshot = await verify_and_snapshot(
        p,
        run_id=a.run.id,
        entity_type_id=a.entity_type.id,
        kind=a.run.kind,
        pdf_text=a.pdf_text,
        call=call,
    )
    section, candidates = await build_candidates(
        p, run=a.run, entity_type_id=a.entity_type.id, extracted=call.extracted, verdicts=verdicts
    )
    if not candidates:
        return 0, usage
    written = await p.landing.land(
        a.run, section, instance, candidates, Generation(p.engine, snapshot, p.attempt_id)
    )
    return written, usage


async def _identify_entries(
    p: Pipeline,
    a: _SectionArgs,
    key_field: Any,
    entry_label: str,
    ancestors: tuple[Ancestor, ...],
) -> tuple[list[str], LlmUsage]:
    """The entries the article describes for this group, as key values.

    The prompt is parameterized by the PINNED group: its label, its entry
    noun, the key field (label + choices) and its description as the
    instruction — and, for a nested group, scoped to the chain of enclosing
    entries, so model A's validation table does not list model B's. Reads
    instances only for the grounding list, never a reviewer-scoped value.
    """
    already = sorted(
        (
            await existing_keys(
                p.db,
                article_id=a.run.article_id,
                entity_type_id=a.entity_type.id,
                parent_instance_id=a.parent_instance_id,
            )
        ).keys()
    )
    context = a.prompt_context or RunPromptContext()
    await p.before_external_work()
    output, usage = await p.llm(
        output_model=entry_identification.EntryIdentificationOutput,
        system_prompt=entry_identification.system_prompt(entry_label),
        user_prompt=entry_identification.render(
            group_label=a.entity_type.label or a.entity_type.name,
            entry_label=entry_label,
            key_label=key_field.label,
            article_text=a.pdf_text,
            instruction=getattr(a.entity_type, "description", None),
            allowed_values=getattr(key_field, "allowed_values", None),
            general_instructions=context.general_instructions,
            review_context=context.review_context,
            existing_keys=already,
            ancestors=ancestors,
        ),
        model=p.wire_model(),
        prompt_name=entry_identification.NAME,
        prompt_version=entry_identification.VERSION,
    )
    names = [entry.name.strip() for entry in output.entries if entry.name.strip()]
    p.logger.info(
        "entries_identified",
        trace_id=p.trace_id,
        entity_type_id=str(a.entity_type.id),
        identified=len(names),
        already_known=len(already),
    )
    return names, usage


async def _root_instance(
    p: Pipeline, run: ExtractionRun, entity_type_id: UUID
) -> ExtractionInstance | None:
    """The root singleton's instance — only the full-run sweep skips settled
    fields, and it passes no parent. Repeating groups never reach this: they
    resolve one instance per entry."""
    return await p.instances.first_of_section(run.article_id, entity_type_id)
