"""
Section Extraction Service.

Service for extracting specific template sections.
Implements:
- Single-section extraction
- Batch extraction with summarized memory
- Full token and run tracking
- SQLAlchemy repository pattern
"""

import json
from dataclasses import dataclass
from time import perf_counter
from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.logging import LoggerMixin
from app.infrastructure.storage import StorageAdapter
from app.models.extraction import (
    ExtractionEntityType,
    ExtractionEvidence,
    ExtractionInstance,
    ExtractionInstanceStatus,
    ExtractionRun,
    ExtractionRunStage,
    ProjectExtractionTemplate,
)
from app.models.extraction_workflow import (
    ExtractionProposalRecord,
    ExtractionProposalSource,
)
from app.repositories import (
    ArticleFileRepository,
    ExtractionEntityTypeRepository,
    ExtractionInstanceRepository,
    ExtractionRunRepository,
)
from app.services.extraction_proposal_service import ExtractionProposalService
from app.services.openai_service import OpenAIResponse, OpenAIService
from app.services.pdf_processor import PDFProcessor
from app.services.run_lifecycle_service import RunLifecycleService
from app.utils.json_parser import parse_json_safe


@dataclass
class SectionExtractionResult:
    """Single-section extraction result."""

    extraction_run_id: str
    entity_type_id: str
    suggestions_created: int
    tokens_prompt: int
    tokens_completion: int
    tokens_total: int
    duration_ms: float


@dataclass
class BatchExtractionResult:
    """Batch extraction result."""

    extraction_run_id: str
    total_sections: int
    successful_sections: int
    failed_sections: int
    total_suggestions_created: int
    total_tokens_used: int
    duration_ms: float
    sections: list[dict[str, Any]]


