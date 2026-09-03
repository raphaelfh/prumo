"""Identify → resolve → extract per entry, for every repeating group.

The model pipeline (``model_extraction_service``) generalized: a
``cardinality='many'`` section at any depth that declares an entry key
(``is_entity_key``) is extracted in three steps. The identification prompt
lists the entries the article describes — grounded in the identities the
article already holds at this coordinate, so a re-run returns the existing
spelling instead of a new one (identity spec §5.2). The resolver reuses or
creates one instance per entry at the ``(article, entity_type,
parent_instance)`` coordinate (§5.1). The section's fields are then
extracted once per entry, with the prompt scoped to that entry, and every
entry's proposals flow through the same ``_create_suggestions``
choke-point a singleton's do — pointed at the entry's own instance. There
is no one-call multi-entry output contract.

:func:`extract_into_instances` is the seam all three service paths share
(single section, full-run sweep, per-model batch): a repeating group takes
the pipeline above, a singleton runs the familiar extract → verify → record
sequence against the one instance its coordinate has. It lives beside
``SectionExtractionService`` rather than inside it because that file sits on
its file-size ceiling; the functions take the service and use its LLM
helpers so the three paths stay one implementation. Identity never branches
on ``role``: the model container reaches this code through the same door as
a nested performance table.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any
from uuid import UUID

from app.llm.extractor import LlmUsage, extract_structured
from app.llm.prompts import EntryScope, entry_identification
from app.schemas.run_prompt_context import RunPromptContext
from app.services.entity_key import existing_keys, key_field_of, resolve_instance

if TYPE_CHECKING:
    from app.models.extraction import ExtractionRun
    from app.services.section_extraction_service import SectionExtractionService

#: Noun for a repeating section whose ``entry_label`` is unset (pre-B-8
#: snapshots; the container defaults to ``model`` at create time instead).
DEFAULT_ENTRY_NOUN = "entry"


@dataclass(frozen=True)
class SectionOutcome:
    """What extracting one section into its instances produced.

    ``extracted_data`` is the LAST call's payload — the batch path summarizes
    it into the memory context, where one entry's shape is as good a hint as
    any. ``skipped`` marks the singleton case where every field was already
    human-settled and no LLM call was spent.
    """

    suggestions_created: int = 0
    usage: LlmUsage = field(default_factory=LlmUsage)
    extracted_data: dict[str, Any] = field(default_factory=dict)
    skipped: bool = False


async def _identify_entries(
    service: SectionExtractionService,
    *,
    run: ExtractionRun,
    entity_type: Any,
    key_field: Any,
    entry_label: str,
    parent_instance_id: UUID | None,
    parent_label: str | None,
    article_text: str,
    prompt_context: RunPromptContext | None,
) -> tuple[list[str], LlmUsage]:
    """The entries the article describes for this group, as key values.

    The prompt is parameterized by the PINNED group: its label, its entry
    noun, the key field (label + choices) and its description as the
    instruction — and, for a nested group, scoped to the parent entry the
    way the grounding list already is, so model A's validation table does
    not list model B's validations. Reads instances only for the grounding
    list — never a reviewer-scoped value (spec §5.1.1).
    """
    already = sorted(
        (
            await existing_keys(
                service.db,
                article_id=run.article_id,
                entity_type_id=entity_type.id,
                parent_instance_id=parent_instance_id,
            )
        ).keys()
    )
    context = prompt_context or RunPromptContext()
    output, usage = await extract_structured(
        output_model=entry_identification.EntryIdentificationOutput,
        system_prompt=entry_identification.system_prompt(entry_label),
        user_prompt=entry_identification.render(
            group_label=entity_type.label or entity_type.name,
            entry_label=entry_label,
            key_label=key_field.label,
            article_text=article_text,
            instruction=getattr(entity_type, "description", None),
            allowed_values=getattr(key_field, "allowed_values", None),
            general_instructions=context.general_instructions,
            review_context=context.review_context,
            existing_keys=already,
            parent_label=parent_label,
        ),
        model=service._wire_model(),
        prompt_name=entry_identification.NAME,
        prompt_version=entry_identification.VERSION,
    )
    names = [entry.name.strip() for entry in output.entries if entry.name.strip()]
    service.logger.info(
        "entries_identified",
        trace_id=service.trace_id,
        entity_type_id=str(entity_type.id),
        identified=len(names),
        already_known=len(already),
    )
    return names, usage


async def _extract_entry_group(
    service: SectionExtractionService,
    *,
    run: ExtractionRun,
    entity_type: Any,
    key_field: Any,
    fields: list[Any],
    parent_instance_id: UUID | None,
    pdf_text: str,
    kind: str,
    framework: str | None,
    memory_context: list[dict[str, str]] | None,
    prompt_context: RunPromptContext | None,
    skip_fields_with_human_proposals: bool,
) -> SectionOutcome:
    """Identify → resolve → extract, once per entry of a repeating group.

    ``key_field`` is the group's declared key as :func:`entity_key.key_field_of`
    returned it — resolving it first is what makes a keyless group refuse
    before this function spends an LLM call. Nested groups are scoped by
    ``parent_instance_id``: two models may each own an ``internal``
    validation, and each gets its own instance under its own parent.
    """
    parent = None
    if parent_instance_id is not None:
        # Re-verified here, like the singleton auto-create: the instances
        # written below carry this id as a foreign key.
        parent = await service._instances.get_on_run(parent_instance_id, run)
        if parent is None:
            raise ValueError(f"Parent instance not found: {parent_instance_id}")

    entry_label = getattr(entity_type, "entry_label", None) or DEFAULT_ENTRY_NOUN
    names, usage = await _identify_entries(
        service,
        run=run,
        entity_type=entity_type,
        key_field=key_field,
        entry_label=entry_label,
        parent_instance_id=parent_instance_id,
        parent_label=parent.label if parent is not None else None,
        article_text=pdf_text,
        prompt_context=prompt_context,
    )

    count = 0
    extracted: dict[str, Any] = {}
    for idx, name in enumerate(names):
        instance, created = await resolve_instance(
            service.db,
            project_id=run.project_id,
            article_id=run.article_id,
            template_id=run.template_id,
            entity_type_id=entity_type.id,
            parent_instance_id=parent_instance_id,
            key_value=name,
            sort_order=idx,
            created_by=UUID(service.user_id),
            metadata={"ai_extracted": True, "ai_run_id": str(run.id)},
        )
        service.logger.info(
            "entry_instance_created" if created else "entry_instance_reused",
            trace_id=service.trace_id,
            instance_id=str(instance.id),
            entity_type_id=str(entity_type.id),
            key=name,
        )
        entry_fields = fields
        if skip_fields_with_human_proposals and not created:
            # Same per-field guard as a singleton re-run, per instance: a
            # field the human already settled on THIS entry is not re-asked.
            entry_fields = await _fields_left_for(service, run, instance.id, fields)
            if not entry_fields:
                continue
        scope = EntryScope(
            entry_label=entry_label,
            key_label=key_field.label,
            key_value=name,
            parent_label=parent.label if parent is not None else None,
        )
        extracted, call_usage = await service._extract_with_llm(
            pdf_text=pdf_text,
            entity_type=entity_type,
            kind=kind,
            framework=framework,
            fields_override=entry_fields,
            memory_context=memory_context,
            prompt_context=prompt_context,
            field_filter=await service._field_filter(run),
            entry_scope=scope,
        )
        verdicts, call_usage = await service._maybe_verify(
            run.id, entity_type.id, run.kind, pdf_text, extracted, call_usage
        )
        count += await service._create_suggestions(
            project_id=run.project_id,
            article_id=run.article_id,
            entity_type_id=entity_type.id,
            parent_instance_id=parent_instance_id,
            extracted_data=extracted,
            run=run,
            verdicts=verdicts,
            instance=instance,
        )
        usage = usage + call_usage

    return SectionOutcome(suggestions_created=count, usage=usage, extracted_data=extracted)


async def _fields_left_for(
    service: SectionExtractionService, run: ExtractionRun, instance_id: UUID, fields: list[Any]
) -> list[Any]:
    """``fields`` minus those the human already settled on this instance, on
    EITHER track: a ``human`` proposal (the QA surface still writes these) OR
    a committed reviewer decision (the collapsed ``extract`` lifecycle routes
    human extraction values to per-reviewer ``ReviewerDecision`` rows, so the
    proposal probe alone would miss them — see the blind-review write gate in
    ``extraction_proposal_service``). Never mutates ``fields`` — the live ORM
    collection cascades delete-orphan (see the FK regression test)."""
    field_ids = [f.id for f in fields]
    settled = await service._fields_with_recent_human_proposal(
        run_id=run.id, instance_id=instance_id, field_ids=field_ids
    )
    settled |= await service._fields_with_human_decision(
        run_id=run.id, instance_id=instance_id, field_ids=field_ids
    )
    return [f for f in fields if f.id not in settled]


async def _extract_singleton(
    service: SectionExtractionService,
    *,
    run: ExtractionRun,
    entity_type: Any,
    fields: list[Any] | None,
    parent_instance_id: UUID | None,
    pdf_text: str,
    kind: str,
    framework: str | None,
    memory_context: list[dict[str, str]] | None,
    prompt_context: RunPromptContext | None,
    skip_fields_with_human_proposals: bool,
) -> SectionOutcome:
    """Extract → verify → record against the section's one instance."""
    if skip_fields_with_human_proposals and fields:
        instance = await service._find_instance_for_entity_type(
            article_id=run.article_id, entity_type_id=entity_type.id
        )
        if instance is not None:
            fields = await _fields_left_for(service, run, instance.id, fields)
            if not fields:
                return SectionOutcome(skipped=True)
    extracted_data, usage = await service._extract_with_llm(
        pdf_text=pdf_text,
        entity_type=entity_type,
        kind=kind,
        framework=framework,
        fields_override=fields,
        memory_context=memory_context,
        prompt_context=prompt_context,
        field_filter=await service._field_filter(run),
    )
    verdicts, usage = await service._maybe_verify(
        run.id, entity_type.id, run.kind, pdf_text, extracted_data, usage
    )
    count = await service._create_suggestions(
        project_id=run.project_id,
        article_id=run.article_id,
        entity_type_id=entity_type.id,
        parent_instance_id=parent_instance_id,
        extracted_data=extracted_data,
        run=run,
        verdicts=verdicts,
    )
    return SectionOutcome(suggestions_created=count, usage=usage, extracted_data=extracted_data)


