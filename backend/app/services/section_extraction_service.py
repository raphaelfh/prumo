"""
Section Extraction Service.

Service for extracting specific template sections.
Implements:
- Single-section extraction
- Batch extraction with summarized memory
- Full token and run tracking
- SQLAlchemy repository pattern
"""

from dataclasses import dataclass
from time import perf_counter
from typing import Any
from uuid import UUID

from pydantic_ai.exceptions import AgentRunError
from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.logging import LoggerMixin
from app.infrastructure.storage import StorageAdapter
from app.llm.claim_value import value_str_for_claim
from app.llm.entailment import GateSpec, run_entailment_gate
from app.llm.extractor import (
    LLM_TEMPERATURE,
    OUTPUT_RETRIES_DEFAULT,
    LlmUsage,
    extract_structured,
)
from app.llm.prompts import quality_assessment, section_extraction
from app.llm.provider import MissingLLMKeyError, build_model
from app.llm.schema import build_output_models, dump_extraction
from app.llm.validators import evidence_is_plausible
from app.models.extraction import (
    ExtractionEntityType,
    ExtractionEvidence,
    ExtractionInstance,
    ExtractionRun,
    ExtractionRunStage,
    ProjectExtractionTemplate,
)
from app.models.extraction_workflow import (
    ExtractionProposalRecord,
    ExtractionProposalSource,
    ExtractionReviewerDecision,
    ExtractionReviewerDecisionType,
    ExtractionReviewerState,
)
from app.repositories import (
    ArticleFileRepository,
    ExtractionEntityTypeRepository,
    ExtractionInstanceRepository,
    ExtractionRunRepository,
)
from app.schemas.extraction import SectionExtractionRequest
from app.services.evidence_anchor_service import build_anchor
from app.services.extraction_prompt_input import build_prompt_input
from app.services.extraction_proposal_service import ExtractionProposalService
from app.services.run_lifecycle_service import RunLifecycleService

# Maximum number of evidence rows written per extracted field.
EVIDENCE_CAP = 3


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


