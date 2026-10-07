"""``AiExtraction`` — one AI extraction request, from payload to landed proposals.

The worker builds one per job and calls :meth:`AiExtraction.run_from_request`;
that is the whole interface. Behind it, four flows share the section steps
(``_sections``) and land every candidate through ``ProposalLanding``:

- one section (``entity_type_id``) — the per-section ✨ button;
- every child section of one entry (``parent_instance_id``) — ``_batch``;
- every top-level section of a run (``run_id``) — the QA / full-run surface;
- the full pass (``run_id`` + ``extract_all_sections``): top-level sections,
  then every root entry's child sections, on the same run (spec 2026-09-15 §7.3).

A run the caller names (``run_id``) belongs to its HITL session: it is
reused, never started, completed or failed here, so further section-by-
section calls keep accumulating on it. Without one, the coordinate's live
run is resolved or created, and this request owns its lifecycle. A run stays
in EXTRACT either way — reviewers advance to consensus explicitly.
"""

from __future__ import annotations

from time import perf_counter
from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.infrastructure.storage import StorageAdapter
from app.llm.extractor import StructuredCall, extract_structured
from app.models.extraction import (
    ExtractionEntityType,
    ExtractionInstance,
    ExtractionRun,
    ExtractionRunStage,
    ProjectExtractionTemplate,
)
from app.schemas.extraction import SectionExtractionRequest
from app.schemas.llm_target import LlmTarget
from app.services.ai_extraction._batch import extract_all_sections
from app.services.ai_extraction._pipeline import Pipeline
from app.services.ai_extraction._results import (
    BatchAllSectionsFailed,
    BatchExtractionResult,
    SectionExtractionResult,
)
from app.services.ai_extraction._sections import extract_into_instances
from app.services.current_run import CurrentRunResolver
from app.services.engine_credentials import EngineCredentials
from app.services.extraction_run_write import open_run_for_write
from app.services.llm_engine_service import resolve_engine
from app.services.run_prompt_context import resolve_run_prompt_context


def _qa_framework_label(template: Any | None) -> str | None:
    """The instrument a quality-assessment prompt grounds in.

    Prefers the template's human name ("PROBAST+AI", "QUADAS-2"): every QA
    template is ``framework='CUSTOM'``, so the enum alone produced the prompt
    "assessing a study using CUSTOM". Falls back to ``framework``.
    """
    if template is None:
        return None
    name = (getattr(template, "name", None) or "").strip()
    return name or getattr(template, "framework", None)