async def extract_into_instances(
    service: SectionExtractionService,
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
    """Extract one section into its instances — the seam all three paths share.

    A repeating group (``cardinality='many'``) declares an entry key and is
    extracted once per identified entry; a keyless one refuses HERE, before
    any LLM call (``MissingEntityKeyError``). A singleton runs against the one
    instance its coordinate has. ``fields`` None means the entity type's own
    list (the live-row fallback of the single-section path).
    """
    key_field = key_field_of(entity_type)
    if key_field is None:
        return await _extract_singleton(
            service,
            run=run,
            entity_type=entity_type,
            fields=fields,
            parent_instance_id=parent_instance_id,
            pdf_text=pdf_text,
            kind=kind,
            framework=framework,
            memory_context=memory_context,
            prompt_context=prompt_context,
            skip_fields_with_human_proposals=skip_fields_with_human_proposals,
        )
    return await _extract_entry_group(
        service,
        run=run,
        entity_type=entity_type,
        key_field=key_field,
        fields=fields if fields is not None else list(entity_type.fields or []),
        parent_instance_id=parent_instance_id,
        pdf_text=pdf_text,
        kind=kind,
        framework=framework,
        memory_context=memory_context,
        prompt_context=prompt_context,
        skip_fields_with_human_proposals=skip_fields_with_human_proposals,
    )