class SectionExtractionService(LoggerMixin):
    """
    Service for template section extraction.

    Supports single and batch extraction with summarized memory.
    Migrated to SQLAlchemy via repository pattern.
    Supports BYOK (Bring Your Own Key) with global-key fallback.
    """

    def __init__(
        self,
        db: AsyncSession,
        user_id: str,
        storage: StorageAdapter,
        trace_id: str,
        openai_api_key: str | None = None,
    ):
        """
        Initialize service instance.

        Args:
            db: Async SQLAlchemy session.
            user_id: Authenticated user ID.
            storage: Storage adapter.
            trace_id: Trace ID.
            openai_api_key: Custom API key (BYOK). If None, uses global key.
        """
        self.db = db
        self.user_id = user_id
        self.storage = storage
        self.trace_id = trace_id
        self.pdf_processor = PDFProcessor()
        self.openai_service = OpenAIService(trace_id=trace_id, api_key=openai_api_key)

        # Repositories
        self._article_files = ArticleFileRepository(db)
        self._entity_types = ExtractionEntityTypeRepository(db)
        self._instances = ExtractionInstanceRepository(db)
        self._runs = ExtractionRunRepository(db)
        # Lifecycle service: owns Run creation + stage transitions and ensures
        # version_id + hitl_config_snapshot are populated correctly.
        self._lifecycle = RunLifecycleService(db)
        # Proposal service: append-only writes to extraction_proposal_records.
        self._proposals = ExtractionProposalService(db)

    async def extract_section(
        self,
        project_id: UUID,
        article_id: UUID,
        template_id: UUID,
        entity_type_id: UUID,
        parent_instance_id: UUID | None = None,
        model: str = "gpt-4o-mini",
    ) -> SectionExtractionResult:
        """
        Extract a specific section from a template.

        Args:
            project_id: Project ID.
            article_id: Article ID.
            template_id: Template ID.
            entity_type_id: Entity type ID to extract.
            parent_instance_id: Parent instance ID (optional).
            model: Modelo OpenAI.

        Returns:
            SectionExtractionResult with extraction_run_id, suggestions, and tokens.
        """
        start_time = perf_counter()
        phase_durations_ms: dict[str, float] = {}

        # 1. Create extraction_run via the unified lifecycle service so the
        # NOT NULL columns (version_id, hitl_config_snapshot) and kind
        # discriminator are populated. Then advance pending → proposal.
        run = await self._lifecycle.create_run(
            project_id=project_id,
            article_id=article_id,
            project_template_id=template_id,
            user_id=UUID(self.user_id),
            parameters={
                "model": model,
                "entity_type_id": str(entity_type_id),
                "parent_instance_id": str(parent_instance_id) if parent_instance_id else None,
            },
        )
        run = await self._lifecycle.advance_stage(
            run_id=run.id,
            target_stage=ExtractionRunStage.PROPOSAL,
            user_id=UUID(self.user_id),
        )

        # Mark as running
        await self._runs.start_run(run.id)

        self.logger.info(
            "section_extraction_start",
            trace_id=self.trace_id,
            run_id=str(run.id),
            operation_id=str(run.id),
            entity_type_id=str(entity_type_id),
        )

        try:
            # 2. Fetch PDF
            phase_start = perf_counter()
            pdf_data = await self._get_pdf(article_id)
            phase_durations_ms["fetch_pdf"] = (perf_counter() - phase_start) * 1000

            # 3. Process text
            phase_start = perf_counter()
            pdf_text = await self.pdf_processor.extract_text(pdf_data)
            phase_durations_ms["extract_pdf_text"] = (perf_counter() - phase_start) * 1000

            # 4. Fetch entity type and fields
            phase_start = perf_counter()
            entity_type = await self._get_entity_type(entity_type_id)
            phase_durations_ms["fetch_entity_type"] = (perf_counter() - phase_start) * 1000

            # 5. Build extraction schema
            phase_start = perf_counter()
            extraction_schema = self._build_extraction_schema(entity_type)
            phase_durations_ms["build_schema"] = (perf_counter() - phase_start) * 1000

            # 6. Run LLM extraction (with token tracking)
            phase_start = perf_counter()
            extracted_data, llm_response = await self._extract_with_llm(
                pdf_text=pdf_text,
                entity_type=entity_type,
                schema=extraction_schema,
                model=model,
            )
            phase_durations_ms["extract_llm"] = (perf_counter() - phase_start) * 1000

            # 7. Create suggestions in database
            phase_start = perf_counter()
            suggestions_created = await self._create_suggestions(
                project_id=project_id,
                article_id=article_id,
                entity_type_id=entity_type_id,
                parent_instance_id=parent_instance_id,
                extracted_data=extracted_data,
                run=run,
            )
            phase_durations_ms["create_suggestions"] = (perf_counter() - phase_start) * 1000

            # 7b. Advance proposal → review so the extraction UI can record
            #     ReviewerDecisions (edit / accept_proposal) without an extra
            #     UX gesture. Equivalent of "AI is done proposing; humans now
            #     review and decide".
            await self._lifecycle.advance_stage(
                run_id=run.id,
                target_stage=ExtractionRunStage.REVIEW,
                user_id=UUID(self.user_id),
            )

            duration = (perf_counter() - start_time) * 1000

            # 8. Complete run with results
            phase_start = perf_counter()
            await self._runs.complete_run(
                run_id=run.id,
                results={
                    "suggestions_created": suggestions_created,
                    "tokens_prompt": llm_response.usage.prompt_tokens,
                    "tokens_completion": llm_response.usage.completion_tokens,
                    "tokens_total": llm_response.usage.total_tokens,
                    "duration_ms": duration,
                    "fields_extracted": len(extracted_data) if extracted_data else 0,
                    "phase_durations_ms": phase_durations_ms,
                },
            )
            phase_durations_ms["complete_run"] = (perf_counter() - phase_start) * 1000

            self.logger.info(
                "section_extraction_complete",
                trace_id=self.trace_id,
                run_id=str(run.id),
                operation_id=str(run.id),
                suggestions_created=suggestions_created,
                tokens_total=llm_response.usage.total_tokens,
                duration_ms=duration,
                phase_durations_ms=phase_durations_ms,
            )

            return SectionExtractionResult(
                extraction_run_id=str(run.id),
                entity_type_id=str(entity_type_id),
                suggestions_created=suggestions_created,
                tokens_prompt=llm_response.usage.prompt_tokens,
                tokens_completion=llm_response.usage.completion_tokens,
                tokens_total=llm_response.usage.total_tokens,
                duration_ms=duration,
            )

        except Exception as e:
            # Mark run as failed
            await self._runs.fail_run(run.id, str(e))
            self.logger.error(
                "section_extraction_failed",
                trace_id=self.trace_id,
                run_id=str(run.id),
                operation_id=str(run.id),
                error=str(e),
                phase_durations_ms=phase_durations_ms,
            )
            raise

    async def extract_for_run(
        self,
        *,
        run_id: UUID,
        skip_fields_with_human_proposals: bool = False,
        auto_advance_to_review: bool = True,
        model: str = "gpt-4o-mini",
    ) -> BatchExtractionResult:
        """
        Run AI extraction over an *existing* Run, iterating top-level
        entity_types of the Run's template.

        Used by the Quality-Assessment surface (and any other consumer
        that opens a Run via the HITL session service before asking the
        LLM to fill it in). Reuses the same building blocks as
        ``extract_section`` / ``_extract_section_with_memory``:
        ``_get_pdf``, ``_build_extraction_schema``, ``_extract_with_llm``,
        ``_create_suggestions``.

        Stage rules:
        - The Run must already be in PROPOSAL stage (the HITL session
          service opens it there).
        - When ``auto_advance_to_review`` is True the Run advances
          PROPOSAL → REVIEW after success. QA passes False so the publish
          flow can drive the lifecycle from PROPOSAL all the way to
          FINALIZED in one click.

        Re-run safety: when ``skip_fields_with_human_proposals`` is True,
        every field whose latest proposal on this Run is already
        ``source='human'`` is excluded from the LLM call so the user's
        edits aren't silently buried under a new AI guess.

        The system / user prompt is selected from ``run.kind`` +
        ``template.framework`` so PROBAST / QUADAS-2 runs get an
        assessment-style prompt while extraction runs keep the original
        "extract from scientific article" prompt.
        """
        start_time = perf_counter()

        run = await self.db.get(ExtractionRun, run_id)
        if run is None:
            raise ValueError(f"Run {run_id} not found")
        if run.stage != ExtractionRunStage.PROPOSAL.value:
            raise ValueError(
                f"Run {run_id} stage is {run.stage}; AI extraction requires "
                "PROPOSAL"
            )

        template = await self.db.get(ProjectExtractionTemplate, run.template_id)
        framework: str | None = (
            template.framework if template is not None else None
        )
        kind = run.kind

        await self._runs.start_run(run.id)

        section_results: list[dict[str, Any]] = []
        total_suggestions = 0
        total_tokens = 0
        successful = 0
        failed = 0

        try:
            pdf_data = await self._get_pdf(run.article_id)
            pdf_text = await self.pdf_processor.extract_text(pdf_data)

            top_level = await self._top_level_entity_types_for_template(run.template_id)

            for entity_type in top_level:
                try:
                    result = await self._extract_one_entity_type_for_run(
                        run=run,
                        entity_type=entity_type,
                        pdf_text=pdf_text,
                        framework=framework,
                        kind=kind,
                        skip_fields_with_human_proposals=skip_fields_with_human_proposals,
                        model=model,
                    )
                    successful += 1
                    total_suggestions += result["suggestions_created"]
                    total_tokens += result["tokens_total"]
                    section_results.append(
                        {
                            "entity_type_id": str(entity_type.id),
                            "entity_type_name": entity_type.name,
                            "success": True,
                            "suggestions_created": result["suggestions_created"],
                            "tokens_used": result["tokens_total"],
                            "skipped": result.get("skipped", False),
                        }
                    )
                except Exception as e:
                    failed += 1
                    self.logger.error(
                        "qa_extraction_entity_failed",
                        trace_id=self.trace_id,
                        run_id=str(run.id),
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

            if auto_advance_to_review:
                await self._lifecycle.advance_stage(
                    run_id=run.id,
                    target_stage=ExtractionRunStage.REVIEW,
                    user_id=UUID(self.user_id),
                )

            duration_ms = (perf_counter() - start_time) * 1000

            await self._runs.complete_run(
                run_id=run.id,
                results={
                    "total_sections": len(top_level),
                    "successful_sections": successful,
                    "failed_sections": failed,
                    "total_suggestions_created": total_suggestions,
                    "total_tokens_used": total_tokens,
                    "duration_ms": duration_ms,
                    "kind": kind,
                    "skip_fields_with_human_proposals": skip_fields_with_human_proposals,
                    "auto_advance_to_review": auto_advance_to_review,
                },
            )

            return BatchExtractionResult(
                extraction_run_id=str(run.id),
                total_sections=len(top_level),
                successful_sections=successful,
                failed_sections=failed,
                total_suggestions_created=total_suggestions,
                total_tokens_used=total_tokens,
                duration_ms=duration_ms,
                sections=section_results,
            )
        except Exception as e:
            await self._runs.fail_run(run.id, str(e))
            self.logger.error(
                "qa_extraction_failed",
                trace_id=self.trace_id,
                run_id=str(run.id),
                error=str(e),
            )
            raise

    async def _extract_one_entity_type_for_run(
        self,
        *,
        run: ExtractionRun,
        entity_type: Any,
        pdf_text: str,
        framework: str | None,
        kind: str,
        skip_fields_with_human_proposals: bool,
        model: str,
    ) -> dict[str, Any]:
        """Extract a single entity_type into an existing Run.

        Distinct from ``_extract_section_with_memory`` because it does
        NOT create a fresh Run — it appends ``source='ai'`` proposals
        onto the Run that the caller already owns.
        """
        full_entity_type = await self._entity_types.get_with_fields(entity_type.id)
        if full_entity_type is None:
            return {"suggestions_created": 0, "tokens_total": 0, "skipped": True}

        instance = await self._find_instance_for_entity_type(
            article_id=run.article_id,
            entity_type_id=entity_type.id,
        )

        original_fields = list(full_entity_type.fields or [])
        if skip_fields_with_human_proposals and instance is not None and original_fields:
            human_fields = await self._fields_with_recent_human_proposal(
                run_id=run.id,
                instance_id=instance.id,
                field_ids=[f.id for f in original_fields],
            )
            filtered = [f for f in original_fields if f.id not in human_fields]
            if not filtered:
                return {"suggestions_created": 0, "tokens_total": 0, "skipped": True}
            full_entity_type.fields = filtered  # type: ignore[attr-defined]

        try:
            schema = self._build_extraction_schema(full_entity_type)
            extracted_data, llm_response = await self._extract_with_llm(
                pdf_text=pdf_text,
                entity_type=full_entity_type,
                schema=schema,
                model=model,
                kind=kind,
                framework=framework,
            )
            suggestions_created = await self._create_suggestions(
                project_id=run.project_id,
                article_id=run.article_id,
                entity_type_id=entity_type.id,
                parent_instance_id=None,
                extracted_data=extracted_data,
                run=run,
            )
            return {
                "suggestions_created": suggestions_created,
                "tokens_total": llm_response.usage.total_tokens,
            }
        finally:
            # Restore the unfiltered field list so callers that rely on
            # the cached entity_type don't see a mutated tree.
            full_entity_type.fields = original_fields  # type: ignore[attr-defined]

    async def _top_level_entity_types_for_template(
        self,
        template_id: UUID,
    ) -> list[ExtractionEntityType]:
        stmt = (
            select(ExtractionEntityType)
            .where(
                ExtractionEntityType.project_template_id == template_id,
                ExtractionEntityType.parent_entity_type_id.is_(None),
            )
            .order_by(ExtractionEntityType.sort_order)
        )
        return list((await self.db.execute(stmt)).scalars().all())

    async def _find_instance_for_entity_type(
        self,
        *,
        article_id: UUID,
        entity_type_id: UUID,
    ) -> ExtractionInstance | None:
        instances = await self._instances.get_by_article(article_id, entity_type_id)
        if not instances:
            return None
        # QA / top-level extraction is 1:1 per (article, entity_type) — return
        # the first match. ``_create_suggestions`` will auto-create one if it
        # cannot find any.
        return instances[0]

    async def _fields_with_recent_human_proposal(
        self,
        *,
        run_id: UUID,
        instance_id: UUID,
        field_ids: list[UUID],
    ) -> set[UUID]:
        """Return the subset of ``field_ids`` whose newest proposal on
        this Run/instance is ``source='human'``. Used to skip fields the
        user has already filled when re-running AI extraction."""
        if not field_ids:
            return set()
        stmt = (
            select(
                ExtractionProposalRecord.field_id,
                ExtractionProposalRecord.source,
            )
            .where(
                ExtractionProposalRecord.run_id == run_id,
                ExtractionProposalRecord.instance_id == instance_id,
                ExtractionProposalRecord.field_id.in_(field_ids),
            )
            .order_by(
                ExtractionProposalRecord.field_id,
                ExtractionProposalRecord.created_at.desc(),
            )
        )
        rows = (await self.db.execute(stmt)).all()
        seen: set[UUID] = set()
        human: set[UUID] = set()
        for field_id, source in rows:
            if field_id in seen:
                continue
            seen.add(field_id)
            if source == ExtractionProposalSource.HUMAN.value:
                human.add(field_id)
        return human

    async def extract_all_sections(
        self,
        project_id: UUID,
        article_id: UUID,
        template_id: UUID,
        parent_instance_id: UUID,
        section_ids: list[UUID] | None = None,
        pdf_text: str | None = None,
        model: str = "gpt-4o-mini",
    ) -> BatchExtractionResult:
        """
        Extract all child sections from a model with summarized memory.

        Implements sequential extraction with accumulated context:
        - Processes PDF only once
        - Keeps summarized history of previous extractions
        - Enriches prompts with already-extracted section context

        Args:
            project_id: Project ID.
            article_id: Article ID.
            template_id: Template ID.
            parent_instance_id: Parent instance ID.
            section_ids: Specific IDs to extract (optional).
            pdf_text: Preprocessed PDF text (optional).
            model: Modelo OpenAI.

        Returns:
            BatchExtractionResult with extraction statistics.
        """
        start_time = perf_counter()
        phase_durations_ms: dict[str, float] = {}

        # Create primary run for batch extraction via lifecycle service.
        run = await self._lifecycle.create_run(
            project_id=project_id,
            article_id=article_id,
            project_template_id=template_id,
            user_id=UUID(self.user_id),
            parameters={
                "model": model,
                "batch_extraction": True,
                "parent_instance_id": str(parent_instance_id),
                "section_ids": [str(sid) for sid in section_ids] if section_ids else None,
            },
        )
        run = await self._lifecycle.advance_stage(
            run_id=run.id,
            target_stage=ExtractionRunStage.PROPOSAL,
            user_id=UUID(self.user_id),
        )

        await self._runs.start_run(run.id)

        self.logger.info(
            "batch_extraction_start",
            trace_id=self.trace_id,
            run_id=str(run.id),
            operation_id=str(run.id),
            parent_instance_id=str(parent_instance_id),
        )

        # Summarized memory history for context
        memory_history: list[dict[str, str]] = []
        section_results: list[dict[str, Any]] = []
        total_tokens = 0

        try:
            # 1. Fetch/process PDF (once)
            if not pdf_text:
                phase_start = perf_counter()
                pdf_data = await self._get_pdf(article_id)
                pdf_text = await self.pdf_processor.extract_text(pdf_data)
                phase_durations_ms["fetch_and_extract_pdf_text"] = (
                    perf_counter() - phase_start
                ) * 1000

            # 2. Fetch child entity types
            phase_start = perf_counter()
            child_types = await self._get_child_entity_types(
                template_id=template_id,
                parent_instance_id=parent_instance_id,
                section_ids=section_ids,
            )
            phase_durations_ms["fetch_child_entity_types"] = (perf_counter() - phase_start) * 1000

            total_sections = len(child_types)
            successful = 0
            failed = 0
            total_suggestions = 0

            # 3. Extract each section sequentially with memory
            for entity_type in child_types:
                try:
                    result = await self._extract_section_with_memory(
                        project_id=project_id,
                        article_id=article_id,
                        template_id=template_id,
                        entity_type=entity_type,
                        parent_instance_id=parent_instance_id,
                        pdf_text=pdf_text,
                        memory_history=memory_history,
                        model=model,
                    )

                    successful += 1
                    total_suggestions += result["suggestions_created"]
                    total_tokens += result["tokens_total"]

                    # Add summary to memory history
                    if result.get("summary"):
                        memory_history.append(
                            {
                                "entity_type_name": entity_type.label or entity_type.name,
                                "summary": result["summary"],
                            }
                        )

                    section_results.append(
                        {
                            "entity_type_id": str(entity_type.id),
                            "entity_type_name": entity_type.name,
                            "success": True,
                            "suggestions_created": result["suggestions_created"],
                            "tokens_used": result["tokens_total"],
                        }
                    )

                except Exception as e:
                    failed += 1
                    self.logger.error(
                        "section_extraction_failed",
                        trace_id=self.trace_id,
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

            # Advance the primary batch run proposal → review now that all
            # AI proposals have been written across child sections.
            await self._lifecycle.advance_stage(
                run_id=run.id,
                target_stage=ExtractionRunStage.REVIEW,
                user_id=UUID(self.user_id),
            )

            duration = (perf_counter() - start_time) * 1000

            # 4. Complete primary run
            phase_start = perf_counter()
            await self._runs.complete_run(
                run_id=run.id,
                results={
                    "total_sections": total_sections,
                    "successful_sections": successful,
                    "failed_sections": failed,
                    "total_suggestions_created": total_suggestions,
                    "total_tokens_used": total_tokens,
                    "duration_ms": duration,
                    "phase_durations_ms": phase_durations_ms,
                },
            )
            phase_durations_ms["complete_run"] = (perf_counter() - phase_start) * 1000

            self.logger.info(
                "batch_extraction_complete",
                trace_id=self.trace_id,
                run_id=str(run.id),
                operation_id=str(run.id),
                total_sections=total_sections,
                successful=successful,
                failed=failed,
                tokens_total=total_tokens,
                duration_ms=duration,
                phase_durations_ms=phase_durations_ms,
            )

            return BatchExtractionResult(
                extraction_run_id=str(run.id),
                total_sections=total_sections,
                successful_sections=successful,
                failed_sections=failed,
                total_suggestions_created=total_suggestions,
                total_tokens_used=total_tokens,
                duration_ms=duration,
                sections=section_results,
            )

        except Exception as e:
            await self._runs.fail_run(run.id, str(e))
            raise

    async def _extract_section_with_memory(
        self,
        project_id: UUID,
        article_id: UUID,
        template_id: UUID,
        entity_type: Any,
        parent_instance_id: UUID,
        pdf_text: str,
        memory_history: list[dict[str, str]],
        model: str,
    ) -> dict[str, Any]:
        """
        Extract one section with summarized memory context.

        Args:
            project_id: Project ID.
            article_id: Article ID.
            template_id: Template ID.
            entity_type: Entity type to extract.
            parent_instance_id: Parent instance ID.
            pdf_text: PDF text.
            memory_history: Summarized memory history.
            model: Modelo OpenAI.

        Returns:
            Dict with suggestions_created, tokens_total, and summary.
        """
        section_start = perf_counter()
        section_phase_durations_ms: dict[str, float] = {}

        # Create run for this specific section via lifecycle service.
        run = await self._lifecycle.create_run(
            project_id=project_id,
            article_id=article_id,
            project_template_id=template_id,
            user_id=UUID(self.user_id),
            parameters={
                "model": model,
                "entity_type_id": str(entity_type.id),
                "parent_instance_id": str(parent_instance_id),
                "batch_section": True,
                "memory_context_size": len(memory_history),
            },
        )
        run = await self._lifecycle.advance_stage(
            run_id=run.id,
            target_stage=ExtractionRunStage.PROPOSAL,
            user_id=UUID(self.user_id),
        )

        await self._runs.start_run(run.id)

        try:
            # Build schema
            phase_start = perf_counter()
            extraction_schema = self._build_extraction_schema(entity_type)
            section_phase_durations_ms["build_schema"] = (perf_counter() - phase_start) * 1000

            # Run extraction with memory context
            phase_start = perf_counter()
            extracted_data, llm_response = await self._extract_with_llm(
                pdf_text=pdf_text,
                entity_type=entity_type,
                schema=extraction_schema,
                model=model,
                memory_context=memory_history,
            )
            section_phase_durations_ms["extract_llm"] = (perf_counter() - phase_start) * 1000

            # Create suggestions
            phase_start = perf_counter()
            suggestions_created = await self._create_suggestions(
                project_id=project_id,
                article_id=article_id,
                entity_type_id=entity_type.id,
                parent_instance_id=parent_instance_id,
                extracted_data=extracted_data,
                run=run,
            )
            section_phase_durations_ms["create_suggestions"] = (perf_counter() - phase_start) * 1000

            # Generate memory summary (max 200 chars)
            summary = self._generate_extraction_summary(entity_type, extracted_data)

            # Advance proposal → review now that AI proposing is done.
            await self._lifecycle.advance_stage(
                run_id=run.id,
                target_stage=ExtractionRunStage.REVIEW,
                user_id=UUID(self.user_id),
            )

            # Complete run
            phase_start = perf_counter()
            await self._runs.complete_run(
                run_id=run.id,
                results={
                    "suggestions_created": suggestions_created,
                    "tokens_prompt": llm_response.usage.prompt_tokens,
                    "tokens_completion": llm_response.usage.completion_tokens,
                    "tokens_total": llm_response.usage.total_tokens,
                    "summary": summary,
                    "duration_ms": (perf_counter() - section_start) * 1000,
                    "phase_durations_ms": section_phase_durations_ms,
                },
            )
            section_phase_durations_ms["complete_run"] = (perf_counter() - phase_start) * 1000

            return {
                "suggestions_created": suggestions_created,
                "tokens_total": llm_response.usage.total_tokens,
                "summary": summary,
                "phase_durations_ms": section_phase_durations_ms,
            }

        except Exception as e:
            await self._runs.fail_run(run.id, str(e))
            raise

    def _generate_extraction_summary(
        self,
        entity_type: Any,
        extracted_data: dict[str, Any],
    ) -> str:
        """
        Generate structured extraction summary (max 200 chars).

        Used to enrich memory context in subsequent extractions.

        Args:
            entity_type: Extracted entity type.
            extracted_data: Extracted data.

        Returns:
            Structured summary (max 200 chars).
        """
        MAX_SUMMARY_LENGTH = 200

        if not extracted_data:
            return f"{entity_type.label or entity_type.name}: No data extracted"

        # Extract first 3 populated fields
        entries = list(extracted_data.items())[:3]
        key_fields = []

        for field_name, value in entries:
            if value is None:
                continue

            # Extract value (enriched object or direct value)
            if isinstance(value, dict) and "value" in value:
                field_value = str(value["value"])[:50]
            else:
                field_value = str(value)[:50]

            key_fields.append(f"{field_name}: {field_value}")

        fields_str = ", ".join(key_fields)
        more_indicator = "..." if len(extracted_data) > 3 else ""

        summary = f"{entity_type.label or entity_type.name}: {fields_str}{more_indicator}"

        # Truncate if over limit
        if len(summary) > MAX_SUMMARY_LENGTH:
            return summary[: MAX_SUMMARY_LENGTH - 3] + "..."

        return summary

    async def _get_pdf(self, article_id: UUID) -> bytes:
        """Fetch and download PDF via storage adapter."""
        pdf_file = await self._article_files.get_latest_pdf(article_id)

        if not pdf_file:
            raise FileNotFoundError(f"PDF not found for article {article_id}")

        return await self.storage.download("articles", pdf_file.storage_key)

    async def _get_entity_type(self, entity_type_id: UUID) -> Any:
        """Fetch entity type with fields."""
        entity_type = await self._entity_types.get_with_fields(entity_type_id)

        if not entity_type:
            raise ValueError(f"Entity type not found: {entity_type_id}")

        return entity_type

    async def _get_child_entity_types(
        self,
        template_id: UUID,  # noqa: ARG002
        parent_instance_id: UUID,
        section_ids: list[UUID] | None = None,
    ) -> list[Any]:
        """
        Fetch child entity types based on the parent instance's entity_type.

        parent_instance_id points to an instance (e.g. a model).
        We need to fetch that instance's entity_type_id and then
        fetch the entity types that have this entity_type as parent.
        """
        # 1. Fetch parent instance to get its entity_type_id
        parent_instance = await self._instances.get_by_id(parent_instance_id)

        if not parent_instance:
            self.logger.warning(
                "parent_instance_not_found",
                trace_id=self.trace_id,
                parent_instance_id=str(parent_instance_id),
            )
            return []

        parent_entity_type_id = str(parent_instance.entity_type_id)

        # 2. Fetch child entity types of this parent_entity_type
        child_entity_types = await self._entity_types.get_children(
            parent_entity_type_id=parent_entity_type_id,
            cardinality=None,  # Fetch all, not just 'one'
        )

        if not child_entity_types:
            self.logger.info(
                "no_child_entity_types_found",
                trace_id=self.trace_id,
                parent_entity_type_id=parent_entity_type_id,
            )
            return []

        # 3. Filter by section_ids if provided
        if section_ids:
            child_entity_types = [et for et in child_entity_types if et.id in section_ids]

        self.logger.info(
            "child_entity_types_found",
            trace_id=self.trace_id,
            count=len(child_entity_types),
            parent_entity_type_id=parent_entity_type_id,
        )

        return child_entity_types

    def _build_extraction_schema(self, entity_type: Any) -> dict[str, Any]:
        """
        Build JSON extraction schema from fields.

        Includes:
        - Field types (string, number, boolean, array)
        - allowed_values for select/enum fields
        - llm_description for better context
        """
        fields = entity_type.fields if hasattr(entity_type, "fields") else []

        properties = {}
        required = []

        for field in fields:
            field_name = field.name if hasattr(field, "name") else ""
            field_type = field.field_type if hasattr(field, "field_type") else "text"

            # Map field types
            json_type = "string"
            if field_type in ("number", "integer", "float"):
                json_type = "number"
            elif field_type == "boolean":
                json_type = "boolean"
            elif field_type in ("array", "list", "multiselect"):
                json_type = "array"

            # Prefer llm_description; fallback to description.
            # IMPORTANT: ensure description is always JSON-serializable.
            # In tests (or runtime), some objects may expose MagicMock-like attributes
            # or other non-serializable types, which would break json.dumps(schema).
            raw_description: Any = ""
            if hasattr(field, "llm_description") and field.llm_description:
                raw_description = field.llm_description
            elif hasattr(field, "description") and field.description:
                raw_description = field.description

            description = "" if raw_description is None else str(raw_description)

            field_schema: dict[str, Any] = {
                "type": json_type,
                "description": description,
            }

            # Include allowed_values as enum when available (select/dropdown fields)
            if hasattr(field, "allowed_values") and field.allowed_values:
                allowed = field.allowed_values
                # allowed_values can be {"options": [...]} or directly [...]
                if isinstance(allowed, dict) and "options" in allowed:
                    options = allowed["options"]
                elif isinstance(allowed, list):
                    options = allowed
                else:
                    options = None

                if options:
                    # Extract only option values
                    enum_values = []
                    for opt in options:
                        if isinstance(opt, dict) and "value" in opt:
                            enum_values.append(opt["value"])
                        elif isinstance(opt, str):
                            enum_values.append(opt)

                    if enum_values:
                        field_schema["enum"] = enum_values
                        # Append option info to description
                        options_str = ", ".join(f'"{v}"' for v in enum_values)
                        field_schema["description"] += f" Must be one of: {options_str}"

            properties[field_name] = field_schema

            if hasattr(field, "is_required") and field.is_required:
                required.append(field_name)

        return {
            "type": "object",
            "properties": properties,
            "required": required,
        }

    async def _extract_with_llm(
        self,
        pdf_text: str,
        entity_type: Any,
        schema: dict[str, Any],
        model: str,
        memory_context: list[dict[str, str]] | None = None,
        kind: str = "extraction",
        framework: str | None = None,
    ) -> tuple[dict[str, Any], OpenAIResponse]:
        """
        Run extraction using LLM with token tracking.

        Args:
            pdf_text: PDF text.
            entity_type: Entity type to extract.
            schema: JSON schema for extraction.
            model: Modelo OpenAI.
            memory_context: Summarized memory context (optional).
            kind: Run kind ('extraction' or 'quality_assessment'). Drives
                the system + user prompt — extraction asks the LLM to
                pull factual data from sections; quality_assessment asks
                the LLM to grade the study against a bias-assessment
                framework (PROBAST / QUADAS-2). The response shape stays
                identical (one object per field with value / confidence /
                reasoning / evidence), so downstream parsing is unchanged.
            framework: When kind=='quality_assessment', the assessment
                framework name (PROBAST / QUADAS-2) for the LLM to ground
                its judgments in.

        Returns:
            Tuple with extracted data and OpenAI response with tokens.
        """
        entity_name = entity_type.name if hasattr(entity_type, "name") else "data"
        entity_description = entity_type.description if hasattr(entity_type, "description") else ""

        # Build memory context when available
        memory_section = ""
        if memory_context:
            memory_lines = [
                f"{idx + 1}. {mem['entity_type_name']}: {mem['summary']}"
                for idx, mem in enumerate(memory_context)
            ]
            memory_section = f"""
--- CONTEXT FROM PREVIOUSLY EXTRACTED SECTIONS ---
{chr(10).join(memory_lines)}

Use this context to maintain consistency and avoid contradictions with previously extracted data.
"""

        if kind == "quality_assessment":
            framework_label = framework or "the assessment tool"
            system_prompt = (
                f"You are a clinical-evidence methodologist assessing a study using "
                f"{framework_label}. For each signaling question or judgment field, "
                f"choose strictly from the field's allowed values, justify your "
                f"choice with a one or two-sentence reasoning, and include a short "
                f"verbatim quote from the article as evidence whenever possible. "
                f"Be conservative: when the article does not provide enough "
                f"information to decide, prefer the value that captures uncertainty "
                f"(e.g., 'No information' or 'Probably no') over guessing. Always "
                f"respond with valid JSON."
            )
            prompt = f"""Assess the following domain of {framework_label} for the study below.

Domain: {entity_name}
Description: {entity_description}
{memory_section}
Article text:
{pdf_text[:15000]}

For EACH field in the schema below, return an object with:
- "value": one of the field's allowed values
- "confidence": number between 0 and 1 (1 = very confident in the judgment, 0 = no signal in the article)
- "reasoning": 1-2 sentences justifying the judgment against the {framework_label} criterion
- "evidence": optional object with "text" (short quoted passage supporting the judgment) and "page_number" (integer, if known)

Schema:
{json.dumps(schema, indent=2)}

Example response format:
{{
  "field_name": {{
    "value": "Probably yes",
    "confidence": 0.7,
    "reasoning": "Authors describe consecutive recruitment in a single tertiary centre.",
    "evidence": {{ "text": "All eligible patients...", "page_number": 3 }}
  }}
}}
"""
        else:
            system_prompt = (
                "You are an expert at extracting structured data from scientific "
                "articles. For each field, provide the value, your confidence level "
                "(0-1), and brief reasoning. Always respond with valid JSON."
            )
            prompt = f"""Extract the following information from the scientific article:

Section: {entity_name}
Description: {entity_description}
{memory_section}
Article text:
{pdf_text[:15000]}

For EACH field in the schema below, return an object with:
- "value": the extracted value (matching the field type and allowed values if specified)
- "confidence": a number between 0 and 1 indicating your confidence in the extraction (1 = very confident, 0 = not found/uncertain)
- "reasoning": a brief explanation (1-2 sentences) of why you extracted this value or why you're uncertain
- "evidence": optional object with "text" (short quoted passage from the article supporting the value) and "page_number" (integer, if known)

Schema:
{json.dumps(schema, indent=2)}

Example response format:
{{
  "field_name": {{
    "value": "extracted value",
    "confidence": 0.95,
    "reasoning": "Found in methods section, explicitly stated.",
    "evidence": {{ "text": "Exact quote from the article.", "page_number": 3 }}
  }}
}}
"""

        # Use chat_completion_full to capture token usage
        response = await self.openai_service.chat_completion_full(
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": prompt},
            ],
            model=model,
            response_format={"type": "json_object"},
        )

        # Use robust parser with empty-dict fallback
        extracted_data = parse_json_safe(response.content, trace_id=self.trace_id, default={})

        return extracted_data, response

    async def _create_suggestions(
        self,
        project_id: UUID,
        article_id: UUID,
        entity_type_id: UUID,
        parent_instance_id: UUID | None,
        extracted_data: dict[str, Any],
        run: ExtractionRun,
    ) -> int:
        """
        Create extraction suggestions in database via repository.

        Automatically create an instance when missing.
        Link suggestions to extraction_run_id for traceability.

        Args:
            project_id: Project ID.
            article_id: Article ID.
            entity_type_id: entity type.
            parent_instance_id: Parent instance ID.
            extracted_data: Extracted data.
            run: ExtractionRun used to link suggestions.

        Returns:
            Number of created suggestions.
        """
        count = 0

        if not extracted_data:
            self.logger.info(
                "no_data_to_create_suggestions",
                trace_id=self.trace_id,
                entity_type_id=str(entity_type_id),
            )
            return 0

        # Fetch entity type to map fields
        entity_type = await self._entity_types.get_with_fields(entity_type_id)
        if not entity_type:
            self.logger.error(
                "entity_type_not_found",
                trace_id=self.trace_id,
                entity_type_id=str(entity_type_id),
            )
            return 0

        # Build field_name -> field_id map
        field_map: dict[str, UUID] = {}
        for field in entity_type.fields or []:
            field_map[field.name] = field.id

        # Fetch existing instance
        instances = await self._instances.get_by_article(article_id, entity_type_id)

        # If parent_instance_id exists, filter by it too
        if instances and parent_instance_id:
            instances = [
                inst for inst in instances if inst.parent_instance_id == parent_instance_id
            ]

        if instances:
            instance = instances[0]
            self.logger.debug(
                "using_existing_instance",
                trace_id=self.trace_id,
                instance_id=str(instance.id),
            )
        else:
            # Auto-create a new instance
            # Resolve parent template_id when available
            template_id = None
            if parent_instance_id:
                parent_instance = await self._instances.get_by_id(parent_instance_id)
                if parent_instance:
                    template_id = parent_instance.template_id

            new_instance = ExtractionInstance(
                project_id=project_id,
                article_id=article_id,
                template_id=template_id or run.template_id,
                entity_type_id=entity_type_id,
                parent_instance_id=parent_instance_id,
                label=entity_type.label if hasattr(entity_type, "label") else entity_type.name,
                sort_order=entity_type.sort_order if hasattr(entity_type, "sort_order") else 0,
                metadata_={
                    "ai_created": True,
                    "ai_run_id": str(run.id),
                },
                created_by=UUID(self.user_id),
                status=ExtractionInstanceStatus.PENDING.value,
            )

            instance = await self._instances.create(new_instance)

            self.logger.info(
                "instance_auto_created",
                trace_id=self.trace_id,
                instance_id=str(instance.id),
                entity_type_id=str(entity_type_id),
            )

        # Record one ProposalRecord per extracted field. Evidence cited by
        # the LLM is stored as a real extraction_evidence row linked to
        # the proposal via proposal_record_id.
        for field_name, value in extracted_data.items():
            if value is None:
                continue

            field_id = field_map.get(field_name)
            if not field_id:
                self.logger.warning(
                    "field_not_found_for_suggestion",
                    trace_id=self.trace_id,
                    field_name=field_name,
                    available_fields=list(field_map.keys()),
                )
                continue

            confidence_score: float | None = None
            reasoning: str | None = None
            evidence_meta: dict | None = None

            if isinstance(value, dict):
                confidence_score = value.get("confidence")
                reasoning = value.get("reasoning")
                raw_evidence = value.get("evidence")
                if isinstance(raw_evidence, dict) and raw_evidence.get("text"):
                    evidence_meta = {
                        "text": str(raw_evidence["text"]).strip(),
                        "page_number": raw_evidence.get("page_number"),
                    }
                inner_value = value.get("value", value)
            else:
                inner_value = value

            # JSONB column on proposed_value is dict-typed; always wrap so
            # scalars/lists round-trip predictably and the frontend can read
            # `proposed_value.value` uniformly.
            proposed_value = {"value": inner_value}

            proposal = await self._proposals.record_proposal(
                run_id=run.id,
                instance_id=instance.id,
                field_id=field_id,
                source=ExtractionProposalSource.AI,
                proposed_value=proposed_value,
                confidence_score=confidence_score,
                rationale=reasoning,
            )

            if evidence_meta:
                self.db.add(
                    ExtractionEvidence(
                        project_id=project_id,
                        article_id=article_id,
                        run_id=run.id,
                        proposal_record_id=proposal.id,
                        page_number=evidence_meta.get("page_number"),
                        text_content=evidence_meta.get("text"),
                        position={},
                        created_by=UUID(self.user_id),
                    )
                )

            count += 1

        await self.db.flush()

        self.logger.info(
            "proposals_recorded",
            trace_id=self.trace_id,
            count=count,
            instance_id=str(instance.id),
            run_id=str(run.id),
        )

        return count
