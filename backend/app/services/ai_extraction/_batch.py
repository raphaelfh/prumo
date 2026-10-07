"""The per-entry batch: every child section under one parent instance,
sequentially, each prompt enriched with a summary of the sections before it.

Every section appends to THE batch run — never one run per section, which
scattered a batch across N live runs and, under the one-live-run invariant
(index 0045), failed outright on the second.
"""

from __future__ import annotations

from time import perf_counter
from typing import Any
from uuid import UUID

from app.models.extraction import ExtractionRun, ExtractionRunStage
from app.schemas.llm_target import LlmTarget
from app.schemas.run_prompt_context import RunPromptContext
from app.services.ai_extraction._pipeline import Pipeline
from app.services.ai_extraction._results import BatchAllSectionsFailed, BatchExtractionResult
from app.services.ai_extraction._sections import extract_into_instances
from app.services.extraction_run_write import open_run_for_write
from app.services.run_lifecycle_service import RunLifecycleService
from app.services.run_prompt_context import resolve_run_prompt_context

#: Summary length a section contributes to the memory of the next ones.
_MAX_SUMMARY_LENGTH = 200


async def extract_all_sections(
    p: Pipeline,
    *,
    project_id: UUID,
    article_id: UUID,
    template_id: UUID,
    parent_instance_id: UUID,
    section_ids: list[UUID] | None,
    pdf_text: str | None,
    engine: LlmTarget,
    run_id: UUID | None,
) -> BatchExtractionResult:
    """Every child section of ``parent_instance_id``'s entity type.

    With a ``run_id`` the session-owned run is REUSED and its lifecycle left
    to the HITL session, so a reviewer's decisions are never orphaned onto a
    forked run. Without one the coordinate's live run is resolved or created
    (one-live-run invariant) — also what lets chunked batch calls share one
    run — and this call starts, completes or fails it.
    """
    start_time = perf_counter()
    phases: dict[str, float] = {}
    if run_id is not None:
        run = await open_run_for_write(p.db, run_id, expect=ExtractionRunStage.EXTRACT.only())
        manage_lifecycle = False
    else:
        run, manage_lifecycle = await RunLifecycleService(p.db).resolve_or_create_extract_run(
            project_id=project_id,
            article_id=article_id,
            project_template_id=template_id,
            user_id=UUID(p.user_id),
            parameters={
                "model": engine.model,
                "batch_extraction": True,
                "parent_instance_id": str(parent_instance_id),
                "section_ids": [str(sid) for sid in section_ids] if section_ids else None,
            },
        )
        if manage_lifecycle:
            await p.runs.start_run(run.id)

    model = await p.adopt_frozen_engine(run.id, engine, project_id)
    p.logger.info(
        "batch_extraction_start",
        trace_id=p.trace_id,
        run_id=str(run.id),
        operation_id=str(run.id),
        parent_instance_id=str(parent_instance_id),
    )
    memory: list[dict[str, str]] = []
    section_results: list[dict[str, Any]] = []
    total_tokens = 0
    try:
        if not pdf_text:
            phase_start = perf_counter()
            pdf_text = await p.assemble_prompt_text(article_id, model)
            phases["assemble_prompt"] = (perf_counter() - phase_start) * 1000
        elif not p.anchor_blocks:
            # Text supplied → assembly skipped; still needed for evidence anchors.
            await p.assemble_prompt_text(article_id, model)

        phase_start = perf_counter()
        child_types = await _child_entity_types(p, run, parent_instance_id, section_ids)
        phases["fetch_child_entity_types"] = (perf_counter() - phase_start) * 1000
        successful = failed = total_suggestions = 0
        prompt_context = await resolve_run_prompt_context(p.db, run)
        for entity_type in child_types:
            try:
                created, tokens, summary = await _section_with_memory(
                    p, run, entity_type, parent_instance_id, pdf_text, memory, prompt_context
                )
            except Exception as e:
                failed += 1
                p.logger.error(
                    "section_extraction_failed",
                    trace_id=p.trace_id,
                    entity_type_id=str(entity_type.id),
                    error=str(e),
                )
                section_results.append(
                    {
                        "entity_type_id": str(entity_type.id),
                        "entity_type_name": entity_type.name,
                        "success": False,
                        "error": str(e),
                    }
                )
                continue
            successful += 1
            total_suggestions += created
            total_tokens += tokens
            if summary:
                memory.append(
                    {"entity_type_name": entity_type.label or entity_type.name, "summary": summary}
                )
            section_results.append(
                {
                    "entity_type_id": str(entity_type.id),
                    "entity_type_name": entity_type.name,
                    "success": True,
                    "suggestions_created": created,
                    "tokens_used": tokens,
                }
            )

        # The run stays in EXTRACT: reviewers advance to consensus explicitly.
        if child_types and successful == 0:
            raise BatchAllSectionsFailed(f"All {failed} section(s) failed for run {run.id}.")
        duration = (perf_counter() - start_time) * 1000
        if manage_lifecycle:
            await p.runs.complete_run(
                run_id=run.id,
                results={
                    "total_sections": len(child_types),
                    "successful_sections": successful,
                    "failed_sections": failed,
                    "total_suggestions_created": total_suggestions,
                    "total_tokens_used": total_tokens,
                    "duration_ms": duration,
                    "phase_durations_ms": phases,
                },
            )
        p.logger.info(
            "batch_extraction_complete",
            trace_id=p.trace_id,
            run_id=str(run.id),
            operation_id=str(run.id),
            total_sections=len(child_types),
            successful=successful,
            failed=failed,
            tokens_total=total_tokens,
            duration_ms=duration,
            phase_durations_ms=phases,
        )
        return BatchExtractionResult(
            extraction_run_id=str(run.id),
            total_sections=len(child_types),
            successful_sections=successful,
            failed_sections=failed,
            total_suggestions_created=total_suggestions,
            sections=section_results,
        )
    except Exception as e:
        # The session owns the lifecycle on the reuse path; the error
        # propagates for it to handle.
        if manage_lifecycle:
            await p.runs.rollback_and_fail(
                run.id,
                str(e),
                logger=p.logger,
                trace_id=p.trace_id,
                log_prefix="section_extraction",
            )
        raise