class AiExtraction:
    """One AI extraction request: :meth:`run_from_request` is the interface."""

    def __init__(
        self,
        db: AsyncSession,
        user_id: str,
        storage: StorageAdapter,
        trace_id: str,
        llm_credentials: EngineCredentials | None = None,
        key_provider: str | None = None,
        *,
        repin: bool = False,
        attempt_id: UUID | None = None,
        owns_transactions: bool = False,
        llm: StructuredCall = extract_structured,
    ) -> None:
        """
        Args:
            llm_credentials: Key + scope + base_url + endpoint identity,
                resolved by the caller since only it knows which branch won.
                They travel together: applying them apart pairs one engine's
                key with another's host. ``None`` means the global fallback.
            key_provider: The provider they were resolved FOR — with
                ``connection_id`` the identity an adopted pin is checked
                against; ``None`` never re-resolves.
            repin: this attempt is a HUMAN kickoff, so it overwrites the run's
                pin with the caller's engine. The worker sets it on attempt 0.
            attempt_id: the durable attempt this request runs under; its
                frozen engine wins, and its replay lands idempotently.
            owns_transactions: a worker session — commit before every
                external call and after every landing.
            llm: the model-call seam (pydantic-ai in production).
        """
        self._db = db
        self._user_id = user_id
        self._p = Pipeline(
            db,
            user_id=user_id,
            storage=storage,
            trace_id=trace_id,
            credentials=llm_credentials,
            key_provider=key_provider,
            repin=repin,
            attempt_id=attempt_id,
            owns_transactions=owns_transactions,
            llm=llm,
        )
        self._current_run = CurrentRunResolver(db)

    async def run_from_request(
        self,
        payload: SectionExtractionRequest,
        engine: LlmTarget | None = None,
    ) -> SectionExtractionResult | BatchExtractionResult:
        """Run ``payload``; the caller commits or rolls back the session.

        ``engine`` is the candidate the worker already resolved (pinned-run
        pair, or the project engine) so the key it looked up matches; ``None``
        resolves the project engine here (raises ``EngineRetiredError`` for a
        retired stored pair). First match wins:

        1. ``entity_type_id`` → one section (standalone or on ``run_id``);
        2. ``parent_instance_id`` → every child section of that entry —
           checked BEFORE ``run_id`` so a batch carrying the session run
           reuses it instead of forking a shadow run;
        3. ``run_id`` + ``extract_all_sections`` → the full pass;
        4. ``run_id`` → every top-level section of the run.
        """
        if engine is None:
            engine = await resolve_engine(self._db, payload.project_id, UUID(self._user_id))
        if payload.entity_type_id is not None:
            return await self._section(payload, payload.entity_type_id, engine)
        if payload.parent_instance_id is not None:
            return await extract_all_sections(
                self._p,
                project_id=payload.project_id,
                article_id=payload.article_id,
                template_id=payload.template_id,
                parent_instance_id=payload.parent_instance_id,
                section_ids=payload.section_ids,
                pdf_text=payload.pdf_text,
                engine=engine,
                run_id=payload.run_id,
            )
        if payload.run_id is not None and payload.extract_all_sections:
            return await self._full_pass(
                payload.run_id, payload.skip_fields_with_human_proposals, engine
            )
        if payload.run_id is not None:
            return await self._top_level(
                payload.run_id,
                skip_settled=payload.skip_fields_with_human_proposals,
                auto_advance_to_review=payload.auto_advance_to_review,
                engine=engine,
            )
        # The request validator requires one of the three ids.
        raise ValueError(
            "SectionExtractionRequest matched no dispatch branch "
            "(need entity_type_id, parent_instance_id, or run_id)"
        )

    async def _section(
        self, payload: SectionExtractionRequest, entity_type_id: UUID, engine: LlmTarget
    ) -> SectionExtractionResult:
        """One section, into every instance it resolves to."""
        p = self._p
        start_time = perf_counter()
        phases: dict[str, float] = {}
        if payload.run_id is not None:
            run = await open_run_for_write(
                self._db, payload.run_id, expect=ExtractionRunStage.EXTRACT.only()
            )
            manage_lifecycle = False
        else:
            run, manage_lifecycle = await self._current_run.resolve_or_create_extract(
                project_id=payload.project_id,
                article_id=payload.article_id,
                template_id=payload.template_id,
                user_id=UUID(self._user_id),
                parameters={
                    "model": engine.model,
                    "entity_type_id": str(entity_type_id),
                    "parent_instance_id": (
                        str(payload.parent_instance_id) if payload.parent_instance_id else None
                    ),
                },
            )
            if manage_lifecycle:
                await p.runs.start_run(run.id)

        model = await p.adopt_frozen_engine(run.id, engine, payload.project_id)
        p.logger.info(
            "section_extraction_start",
            trace_id=p.trace_id,
            run_id=str(run.id),
            operation_id=str(run.id),
            entity_type_id=str(entity_type_id),
        )
        try:
            phase_start = perf_counter()
            pdf_text = await p.assemble_prompt_text(payload.article_id, model)
            phases["assemble_prompt"] = (perf_counter() - phase_start) * 1000

            # Structure and instructions come from the run-PINNED snapshot
            # (B-2); fields sent are snapshot ∩ live. An id outside the pin
            # (re-pin race) falls back to the template-scoped live row.
            phase_start = perf_counter()
            entity_type, from_pin = await p.entity_type_on_run(run, entity_type_id)
            fields = await p.live_field_intersection(entity_type) if from_pin else None
            if from_pin and fields is None:
                raise ValueError(f"Entity type not found: {entity_type_id}")
            phases["fetch_entity_type"] = (perf_counter() - phase_start) * 1000

            phase_start = perf_counter()
            outcome = await extract_into_instances(
                p,
                run=run,
                entity_type=entity_type,
                fields=fields,
                parent_instance_id=payload.parent_instance_id,
                pdf_text=pdf_text,
                prompt_context=await resolve_run_prompt_context(self._db, run),
            )
            phases["extract_and_record"] = (perf_counter() - phase_start) * 1000
            duration = (perf_counter() - start_time) * 1000
            if manage_lifecycle:
                phase_start = perf_counter()
                await p.runs.complete_run(
                    run_id=run.id,
                    results={
                        "suggestions_created": outcome.suggestions_created,
                        "tokens_prompt": outcome.usage.prompt_tokens,
                        "tokens_completion": outcome.usage.completion_tokens,
                        "tokens_total": outcome.usage.total_tokens,
                        "duration_ms": duration,
                        "fields_extracted": len(outcome.extracted_data),
                        "phase_durations_ms": phases,
                    },
                )
                phases["complete_run"] = (perf_counter() - phase_start) * 1000
            p.logger.info(
                "section_extraction_complete",
                trace_id=p.trace_id,
                run_id=str(run.id),
                operation_id=str(run.id),
                suggestions_created=outcome.suggestions_created,
                tokens_total=outcome.usage.total_tokens,
                duration_ms=duration,
                phase_durations_ms=phases,
            )
            return SectionExtractionResult(
                extraction_run_id=str(run.id),
                entity_type_id=str(entity_type_id),
                suggestions_created=outcome.suggestions_created,
                duration_ms=duration,
            )
        except Exception as e:
            if manage_lifecycle:
                await p.runs.rollback_and_fail(
                    run.id,
                    str(e),
                    logger=p.logger,
                    trace_id=p.trace_id,
                    log_prefix="section_extraction",
                )
            p.logger.error(
                "section_extraction_failed",
                trace_id=p.trace_id,
                run_id=str(run.id),
                operation_id=str(run.id),
                error=str(e),
                phase_durations_ms=phases,
            )
            raise

    async def _top_level(
        self,
        run_id: UUID,
        *,
        skip_settled: bool,
        auto_advance_to_review: bool,
        engine: LlmTarget,
    ) -> BatchExtractionResult:
        """Every top-level section of an existing EXTRACT run.

        ``skip_settled`` keeps a re-run off every field a human already
        settled (a latest ``human`` proposal or a committed edit/accept
        decision). ``auto_advance_to_review`` is inert in the collapsed
        lifecycle; it is recorded in the results for telemetry continuity.
        The prompt pair follows ``run.kind`` and names the template's
        instrument (``_qa_framework_label``).
        """
        p = self._p
        start_time = perf_counter()
        run = await open_run_for_write(self._db, run_id, expect=ExtractionRunStage.EXTRACT.only())
        template = await self._db.get(ProjectExtractionTemplate, run.template_id)
        framework = _qa_framework_label(template)
        kind = run.kind
        await p.runs.start_run(run.id)
        model = await p.adopt_frozen_engine(run.id, engine, run.project_id)

        sections: list[dict[str, Any]] = []
        total_suggestions = total_tokens = successful = failed = 0
        try:
            pdf_text = await p.assemble_prompt_text(run.article_id, model)
            prompt_context = await resolve_run_prompt_context(self._db, run)
            # The provider chains an empty or narrow pin to live rows, so an
            # empty pin can never turn this into a green no-op run.
            top_level = [
                et for et in await p.pinned_entity_types(run) if et.parent_entity_type_id is None
            ]
            for entity_type in top_level:
                try:
                    fields = await p.live_field_intersection(entity_type)
                    skipped = fields is None
                    created = tokens = 0
                    if fields is not None:
                        outcome = await extract_into_instances(
                            p,
                            run=run,
                            entity_type=entity_type,
                            fields=fields,
                            parent_instance_id=None,
                            pdf_text=pdf_text,
                            kind=kind,
                            framework=framework,
                            prompt_context=prompt_context,
                            skip_fields_with_human_proposals=skip_settled,
                        )
                        skipped = outcome.skipped
                        created, tokens = outcome.suggestions_created, outcome.usage.total_tokens
                except Exception as e:
                    failed += 1
                    p.logger.error(
                        "qa_extraction_entity_failed",
                        trace_id=p.trace_id,
                        run_id=str(run.id),
                        entity_type_id=str(entity_type.id),
                        error=str(e),
                    )
                    sections.append(
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
                sections.append(
                    {
                        "entity_type_id": str(entity_type.id),
                        "entity_type_name": entity_type.name,
                        "success": True,
                        "suggestions_created": created,
                        "tokens_used": tokens,
                        "skipped": skipped,
                    }
                )
            if top_level and successful == 0:
                raise BatchAllSectionsFailed(f"All {failed} section(s) failed for run {run.id}.")
            # Provenance was merged per section at the landing; a run-level
            # ``provenance`` key here would clobber that ``sections`` map
            # (``complete_run`` shallow-merges).
            await p.runs.complete_run(
                run_id=run.id,
                results={
                    "total_sections": len(top_level),
                    "successful_sections": successful,
                    "failed_sections": failed,
                    "total_suggestions_created": total_suggestions,
                    "total_tokens_used": total_tokens,
                    "duration_ms": (perf_counter() - start_time) * 1000,
                    "kind": kind,
                    "skip_fields_with_human_proposals": skip_settled,
                    "auto_advance_to_review": auto_advance_to_review,
                },
            )
            return BatchExtractionResult(
                extraction_run_id=str(run.id),
                total_sections=len(top_level),
                successful_sections=successful,
                failed_sections=failed,
                total_suggestions_created=total_suggestions,
                sections=sections,
            )
        except Exception as e:
            await p.runs.rollback_and_fail(
                run.id,
                str(e),
                logger=p.logger,
                trace_id=p.trace_id,
                log_prefix="section_extraction",
            )
            p.logger.error(
                "qa_extraction_failed", trace_id=p.trace_id, run_id=str(run.id), error=str(e)
            )
            raise

    async def _full_pass(
        self, run_id: UUID, skip_settled: bool, engine: LlmTarget
    ) -> BatchExtractionResult:
        """Top-level sections, then every root entry's child sections on the
        SAME run. An entry whose child sections all fail counts as one failed
        section — the article completes with issues rather than failing whole.
        """
        top = await self._top_level(
            run_id, skip_settled=skip_settled, auto_advance_to_review=True, engine=engine
        )
        run = await self._db.get(ExtractionRun, run_id)
        if run is None:
            raise ValueError(f"Run {run_id} not found")
        total, successful, failed = top.total_sections, top.successful_sections, top.failed_sections
        suggestions = top.total_suggestions_created
        sections = list(top.sections)
        for entry_id in await self._root_entry_instance_ids(run):
            try:
                child = await extract_all_sections(
                    self._p,
                    project_id=run.project_id,
                    article_id=run.article_id,
                    template_id=run.template_id,
                    parent_instance_id=entry_id,
                    section_ids=None,
                    pdf_text=None,
                    engine=engine,
                    run_id=run.id,
                )
            except BatchAllSectionsFailed as exc:
                total += 1
                failed += 1
                sections.append(
                    {"entity_type_id": str(entry_id), "success": False, "error": str(exc)}
                )
                continue
            total += child.total_sections
            successful += child.successful_sections
            failed += child.failed_sections
            suggestions += child.total_suggestions_created
            sections.extend(child.sections)
        return BatchExtractionResult(
            extraction_run_id=str(run.id),
            total_sections=total,
            successful_sections=successful,
            failed_sections=failed,
            total_suggestions_created=suggestions,
            sections=sections,
        )

    async def _root_entry_instance_ids(self, run: ExtractionRun) -> list[UUID]:
        """Entries of the run's root repeating groups, in template then entry order."""
        stmt = (
            select(ExtractionInstance.id)
            .join(
                ExtractionEntityType, ExtractionEntityType.id == ExtractionInstance.entity_type_id
            )
            .where(
                ExtractionInstance.article_id == run.article_id,
                ExtractionInstance.template_id == run.template_id,
                ExtractionInstance.parent_instance_id.is_(None),
                ExtractionEntityType.parent_entity_type_id.is_(None),
                ExtractionEntityType.cardinality == "many",
            )
            .order_by(
                ExtractionEntityType.sort_order,
                ExtractionInstance.sort_order,
                ExtractionInstance.id,
            )
        )
        return list((await self._db.execute(stmt)).scalars())