class BatchAllSectionsFailed(Exception):
    """Every section in a batch extraction failed — the run is failed (not
    reported as a success). Permanent by default: app/llm/errors.py classifies
    unknown exception types as non-retryable."""


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
        self._llm_api_key = openai_api_key

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
        # Run-scoped anchor stash: populated once per run by build_prompt_input,
        # reused by _create_suggestions for evidence anchoring (no second fetch).
        self._run_anchor_blocks: list = []
        self._run_anchor_file_id: UUID | None = None
        # Run provenance snapshot, set by _extract_with_llm and merged into the
        # run's results at completion (how the suggestions were generated).
        self._run_provenance: dict[str, Any] | None = None

    def _build_run_provenance(
        self,
        *,
        model: str,
        prompt_name: str,
        prompt_version: str,
        prompt_text: str,
    ) -> dict[str, Any]:
        """Flat snapshot of how a run's suggestions were generated, for
        transparency/traceability. Params come from the single-source extractor
        constants so they can't drift from what was actually sent."""
        return {
            "ran_by_user_id": self.user_id,
            "provider": settings.LLM_PROVIDER,
            "model": model,
            "strategy": prompt_name,
            "prompt_version": prompt_version,
            "prompt_text": prompt_text,
            "params": {
                "temperature": LLM_TEMPERATURE,
                "output_retries": OUTPUT_RETRIES_DEFAULT,
                "timeout_seconds": settings.LLM_TIMEOUT_SECONDS,
            },
        }

    def _provenance_with_tokens(self, usage: LlmUsage) -> dict[str, Any] | None:
        """The run provenance snapshot plus this run's token usage, or None when
        no LLM extraction ran. Stored on the suggestion-owning run so the review
        UI can show how each suggestion was generated."""
        if self._run_provenance is None:
            return None
        return {
            **self._run_provenance,
            "tokens": {
                "prompt": usage.prompt_tokens,
                "completion": usage.completion_tokens,
                "total": usage.total_tokens,
            },
        }

    async def _assemble_prompt_text(self, article_id: UUID, model: str) -> str:
        """Budgeted block-markdown prompt input; stashes run anchor blocks on self."""
        text, self._run_anchor_blocks, self._run_anchor_file_id = await build_prompt_input(
            db=self.db,
            article_files=self._article_files,
            storage=self.storage,
            article_id=article_id,
            model=model,
            logger=self.logger,
            user_id=self.user_id,
            trace_id=self.trace_id,
        )
        return text

    async def extract_section(
        self,
        project_id: UUID,
        article_id: UUID,
        template_id: UUID,
        entity_type_id: UUID,
        parent_instance_id: UUID | None = None,
        model: str = settings.LLM_DEFAULT_MODEL,
        run_id: UUID | None = None,
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
            run_id: Existing run to append proposals to. When provided
                (the extraction surface path), the proposals are added
                to that run instead of creating a fresh one — so the
                HITL session's run stays the single source of truth and
                multiple section-by-section AI extractions accumulate
                on the same run.

        Returns:
            SectionExtractionResult with extraction_run_id, suggestions, and tokens.
        """
        start_time = perf_counter()
        phase_durations_ms: dict[str, float] = {}

        # When the caller passes a ``run_id`` (extraction surface via the
        # HITL session service), append proposals to that run and skip the
        # lifecycle bookkeeping the standalone path needs. The session
        # owns ``start_run`` / ``complete_run`` / ``fail_run`` and the
        # stage advance — calling them here would close the run after one
        # section, breaking subsequent section-by-section AI clicks.
        manage_lifecycle = run_id is None

        if not manage_lifecycle:
            existing_run = await self.db.get(ExtractionRun, run_id)
            if existing_run is None:
                raise ValueError(f"Run {run_id} not found")
            if existing_run.stage != ExtractionRunStage.EXTRACT.value:
                raise ValueError(
                    f"Run {run_id} stage is {existing_run.stage}; AI extraction requires EXTRACT",
                )
            run = existing_run
        else:
            run = await self._lifecycle.create_run(
                project_id=project_id,
                article_id=article_id,
                project_template_id=template_id,
                user_id=UUID(self.user_id),
                parameters={
                    "model": model,
                    "entity_type_id": str(entity_type_id),
                    "parent_instance_id": (str(parent_instance_id) if parent_instance_id else None),
                },
            )
            run = await self._lifecycle.advance_stage(
                run_id=run.id,
                target_stage=ExtractionRunStage.EXTRACT,
                user_id=UUID(self.user_id),
            )
            await self._runs.start_run(run.id)

        self.logger.info(
            "section_extraction_start",
            trace_id=self.trace_id,
            run_id=str(run.id),
            operation_id=str(run.id),
            entity_type_id=str(entity_type_id),
        )

        try:
            # 2-3. Assemble budgeted block-markdown prompt input (pypdf fallback inside).
            phase_start = perf_counter()
            pdf_text = await self._assemble_prompt_text(article_id, model)
            phase_durations_ms["assemble_prompt"] = (perf_counter() - phase_start) * 1000

            # 4. Fetch entity type and fields
            phase_start = perf_counter()
            entity_type = await self._get_entity_type(entity_type_id)
            phase_durations_ms["fetch_entity_type"] = (perf_counter() - phase_start) * 1000

            # 5. Run LLM extraction (with token tracking)
            phase_start = perf_counter()
            extracted_data, llm_usage = await self._extract_with_llm(
                pdf_text=pdf_text,
                entity_type=entity_type,
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
                model=model,
            )
            phase_durations_ms["create_suggestions"] = (perf_counter() - phase_start) * 1000

            # Run stays in EXTRACT. The HITL session service's
            # ``_reuse_or_create_run`` returns this run on next session
            # open (most-recent non-terminal), so ``useExtractedValues``
            # hydrates from ``runDetail.proposals`` and the AI values
            # show in the form immediately. The user advances to CONSENSUS
            # explicitly via "Open consensus" — auto-advancing here would
            # skip the extract-stage hydration and leave the form empty
            # (#bug: AI extraction values not appearing).

            duration = (perf_counter() - start_time) * 1000

            # 8. Complete run with results (standalone-run path only).
            # The session-run path leaves the run alive so the user can
            # keep extracting section-by-section on the same run.
            if manage_lifecycle:
                phase_start = perf_counter()
                await self._runs.complete_run(
                    run_id=run.id,
                    results={
                        "suggestions_created": suggestions_created,
                        "tokens_prompt": llm_usage.prompt_tokens,
                        "tokens_completion": llm_usage.completion_tokens,
                        "tokens_total": llm_usage.total_tokens,
                        "duration_ms": duration,
                        "fields_extracted": len(extracted_data) if extracted_data else 0,
                        "phase_durations_ms": phase_durations_ms,
                        "provenance": self._provenance_with_tokens(llm_usage),
                    },
                )
                phase_durations_ms["complete_run"] = (perf_counter() - phase_start) * 1000
            else:
                # Session-run path: the HITL session owns the run lifecycle, so we
                # must NOT complete it (that would close the run after one section
                # and break further section-by-section AI clicks). Still persist
                # the provenance snapshot so the review popover's "How this was
                # generated" metadata renders for these suggestions — without this
                # merge, session-run suggestions carried no provenance at all.
                provenance = self._provenance_with_tokens(llm_usage)
                if provenance is not None:
                    await self._runs.merge_results(run.id, {"provenance": provenance})

            self.logger.info(
                "section_extraction_complete",
                trace_id=self.trace_id,
                run_id=str(run.id),
                operation_id=str(run.id),
                suggestions_created=suggestions_created,
                tokens_total=llm_usage.total_tokens,
                duration_ms=duration,
                phase_durations_ms=phase_durations_ms,
            )

            return SectionExtractionResult(
                extraction_run_id=str(run.id),
                entity_type_id=str(entity_type_id),
                suggestions_created=suggestions_created,
                tokens_prompt=llm_usage.prompt_tokens,
                tokens_completion=llm_usage.completion_tokens,
                tokens_total=llm_usage.total_tokens,
                duration_ms=duration,
            )

        except Exception as e:
            # Only mark run as failed in the standalone-run path. In the
            # session-run path the run lifecycle is owned by the HITL
            # session, not by a single AI call — failing it here would
            # break subsequent section extractions on the same run.
            if manage_lifecycle:
                await self._runs.rollback_and_fail(
                    run.id,
                    str(e),
                    logger=self.logger,
                    trace_id=self.trace_id,
                    log_prefix="section_extraction",
                )
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
        model: str = settings.LLM_DEFAULT_MODEL,
    ) -> BatchExtractionResult:
        """
        Run AI extraction over an *existing* Run, iterating top-level
        entity_types of the Run's template.

        Used by the Quality-Assessment surface (and any other consumer
        that opens a Run via the HITL session service before asking the
        LLM to fill it in). Reuses the same building blocks as
        ``extract_section`` / ``_extract_section_with_memory``:
        ``_extract_with_llm``,
        ``_create_suggestions``.

        Stage rules:
        - The Run must already be in EXTRACT stage (the HITL session
          service opens it there).
        - ``auto_advance_to_review`` is retained for API compatibility but
          is now inert: the collapsed lifecycle has no separate ``review``
          stage, so the Run stays in EXTRACT after success and reviewers
          act there directly. The flag's requested value is still recorded
          in the result for telemetry continuity.

        Re-run safety: when ``skip_fields_with_human_proposals`` is True,
        every field a human has already settled is excluded from the LLM
        call so the user's work isn't buried under a new AI guess. A field
        counts as settled on either track — a latest ``source='human'``
        proposal (the QA surface) or a committed reviewer decision
        (``edit`` / ``accept_proposal``; the extraction surface, where the
        blind-review gate routes human values to ``ReviewerDecision`` rows
        rather than ``human`` proposals).

        The system / user prompt is selected from ``run.kind`` +
        ``template.framework`` so PROBAST / QUADAS-2 runs get an
        assessment-style prompt while extraction runs keep the original
        "extract from scientific article" prompt.
        """
        start_time = perf_counter()

        run = await self.db.get(ExtractionRun, run_id)
        if run is None:
            raise ValueError(f"Run {run_id} not found")
        if run.stage != ExtractionRunStage.EXTRACT.value:
            raise ValueError(f"Run {run_id} stage is {run.stage}; AI extraction requires EXTRACT")

        template = await self.db.get(ProjectExtractionTemplate, run.template_id)
        framework: str | None = template.framework if template is not None else None
        kind = run.kind

        await self._runs.start_run(run.id)

        section_results: list[dict[str, Any]] = []
        total_suggestions = 0
        total_tokens = 0
        successful = 0
        failed = 0

        try:
            pdf_text = await self._assemble_prompt_text(run.article_id, model)

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

            # No stage flip: the collapsed lifecycle has no ``review`` stage,
            # so a successful AI pass leaves the Run in EXTRACT where reviewers
            # act directly. ``auto_advance_to_review`` is recorded below for
            # telemetry but no longer drives a transition.

            if top_level and successful == 0:
                raise BatchAllSectionsFailed(f"All {failed} section(s) failed for run {run.id}.")

            duration_ms = (perf_counter() - start_time) * 1000

            # Persist how the suggestions were generated so the review popover's
            # "How this was generated" metadata renders. ``_run_provenance`` holds
            # the run config (model/provider/params/prompt) set by the last
            # ``_extract_with_llm`` call; pair it with the run-aggregate token total.
            run_provenance = (
                {**self._run_provenance, "tokens": {"total": total_tokens}}
                if self._run_provenance is not None
                else None
            )

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
                    "provenance": run_provenance,
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
            await self._runs.rollback_and_fail(
                run.id,
                str(e),
                logger=self.logger,
                trace_id=self.trace_id,
                log_prefix="section_extraction",
            )
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
            field_ids = [f.id for f in original_fields]
            # Protect a field from the AI re-run if the human has already
            # settled it on EITHER track: a ``human`` proposal (the QA
            # surface still writes these) OR a committed reviewer decision
            # (the collapsed ``extract`` lifecycle routes human extraction
            # values to per-reviewer ``ReviewerDecision`` rows, so the
            # proposal probe alone would miss them — see the blind-review
            # write gate in ``extraction_proposal_service``).
            human_fields = await self._fields_with_recent_human_proposal(
                run_id=run.id,
                instance_id=instance.id,
                field_ids=field_ids,
            )
            human_fields |= await self._fields_with_human_decision(
                run_id=run.id,
                instance_id=instance.id,
                field_ids=field_ids,
            )
            filtered = [f for f in original_fields if f.id not in human_fields]
            if not filtered:
                return {"suggestions_created": 0, "tokens_total": 0, "skipped": True}
            full_entity_type.fields = filtered  # type: ignore[attr-defined]

        try:
            extracted_data, llm_usage = await self._extract_with_llm(
                pdf_text=pdf_text,
                entity_type=full_entity_type,
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
                model=model,
            )
            return {
                "suggestions_created": suggestions_created,
                "tokens_total": llm_usage.total_tokens,
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

    async def _fields_with_human_decision(
        self,
        *,
        run_id: UUID,
        instance_id: UUID,
        field_ids: list[UUID],
    ) -> set[UUID]:
        """Return the subset of ``field_ids`` that already carry a committed
        human reviewer decision (``edit`` or ``accept_proposal``) on this
        Run/instance — i.e. a reviewer has settled the field.

        Companion to ``_fields_with_recent_human_proposal`` for the collapsed
        ``extract`` lifecycle: human *extraction* values land as per-reviewer
        ``ReviewerDecision`` rows (the blind-review write gate rejects
        ``human`` proposals for ``kind='extraction'``), so the proposal probe
        alone can never see them. Re-running AI must not regenerate
        suggestions over a field a reviewer has already handled, so the skip
        set unions both probes.

        Reads each reviewer's *current* decision via ``ReviewerState`` — any
        reviewer who has settled the coord protects it, since AI proposals are
        shared across reviewers. ``reject`` is intentionally excluded: a
        rejected field is unresolved, so a fresh AI suggestion is still
        welcome.
        """
        if not field_ids:
            return set()
        stmt = (
            select(
                ExtractionReviewerState.field_id,
                ExtractionReviewerDecision.decision,
            )
            .join(
                ExtractionReviewerDecision,
                and_(
                    ExtractionReviewerDecision.run_id == ExtractionReviewerState.run_id,
                    ExtractionReviewerDecision.id == ExtractionReviewerState.current_decision_id,
                ),
            )
            .where(
                ExtractionReviewerState.run_id == run_id,
                ExtractionReviewerState.instance_id == instance_id,
                ExtractionReviewerState.field_id.in_(field_ids),
            )
        )
        rows = (await self.db.execute(stmt)).all()
        settled = {
            ExtractionReviewerDecisionType.EDIT.value,
            ExtractionReviewerDecisionType.ACCEPT_PROPOSAL.value,
        }
        return {field_id for field_id, decision in rows if decision in settled}

    async def extract_all_sections(
        self,
        project_id: UUID,
        article_id: UUID,
        template_id: UUID,
        parent_instance_id: UUID,
        section_ids: list[UUID] | None = None,
        pdf_text: str | None = None,
        model: str = settings.LLM_DEFAULT_MODEL,
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
            target_stage=ExtractionRunStage.EXTRACT,
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
            # 1. Assemble block-markdown prompt input once per run.
            if not pdf_text:
                phase_start = perf_counter()
                pdf_text = await self._assemble_prompt_text(article_id, model)
                phase_durations_ms["assemble_prompt"] = (perf_counter() - phase_start) * 1000
            elif not self._run_anchor_blocks:
                # pdf_text supplied → assembly skipped; still populate anchor stash.
                await self._assemble_prompt_text(article_id, model)

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

            # Run stays in EXTRACT — see ``extract_section`` for the
            # rationale. The user advances to CONSENSUS via "Open consensus"
            # after inspecting the AI-proposed values.

            if total_sections and successful == 0:
                raise BatchAllSectionsFailed(f"All {failed} section(s) failed for run {run.id}.")

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
            await self._runs.rollback_and_fail(
                run.id,
                str(e),
                logger=self.logger,
                trace_id=self.trace_id,
                log_prefix="section_extraction",
            )
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
            target_stage=ExtractionRunStage.EXTRACT,
            user_id=UUID(self.user_id),
        )

        await self._runs.start_run(run.id)

        try:
            # Run extraction with memory context
            phase_start = perf_counter()
            extracted_data, llm_usage = await self._extract_with_llm(
                pdf_text=pdf_text,
                entity_type=entity_type,
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
                model=model,
            )
            section_phase_durations_ms["create_suggestions"] = (perf_counter() - phase_start) * 1000

            # Generate memory summary (max 200 chars)
            summary = self._generate_extraction_summary(entity_type, extracted_data)

            # Run stays in EXTRACT — see ``extract_section`` for the
            # rationale. The user advances to CONSENSUS via "Open consensus"
            # after inspecting the AI-proposed values.

            # Complete run
            phase_start = perf_counter()
            await self._runs.complete_run(
                run_id=run.id,
                results={
                    "suggestions_created": suggestions_created,
                    "tokens_prompt": llm_usage.prompt_tokens,
                    "tokens_completion": llm_usage.completion_tokens,
                    "tokens_total": llm_usage.total_tokens,
                    "summary": summary,
                    "duration_ms": (perf_counter() - section_start) * 1000,
                    "phase_durations_ms": section_phase_durations_ms,
                    "provenance": self._provenance_with_tokens(llm_usage),
                },
            )
            section_phase_durations_ms["complete_run"] = (perf_counter() - phase_start) * 1000

            return {
                "suggestions_created": suggestions_created,
                "tokens_total": llm_usage.total_tokens,
                "summary": summary,
                "phase_durations_ms": section_phase_durations_ms,
            }

        except (AgentRunError, MissingLLMKeyError) as e:
            # LLM-semantic failure (reask exhausted, usage ceiling, missing
            # key): the DB session is healthy. Fail ONLY this section's run —
            # rollback_and_fail would discard the whole uncommitted batch
            # transaction (sibling sections + the parent batch run).
            await self._runs.fail_run(run.id, str(e))
            raise
        except Exception as e:
            # DB-layer failure: the transaction may be poisoned
            # (InFailedSQLTransactionError) — rollback before failing.
            await self._runs.rollback_and_fail(
                run.id,
                str(e),
                logger=self.logger,
                trace_id=self.trace_id,
                log_prefix="section_extraction",
            )
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

    async def _extract_with_llm(
        self,
        pdf_text: str,
        entity_type: Any,
        model: str,
        memory_context: list[dict[str, str]] | None = None,
        kind: str = "extraction",
        framework: str | None = None,
    ) -> tuple[dict[str, Any], LlmUsage]:
        """
        Run extraction using the typed LLM call layer.

        Args:
            pdf_text: PDF text.
            entity_type: Entity type to extract (fields drive the output model).
            model: OpenAI model name.
            memory_context: Summarized memory context (optional).
            kind: 'extraction' or 'quality_assessment' — selects the prompt
                pair. The response shape is identical either way, so
                downstream proposal writes are unchanged.
            framework: When kind=='quality_assessment', the assessment
                framework (PROBAST / QUADAS-2) the prompts ground in.

        Returns:
            Tuple of extracted data ({field_name: {value, confidence,
            reasoning, evidence}}) and token usage. Templates larger than
            the strict-mode property budget are split into multiple calls
            and merged transparently.
        """
        entity_name = entity_type.name if hasattr(entity_type, "name") else "data"
        entity_description = entity_type.description if hasattr(entity_type, "description") else ""

        if kind == "quality_assessment":
            prompt_module: Any = quality_assessment
            system_prompt = quality_assessment.system_prompt(framework)
            user_prompt = quality_assessment.render(
                entity_name=entity_name,
                entity_description=entity_description,
                article_text=pdf_text,
                framework=framework,
                memory_context=memory_context,
            )
        else:
            prompt_module = section_extraction
            system_prompt = section_extraction.SYSTEM_PROMPT
            user_prompt = section_extraction.render(
                entity_name=entity_name,
                entity_description=entity_description,
                article_text=pdf_text,
                memory_context=memory_context,
            )

        output_models = build_output_models(entity_type)
        if not output_models:
            self.logger.info(
                "extraction_skipped_no_fields",
                trace_id=self.trace_id,
                entity_type_name=entity_name,
            )
            return {}, LlmUsage()

        llm_model = build_model(settings.LLM_PROVIDER, model, api_key=self._llm_api_key)

        extracted_data: dict[str, Any] = {}
        usage = LlmUsage()
        for output_model in output_models:
            output, call_usage = await extract_structured(
                output_model=output_model,
                system_prompt=system_prompt,
                user_prompt=user_prompt,
                model=llm_model,
                prompt_name=prompt_module.NAME,
                prompt_version=prompt_module.VERSION,
                validators=[evidence_is_plausible],
            )
            extracted_data.update(dump_extraction(output))
            usage = usage + call_usage

        self._run_provenance = self._build_run_provenance(
            model=model,
            prompt_name=prompt_module.NAME,
            prompt_version=prompt_module.VERSION,
            prompt_text=system_prompt,
        )
        return extracted_data, usage

    async def _create_suggestions(
        self,
        project_id: UUID,
        article_id: UUID,
        entity_type_id: UUID,
        parent_instance_id: UUID | None,
        extracted_data: dict[str, Any],
        run: ExtractionRun,
        model: str = settings.LLM_DEFAULT_MODEL,
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
            model: LLM model name (used to build the entailment judge model).

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

        # Build field_name -> field_id / label / field maps. The field object is
        # kept so the entailment gate can resolve a select/boolean CODE to its
        # human label before building the judge claim (see value_str_for_claim).
        field_map: dict[str, UUID] = {}
        field_label_map: dict[str, str] = {}
        field_by_name: dict[str, Any] = {}
        for field in entity_type.fields or []:
            field_map[field.name] = field.id
            field_label_map[field.name] = (
                field.label if hasattr(field, "label") and field.label else field.name
            )
            field_by_name[field.name] = field

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
            )

            instance = await self._instances.create(new_instance)

            self.logger.info(
                "instance_auto_created",
                trace_id=self.trace_id,
                instance_id=str(instance.id),
                entity_type_id=str(entity_type_id),
            )

        # Blocks were fetched once per run by _assemble_prompt_text; reuse them here
        # to ground each evidence quote to a PositionV1 anchor (empty → position={}).
        _anchor_blocks = self._run_anchor_blocks
        _anchor_file_id = self._run_anchor_file_id

        # Per-field gate queues: specs for the helper, rows to assign labels back.
        _gate_specs: list[GateSpec] = []
        _gate_rows: list[ExtractionEvidence] = []

        # Record one ProposalRecord per extracted field. Evidence cited by
        # the LLM is stored as a real extraction_evidence row linked to
        # the proposal via proposal_record_id.
        for field_name, value in extracted_data.items():
            field_id = field_map.get(field_name)
            if not field_id:
                self.logger.warning(
                    "field_not_found_for_suggestion",
                    trace_id=self.trace_id,
                    field_name=field_name,
                    available_fields=list(field_map.keys()),
                )
                continue

            # "No information found": a bare None or a structured abstention
            # (status not_found / ambiguous). Record it as a first-class proposal
            # (value=None) so the run's outcome is traceable to the reviewer,
            # instead of silently dropping the field.
            is_no_info = value is None or (
                isinstance(value, dict) and value.get("status") in ("not_found", "ambiguous")
            )

            confidence_score: float | None = None
            reasoning: str | None = None

            if isinstance(value, dict):
                confidence_score = value.get("confidence")
                reasoning = value.get("reasoning")
                raw_evidence = value.get("evidence")
                inner_value = value.get("value", value)
            else:
                raw_evidence = None
                inner_value = value

            if is_no_info:
                # The no-info value is null — never wrap the status dict. Drop
                # the abstention confidence (a not_found 0.0 reads as a
                # misleading 0% on the card) and there is no evidence; keep the
                # "why not found" reasoning.
                inner_value = None
                raw_evidence = None
                confidence_score = None

            # Build evidence_items list (cap at EVIDENCE_CAP).
            # Supports both the new list shape (P1) and the legacy single-dict
            # shape (P0) so old LLM responses continue to work.
            evidence_items: list[dict[str, Any]] = []
            if isinstance(raw_evidence, list):
                for e in raw_evidence:
                    if isinstance(e, dict) and (e.get("text") or "").strip():
                        evidence_items.append(
                            {
                                "text": str(e["text"]).strip(),
                                "page_number": e.get("page_number"),
                            }
                        )
            elif isinstance(raw_evidence, dict) and (raw_evidence.get("text") or "").strip():
                # LEGACY tolerance: old P0 shape was a single evidence dict → one row, rank 0.
                evidence_items.append(
                    {
                        "text": str(raw_evidence["text"]).strip(),
                        "page_number": raw_evidence.get("page_number"),
                    }
                )
            evidence_items = evidence_items[:EVIDENCE_CAP]

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

            for rank, item in enumerate(evidence_items):
                quote = item["text"]
                pos = build_anchor(quote, _anchor_blocks) if _anchor_blocks and quote else None
                if pos is not None:
                    position: dict = pos.model_dump(by_alias=True, mode="json")
                    page_num = pos.anchor.range.page
                else:
                    position = {}
                    page_num = item.get("page_number")
                ev_row = ExtractionEvidence(
                    project_id=project_id,
                    article_id=article_id,
                    article_file_id=_anchor_file_id if pos is not None else None,
                    run_id=run.id,
                    proposal_record_id=proposal.id,
                    page_number=page_num,
                    text_content=quote,
                    position=position,
                    rank=rank,
                    created_by=UUID(self.user_id),
                )
                self.db.add(ev_row)

                # Queue for entailment gate: found fields with ANCHORED evidence only.
                if isinstance(value, dict) and value.get("status") == "found" and quote:
                    if pos is not None:
                        _gate_field = field_by_name.get(field_name)
                        _gate_specs.append(
                            GateSpec(
                                field_label=field_label_map.get(field_name, field_name),
                                # Resolve a select/boolean CODE ("Y") to its human
                                # label ("Yes") so the judge claim is interpretable;
                                # numeric/date/text pass through unchanged.
                                value_str=value_str_for_claim(
                                    field_type=getattr(_gate_field, "field_type", None),
                                    allowed_values=getattr(_gate_field, "allowed_values", None),
                                    value=inner_value,
                                ),
                                quote=quote,
                                pos=pos,
                                anchor_blocks=_anchor_blocks,
                            )
                        )
                        _gate_rows.append(ev_row)
                    else:
                        # No text anchor → cannot ground the value in the document
                        # (e.g. the value appears only in a figure). Flag for human
                        # verification instead of judging an unanchored quote.
                        ev_row.attribution_label = "ungroundable"

            count += 1

        # Run the entailment gate; premise-building + fan-out live in the helper.
        if _gate_specs:
            _judge_model = build_model(settings.LLM_PROVIDER, model, api_key=self._llm_api_key)
            labels = await run_entailment_gate(_gate_specs, _judge_model, self.logger)
            for row, label in zip(_gate_rows, labels, strict=True):
                if label is not None:
                    row.attribution_label = label

        await self.db.flush()

        self.logger.info(
            "proposals_recorded",
            trace_id=self.trace_id,
            count=count,
            instance_id=str(instance.id),
            run_id=str(run.id),
        )

        return count

    async def run_from_request(
        self,
        payload: SectionExtractionRequest,
    ) -> SectionExtractionResult | BatchExtractionResult:
        """Dispatch a SectionExtractionRequest to the correct extraction method.

        Mirrors the 3-branch dispatch in the section_extraction endpoint so
        the same logic can be reused from a Celery task without touching the
        HTTP layer.  The caller is responsible for committing (or rolling back)
        the session — this method does not commit.

        Branch priority (first match wins):
        1. ``entity_type_id`` present → single-section path via
           ``extract_section``. Handles both standalone and existing-run
           (``run_id`` set) callers; the service routes internally.
        2. ``run_id`` set (no ``entity_type_id``) → ``extract_for_run`` iterates
           every top-level entity_type of that run's template (QA surface).
        3. ``extract_all_sections`` → batch sweep of child sections under
           ``parent_instance_id`` (per-model CHARMS batch).
        """
        model = payload.model or settings.LLM_DEFAULT_MODEL

        if payload.entity_type_id is not None:
            return await self.extract_section(
                project_id=payload.project_id,
                article_id=payload.article_id,
                template_id=payload.template_id,
                entity_type_id=payload.entity_type_id,
                parent_instance_id=payload.parent_instance_id,
                model=model,
                run_id=payload.run_id,
            )

        if payload.run_id is not None:
            return await self.extract_for_run(
                run_id=payload.run_id,
                skip_fields_with_human_proposals=payload.skip_fields_with_human_proposals,
                auto_advance_to_review=payload.auto_advance_to_review,
                model=model,
            )

        # Branch 3: extract_all_sections (validator guarantees parent_instance_id).
        return await self.extract_all_sections(
            project_id=payload.project_id,
            article_id=payload.article_id,
            template_id=payload.template_id,
            parent_instance_id=payload.parent_instance_id,  # type: ignore[arg-type]
            section_ids=payload.section_ids,
            pdf_text=payload.pdf_text,
            model=model,
        )