async def _section_with_memory(
    p: Pipeline,
    run: ExtractionRun,
    entity_type: Any,
    parent_instance_id: UUID,
    pdf_text: str,
    memory: list[dict[str, str]],
    prompt_context: RunPromptContext,
) -> tuple[int, int, str | None]:
    """``(suggestions, tokens, summary)`` for one child section. Fields sent
    are snapshot ∩ live: a section deleted live is skipped before spending a
    model call on values the landing could not resolve."""
    fields = await p.live_field_intersection(entity_type)
    if fields is None:
        return 0, 0, None
    outcome = await extract_into_instances(
        p,
        run=run,
        entity_type=entity_type,
        fields=fields,
        parent_instance_id=parent_instance_id,
        pdf_text=pdf_text,
        memory_context=memory,
        prompt_context=prompt_context,
    )
    return (
        outcome.suggestions_created,
        outcome.usage.total_tokens,
        _summary(entity_type, outcome.extracted_data),
    )


def _summary(entity_type: Any, extracted: dict[str, Any]) -> str:
    """The first three populated fields, at most 200 characters — what the
    next sections' prompts read about this one."""
    name = entity_type.label or entity_type.name
    if not extracted:
        return f"{name}: No data extracted"
    key_fields = [
        f"{field_name}: {str(answer.get('value'))[:50]}"
        for field_name, answer in list(extracted.items())[:3]
    ]
    more = "..." if len(extracted) > 3 else ""
    summary = f"{name}: {', '.join(key_fields)}{more}"
    if len(summary) > _MAX_SUMMARY_LENGTH:
        return summary[: _MAX_SUMMARY_LENGTH - 3] + "..."
    return summary


async def _child_entity_types(
    p: Pipeline, run: ExtractionRun, parent_instance_id: UUID, section_ids: list[UUID] | None
) -> list[Any]:
    """Children of the parent instance's entity type in the run-PINNED tree.

    The parent INSTANCE is runtime data and stays a live, run-scoped read
    (BOLA); the children STRUCTURE comes from the pin, so a child section
    added live is invisible until publish re-pins the run.
    """
    parent = await p.instances.get_on_run(parent_instance_id, run)
    if not parent:
        p.logger.warning(
            "parent_instance_not_found",
            trace_id=p.trace_id,
            parent_instance_id=str(parent_instance_id),
        )
        return []
    children = [
        et
        for et in await p.pinned_entity_types(run)
        if et.parent_entity_type_id == parent.entity_type_id
    ]
    if not children:
        p.logger.info(
            "no_child_entity_types_found",
            trace_id=p.trace_id,
            parent_entity_type_id=str(parent.entity_type_id),
        )
        return []
    if section_ids:
        children = [et for et in children if et.id in section_ids]
    p.logger.info(
        "child_entity_types_found",
        trace_id=p.trace_id,
        count=len(children),
        parent_entity_type_id=str(parent.entity_type_id),
    )
    return children
