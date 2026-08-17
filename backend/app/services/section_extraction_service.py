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

from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.logging import LoggerMixin
from app.infrastructure.storage import StorageAdapter
from app.llm.claim_value import value_str_for_claim
from app.llm.entailment import GateSpec, run_entailment_gate
from app.llm.extractor import LlmUsage, extract_structured
from app.llm.provider import build_model
from app.llm.schema import build_output_models, dump_extraction
from app.llm.validators import evidence_is_plausible
from app.llm.verify import VerificationAnnotation
from app.models.extraction import (
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
from app.schemas.llm_target import LlmTarget
from app.services.api_key_service import APIKeyService, KeyScope
from app.services.evidence_anchor_service import build_anchor
from app.services.extraction_prompt_input import PromptInputInfo, build_prompt_input
from app.services.extraction_proposal_service import ExtractionProposalService
from app.services.extraction_snapshot import (
    entity_types_for_version,
    general_instructions_for_version,
)
from app.services.llm_engine_service import resolve_project_engine
from app.services.run_engine_freeze import freeze_run_engine
from app.services.run_lifecycle_service import RunLifecycleService
from app.services.value_semantics import AbsentReason
from app.services.verified_mode import (
    SectionSnapshotInputs,
    render_section_prompts,
    verify_and_snapshot,
)

# Maximum number of evidence rows written per extracted field.
EVIDENCE_CAP = 3

# Stands in for the full article text inside the persisted section_instruction,
# so the composition is byte-faithful to the run's template without duplicating
# the (multi-thousand-token) article per section.
ARTICLE_MARKDOWN_MARKER = "[[ARTICLE_MARKDOWN]]"


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


def _qa_framework_label(template: Any | None) -> str | None:
    """Label the quality-assessment prompt grounds in.

    Prefers the template's human name ("PROBAST+AI", "QUADAS-2") over
    ``framework``: every quality-assessment template is ``framework='CUSTOM'``
    (the enum has only CHARMS/PICOS/CUSTOM), so the enum produced the literal
    prompt "assessing a study using CUSTOM". Falls back to ``framework`` when
    the name is missing or blank.
    """
    if template is None:
        return None
    name = (getattr(template, "name", None) or "").strip()
    return name or getattr(template, "framework", None)


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
        key_scope: KeyScope | None = None,
        key_provider: str | None = None,
    ):
        """Initialize service instance.

        Args:
            openai_api_key: Custom API key (BYOK). If None, uses global key.
            key_scope: WHOSE key that is, for provenance (§5.2) — resolved by
                the caller, since only it knows which lookup branch won.
            key_provider: The provider the injected key was resolved FOR.
                When ``_adopt_frozen_engine`` settles on a pin whose provider
                differs (a manager flip between key resolution and adoption —
                the standalone path REUSES the coordinate's live run), the
                service re-resolves key + scope for the adopted provider.
                ``None`` means unknown (direct/legacy callers): the injected
                key is used as-is, never re-resolved.
        """
        self.db = db
        self.user_id = user_id
        self.storage = storage
        self.trace_id = trace_id
        self._llm_api_key = openai_api_key
        self._key_scope = key_scope
        self._key_provider = key_provider

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
        # Assembly info from the last prompt build (truncation, token estimate,
        # source file) — feeds the per-section prompt_composition provenance.
        self._prompt_input_info: PromptInputInfo | None = None
        # Snapshot inputs stashed by _extract_with_llm; _maybe_verify builds
        # the section snapshot from them, post-verify, into _run_provenance.
        self._snapshot_inputs: SectionSnapshotInputs | None = None
        self._run_provenance: dict[str, Any] | None = None
        # Engine for every LLM call here: the env-default candidate until a
        # caller passes a resolved one; ``freeze_run_engine`` rebinds it to
        # the run's pinned target before any LLM call.
        self._engine = LlmTarget(provider=settings.LLM_PROVIDER, model=settings.LLM_DEFAULT_MODEL)

    async def _adopt_frozen_engine(self, run_id: UUID, candidate: LlmTarget) -> str:
        """Freeze-or-read the run's engine, adopt it, return its model.

        Adoption can settle on a DIFFERENT provider than the caller keyed
        for (the run's pin wins over the candidate), so the key is
        re-checked against the settled provider before any LLM call.
        """
        self._engine = await freeze_run_engine(self._runs, run_id, candidate)
        await self._rekey_for_adopted_provider()
        return self._engine.model

    async def _rekey_for_adopted_provider(self) -> None:
        """Re-resolve key + scope when the settled engine's provider is not
        the one the injected key was resolved for.

        The standalone path (``run_id=None``) REUSES the coordinate's live
        run, so ``_adopt_frozen_engine`` can settle on a pin from BEFORE a
        manager's provider flip — while the caller keyed the freshly-resolved
        project provider. Pairing that key with the pinned engine 401s (BYOK)
        or records a ``key_scope`` that names the wrong resolution (§5.2). A
        ``None`` result degrades to no key + no scope — never raises —
        leaving ``build_model``'s global fallback as the last resort.
        ``_key_provider`` is updated either way so a later adoption on the
        same service never double-keys.
        """
        if self._key_provider is None or self._key_provider == self._engine.provider:
            return
        resolved = await APIKeyService(self.db, self.user_id).get_key_for_provider(
            self._engine.provider
        )
        self._llm_api_key = resolved.key if resolved is not None else None
        self._key_scope = resolved.scope if resolved is not None else None
        self._key_provider = self._engine.provider
        self.logger.info(
            "section_extraction_rekeyed_for_pinned_provider",
            trace_id=self.trace_id,
            provider=self._engine.provider,
            key_scope=self._key_scope.value if self._key_scope is not None else None,
        )

    async def _assemble_prompt_text(self, article_id: UUID, model: str) -> str:
        """Budgeted block-markdown prompt input; stashes assembly info on self."""
        text, info = await build_prompt_input(
            db=self.db,
            article_files=self._article_files,
            storage=self.storage,
            article_id=article_id,
            model=model,
            logger=self.logger,
            user_id=self.user_id,
            trace_id=self.trace_id,
        )
        self._prompt_input_info = info
        self._run_anchor_blocks = info.anchor_blocks
        self._run_anchor_file_id = info.anchor_file_id
        return text

    async def extract_section(
        self,
        project_id: UUID,
        article_id: UUID,
        template_id: UUID,
        entity_type_id: UUID,
        parent_instance_id: UUID | None = None,
        engine: LlmTarget | None = None,
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
            engine: Candidate engine (the caller's resolved project engine);
                used only if the run has none pinned yet. ``None`` falls back
                to the service's env-default candidate.
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
        if engine is None:
            engine = self._engine

        # When the caller passes a ``run_id`` (extraction surface via the
        # HITL session service), append proposals to that run and skip the
        # lifecycle bookkeeping the standalone path needs. The session
        # owns ``start_run`` / ``complete_run`` / ``fail_run`` and the
        # stage advance — calling them here would close the run after one
        # section, breaking subsequent section-by-section AI clicks.
        # Without a ``run_id`` the resolve-or-create gate applies (one-live-run
        # invariant, index 0045): the coordinate's live run is reused when one
        # exists — an unconditional create would 23505 — so ``manage_lifecycle``
        # follows CREATION, not the run_id parameter.
        if run_id is not None:
            existing_run = await self.db.get(ExtractionRun, run_id)
            if existing_run is None:
                raise ValueError(f"Run {run_id} not found")
            if existing_run.stage != ExtractionRunStage.EXTRACT.value:
                raise ValueError(
                    f"Run {run_id} stage is {existing_run.stage}; AI extraction requires EXTRACT",
                )
            run = existing_run
            manage_lifecycle = False
        else:
            run, manage_lifecycle = await self._lifecycle.resolve_or_create_extract_run(
                project_id=project_id,
                article_id=article_id,
                project_template_id=template_id,
                user_id=UUID(self.user_id),
                parameters={
                    "model": engine.model,
                    "entity_type_id": str(entity_type_id),
                    "parent_instance_id": (str(parent_instance_id) if parent_instance_id else None),
                },
            )
            if manage_lifecycle:
                await self._runs.start_run(run.id)

        model = await self._adopt_frozen_engine(run.id, engine)
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

            # 4. Entity type + fields from the run-PINNED snapshot (B-2):
            # structure and instructions come from run.version_id, never live
            # rows. Fields sent to the LLM are snapshot ∩ live (a field
            # deleted live is silently not extracted; one added live is
            # invisible until publish re-pins). Falls back to the live row
            # when the id is not in the pin (re-pin race) — today's behavior.
            phase_start = perf_counter()
            pinned_tree = await self._pinned_entity_types(run)
            entity_type: Any = next((et for et in pinned_tree if et.id == entity_type_id), None)
            fields_override: list[Any] | None = None
            if entity_type is None:
                entity_type = await self._get_entity_type(entity_type_id)
            else:
                fields_override = await self._live_field_intersection(entity_type)
                if fields_override is None:
                    # Pinned but deleted live — mirrors the live path's error.
                    raise ValueError(f"Entity type not found: {entity_type_id}")
            phase_durations_ms["fetch_entity_type"] = (perf_counter() - phase_start) * 1000

            # 5. Run LLM extraction (with token tracking)
            phase_start = perf_counter()
            general_instructions = await general_instructions_for_version(self.db, run.version_id)
            extracted_data, llm_usage = await self._extract_with_llm(
                pdf_text=pdf_text,
                entity_type=entity_type,
                fields_override=fields_override,
                general_instructions=general_instructions,
            )
            # 6. Verify pass (Verified mode; mode check inside) + snapshot.
            verdicts, llm_usage = await self._maybe_verify(
                run.id, entity_type_id, pdf_text, extracted_data, llm_usage
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
                verdicts=verdicts,
            )
            phase_durations_ms["create_suggestions"] = (perf_counter() - phase_start) * 1000

            # Run stays in EXTRACT. The HITL session service's
            # ``_reuse_or_create_run`` returns this run on next session
            # open (most-recent non-terminal), so ``useExtractedValues``
            # hydrates from ``runDetail.proposals`` and the AI values
            # show in the form immediately. The user advances to CONSENSUS
            # explicitly via "Start consensus" — auto-advancing here would
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
                    },
                )
                phase_durations_ms["complete_run"] = (perf_counter() - phase_start) * 1000
            # Session-run path: the HITL session owns the run lifecycle, so we
            # must NOT complete it (that would close the run after one section
            # and break further section-by-section AI clicks). The run's
            # provenance was already persisted by ``_create_suggestions`` (the
            # proposal choke-point), so nothing else to do here.

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
        engine: LlmTarget | None = None,
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

        The system / user prompt is selected from ``run.kind`` + the template
        NAME (see ``_qa_framework_label``) so PROBAST / PROBAST+AI / QUADAS-2
        runs get an assessment-style prompt naming the actual instrument, while
        extraction runs keep the original "extract from scientific article"
        prompt.
        """
        start_time = perf_counter()
        if engine is None:
            engine = self._engine

        run = await self.db.get(ExtractionRun, run_id)
        if run is None:
            raise ValueError(f"Run {run_id} not found")
        if run.stage != ExtractionRunStage.EXTRACT.value:
            raise ValueError(f"Run {run_id} stage is {run.stage}; AI extraction requires EXTRACT")

        template = await self.db.get(ProjectExtractionTemplate, run.template_id)
        framework: str | None = _qa_framework_label(template)
        kind = run.kind

        await self._runs.start_run(run.id)
        model = await self._adopt_frozen_engine(run.id, engine)

        section_results: list[dict[str, Any]] = []
        total_suggestions = 0
        total_tokens = 0
        successful = 0
        failed = 0

        try:
            pdf_text = await self._assemble_prompt_text(run.article_id, model)

            # Run-constant (keyed by the pinned version): fetch once, not per section.
            general_instructions = await general_instructions_for_version(self.db, run.version_id)

            # Top-level set from the run-PINNED snapshot (B-2). The provider
            # chains empty/narrow snapshots to live rows, so an empty pin can
            # never turn this into a green no-op run.
            pinned_tree = await self._pinned_entity_types(run)
            top_level = [et for et in pinned_tree if et.parent_entity_type_id is None]

            for entity_type in top_level:
                try:
                    result = await self._extract_one_entity_type_for_run(
                        run=run,
                        entity_type=entity_type,
                        pdf_text=pdf_text,
                        framework=framework,
                        kind=kind,
                        skip_fields_with_human_proposals=skip_fields_with_human_proposals,
                        general_instructions=general_instructions,
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

            # Provenance is written per-section at the proposal choke-point
            # (``_create_suggestions`` → ``merge_provenance_section``); do NOT
            # write a run-aggregate ``provenance`` here — ``complete_run``
            # shallow-merges, so it would clobber the per-section ``sections`` map
            # with the last section's snapshot.
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
        general_instructions: str | None = None,
    ) -> dict[str, Any]:
        """Extract a single entity_type into an existing Run.

        Distinct from ``_extract_section_with_memory`` because it does
        NOT create a fresh Run — it appends ``source='ai'`` proposals
        onto the Run that the caller already owns.
        """
        # The PINNED entity drives the prompt; the live row is demoted to a
        # coherence source (existence + live field-id set). None = deleted
        # live -> skip, mirroring the old live-refetch behavior.
        pinned_fields = await self._live_field_intersection(entity_type)
        if pinned_fields is None:
            return {"suggestions_created": 0, "tokens_total": 0, "skipped": True}

        instance = await self._find_instance_for_entity_type(
            article_id=run.article_id,
            entity_type_id=entity_type.id,
        )

        # Always pass an override (never mutate a fields collection — the
        # live ORM one cascades delete-orphan; see the FK regression test).
        fields_override: list[Any] | None = pinned_fields
        original_fields = list(pinned_fields)
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
            fields_override = filtered

        extracted_data, llm_usage = await self._extract_with_llm(
            pdf_text=pdf_text,
            entity_type=entity_type,
            kind=kind,
            framework=framework,
            fields_override=fields_override,
            general_instructions=general_instructions,
        )
        verdicts, llm_usage = await self._maybe_verify(
            run.id, entity_type.id, pdf_text, extracted_data, llm_usage
        )
        suggestions_created = await self._create_suggestions(
            project_id=run.project_id,
            article_id=run.article_id,
            entity_type_id=entity_type.id,
            parent_instance_id=None,
            extracted_data=extracted_data,
            run=run,
            verdicts=verdicts,
        )
        return {
            "suggestions_created": suggestions_created,
            "tokens_total": llm_usage.total_tokens,
            "usage": llm_usage,
        }

    async def _pinned_entity_types(self, run: ExtractionRun) -> list[Any]:
        """The frozen tree this run is pinned to (shared B-2 provider)."""
        return await entity_types_for_version(
            self.db, version_id=run.version_id, template_id=run.template_id
        )

    async def _live_field_intersection(self, entity_type: Any) -> list[Any] | None:
        """Snapshot fields ∩ live field ids for one pinned entity type.

        ``None`` means the entity type no longer exists live (skip — a
        proposal write could not resolve it anyway). The intersection is
        pair-safe by construction: ids are matched inside this one entity
        type's live field set.

        The field NAME is the write-layer bridge: the LLM answers with the
        prompt's property key and ``_create_suggestions`` resolves that key
        against LIVE field names. A field renamed live (same id) therefore
        carries the LIVE name into the prompt — otherwise the write would
        silently drop the extracted value — while the semantic prompt
        content (label, description, llm_description) stays pinned.
        """
        live = await self._entity_types.get_with_fields(entity_type.id)
        if live is None:
            return None
        live_by_id = {f.id: f for f in (live.fields or [])}
        result: list[Any] = []
        for field in entity_type.fields:
            live_field = live_by_id.get(field.id)
            if live_field is None:
                continue
            if field.name != live_field.name:
                field = field.model_copy(update={"name": live_field.name})
            result.append(field)
        return result

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
        engine: LlmTarget | None = None,
        run_id: UUID | None = None,
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
            engine: Candidate engine (the caller's resolved project engine);
                used only if the run has none pinned yet. ``None`` falls back
                to the service's env-default candidate.
            run_id: Existing run to append to. When set (the extraction surface),
                the run is REUSED and its lifecycle left to the HITL session, so
                a reviewer's decisions are never orphaned onto a forked run.
                Mirrors ``extract_section``'s ``manage_lifecycle`` pattern.

        Returns:
            BatchExtractionResult with extraction statistics.
        """
        start_time = perf_counter()
        phase_durations_ms: dict[str, float] = {}
        if engine is None:
            engine = self._engine

        # Resolve the run. When a ``run_id`` is passed, REUSE the session-owned
        # run (append child-section proposals) and leave its lifecycle to the
        # HITL session — forking here would shadow the reviewer's decisions.
        # Without a ``run_id`` the resolve-or-create gate applies (one-live-run
        # invariant, index 0045): the coordinate's live run is reused when one
        # exists — this is also what lets the FE's CHUNKED batch calls share
        # one run instead of 23505-ing on the second chunk. ``manage_lifecycle``
        # follows CREATION, not the run_id parameter.
        if run_id is not None:
            existing_run = await self.db.get(ExtractionRun, run_id)
            if existing_run is None:
                raise ValueError(f"Run {run_id} not found")
            if existing_run.stage != ExtractionRunStage.EXTRACT.value:
                raise ValueError(
                    f"Run {run_id} stage is {existing_run.stage}; "
                    "batch section extraction requires EXTRACT"
                )
            run = existing_run
            manage_lifecycle = False
        else:
            run, manage_lifecycle = await self._lifecycle.resolve_or_create_extract_run(
                project_id=project_id,
                article_id=article_id,
                project_template_id=template_id,
                user_id=UUID(self.user_id),
                parameters={
                    "model": engine.model,
                    "batch_extraction": True,
                    "parent_instance_id": str(parent_instance_id),
                    "section_ids": [str(sid) for sid in section_ids] if section_ids else None,
                },
            )
            if manage_lifecycle:
                await self._runs.start_run(run.id)

        model = await self._adopt_frozen_engine(run.id, engine)
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
                run=run,
                parent_instance_id=parent_instance_id,
                section_ids=section_ids,
            )
            phase_durations_ms["fetch_child_entity_types"] = (perf_counter() - phase_start) * 1000

            total_sections = len(child_types)
            successful = 0
            failed = 0
            total_suggestions = 0

            # Run-constant (keyed by the pinned version): fetch once, not per section.
            general_instructions = await general_instructions_for_version(self.db, run.version_id)

            # 3. Extract each section sequentially with memory — every section
            # appends to THE batch run (no more one-run-per-section pollution).
            for entity_type in child_types:
                try:
                    result = await self._extract_section_with_memory(
                        run=run,
                        entity_type=entity_type,
                        parent_instance_id=parent_instance_id,
                        pdf_text=pdf_text,
                        memory_history=memory_history,
                        general_instructions=general_instructions,
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
            # rationale. The user advances to CONSENSUS via "Start consensus"
            # after inspecting the AI-proposed values.

            if total_sections and successful == 0:
                raise BatchAllSectionsFailed(f"All {failed} section(s) failed for run {run.id}.")

            duration = (perf_counter() - start_time) * 1000

            # 4. Complete primary run — standalone path only. In the session-run
            # (reuse) path the HITL session owns the lifecycle, so completing here
            # would close the run and break further edits on it.
            if manage_lifecycle:
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
            # Only fail the run in the standalone path — the session owns the
            # lifecycle in the reuse path; the error propagates for it to handle.
            if manage_lifecycle:
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
        run: ExtractionRun,
        entity_type: Any,
        parent_instance_id: UUID,
        pdf_text: str,
        memory_history: list[dict[str, str]],
        general_instructions: str | None = None,
    ) -> dict[str, Any]:
        """
        Extract one section with summarized memory context onto the batch run.

        The section appends its proposals to the SHARED batch run — it never
        creates or completes a run of its own. The old one-run-per-section
        design scattered a batch's proposals across N EXTRACT-stage runs that
        nothing ever closed: the session opener resolved only the newest, the
        rest were invisible pollution, and under the one-live-run invariant
        (index 0045) the second section's create would fail outright. Per-
        section provenance still flows through the ``_create_suggestions``
        choke point; lifecycle and failure accounting belong to the caller
        (``extract_all_sections``), whose loop counts this section's raised
        exception as a failed section.

        Args:
            run: The batch run (session-owned or batch-created) to append to.
            entity_type: Entity type to extract.
            parent_instance_id: Parent instance ID.
            pdf_text: PDF text.
            memory_history: Summarized memory history.

        Returns:
            Dict with suggestions_created, tokens_total, and summary.
        """
        section_phase_durations_ms: dict[str, float] = {}

        # Same coherence contract as the sibling paths: fields sent to the
        # LLM are snapshot ∩ live; a section deleted live is skipped before
        # burning an LLM call on values the write layer could not resolve.
        pinned_fields = await self._live_field_intersection(entity_type)
        if pinned_fields is None:
            return {"suggestions_created": 0, "tokens_total": 0, "skipped": True}

        # Run extraction with memory context
        phase_start = perf_counter()
        extracted_data, llm_usage = await self._extract_with_llm(
            pdf_text=pdf_text,
            entity_type=entity_type,
            memory_context=memory_history,
            fields_override=pinned_fields,
            general_instructions=general_instructions,
        )
        verdicts, llm_usage = await self._maybe_verify(
            run.id, entity_type.id, pdf_text, extracted_data, llm_usage
        )
        section_phase_durations_ms["extract_llm"] = (perf_counter() - phase_start) * 1000

        # Create suggestions
        phase_start = perf_counter()
        suggestions_created = await self._create_suggestions(
            project_id=run.project_id,
            article_id=run.article_id,
            entity_type_id=entity_type.id,
            parent_instance_id=parent_instance_id,
            extracted_data=extracted_data,
            run=run,
            verdicts=verdicts,
        )
        section_phase_durations_ms["create_suggestions"] = (perf_counter() - phase_start) * 1000

        # Generate memory summary (max 200 chars)
        summary = self._generate_extraction_summary(entity_type, extracted_data)

        return {
            "suggestions_created": suggestions_created,
            "tokens_total": llm_usage.total_tokens,
            "summary": summary,
            "phase_durations_ms": section_phase_durations_ms,
        }

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
        run: ExtractionRun,
        parent_instance_id: UUID,
        section_ids: list[UUID] | None = None,
    ) -> list[Any]:
        """
        Child entity types of the parent instance's entity_type, from the
        run-PINNED snapshot (B-2).

        The parent INSTANCE is runtime data and stays a live read; the
        children STRUCTURE comes from the pinned tree, so a child section
        added live is invisible until publish re-pins the run. Field-level
        coherence is enforced at the write layer (``_create_suggestions``
        resolves field names against live rows).
        """
        # 1. Fetch parent instance (runtime data — live) to get its entity_type_id
        parent_instance = await self._instances.get_by_id(parent_instance_id)

        if not parent_instance:
            self.logger.warning(
                "parent_instance_not_found",
                trace_id=self.trace_id,
                parent_instance_id=str(parent_instance_id),
            )
            return []

        parent_entity_type_id = parent_instance.entity_type_id

        # 2. Children of this parent in the PINNED tree
        pinned_tree = await self._pinned_entity_types(run)
        child_entity_types = [
            et for et in pinned_tree if et.parent_entity_type_id == parent_entity_type_id
        ]

        if not child_entity_types:
            self.logger.info(
                "no_child_entity_types_found",
                trace_id=self.trace_id,
                parent_entity_type_id=str(parent_entity_type_id),
            )
            return []

        # 3. Filter by section_ids if provided
        if section_ids:
            child_entity_types = [et for et in child_entity_types if et.id in section_ids]

        self.logger.info(
            "child_entity_types_found",
            trace_id=self.trace_id,
            count=len(child_entity_types),
            parent_entity_type_id=str(parent_entity_type_id),
        )

        return child_entity_types

    async def _extract_with_llm(
        self,
        pdf_text: str,
        entity_type: Any,
        memory_context: list[dict[str, str]] | None = None,
        kind: str = "extraction",
        framework: str | None = None,
        fields_override: list[Any] | None = None,
        general_instructions: str | None = None,
    ) -> tuple[dict[str, Any], LlmUsage]:
        """Run extraction using the typed LLM call layer.

        ``kind`` selects the prompt pair ('extraction' /
        'quality_assessment', ``framework`` naming the instrument);
        ``fields_override`` is the exact field list to send (never mutate
        ``entity_type.fields``); ``general_instructions`` comes from the
        run-pinned snapshot, never the live column. Returns ({field_name:
        {value, confidence, reasoning, evidence}}, usage) — oversized
        templates are split into multiple calls and merged transparently.
        Side effect: stashes the section-snapshot INPUTS on
        ``self._snapshot_inputs`` for ``_maybe_verify``'s post-verify build.
        """
        entity_name = entity_type.name if hasattr(entity_type, "name") else "data"
        entity_description = entity_type.description if hasattr(entity_type, "description") else ""

        # One glue call renders both the real-article and marker prompts.
        prompt_name, prompt_version, system_prompt, user_prompt, section_instruction = (
            render_section_prompts(
                kind=kind,
                framework=framework,
                entity_name=entity_name,
                entity_description=entity_description,
                article_text=pdf_text,
                article_marker=ARTICLE_MARKDOWN_MARKER,
                memory_context=memory_context,
                general_instructions=general_instructions,
            )
        )

        output_models = build_output_models(entity_type, fields=fields_override)
        if not output_models:
            self.logger.info(
                "extraction_skipped_no_fields",
                trace_id=self.trace_id,
                entity_type_name=entity_name,
            )
            self._snapshot_inputs = None  # no LLM ran — nothing to snapshot
            return {}, LlmUsage()

        engine = self._engine
        llm_model = build_model(engine.provider, engine.model, api_key=self._llm_api_key)

        extracted_data: dict[str, Any] = {}
        usage = LlmUsage()
        for output_model in output_models:
            output, call_usage = await extract_structured(
                output_model=output_model,
                system_prompt=system_prompt,
                user_prompt=user_prompt,
                model=llm_model,
                prompt_name=prompt_name,
                prompt_version=prompt_version,
                validators=[evidence_is_plausible],
            )
            extracted_data.update(dump_extraction(output))
            usage = usage + call_usage

        # Snapshot INPUTS only — _maybe_verify builds the snapshot ONCE,
        # post-verify, with mode_executed/passes as typed params.
        self._snapshot_inputs = SectionSnapshotInputs(
            prompt_name=prompt_name,
            prompt_version=prompt_version,
            section_name=entity_name,
            system_prompt=system_prompt,
            section_instruction=section_instruction,
            # The fields actually sent to the LLM: the human-settled override
            # when the QA re-run filtered some out (#481), else the full set.
            fields=(
                fields_override
                if fields_override is not None
                else (getattr(entity_type, "fields", None) or [])
            ),
            llm_calls=len(output_models),
        )
        return extracted_data, usage

    async def _maybe_verify(
        self,
        run_id: UUID,
        entity_type_id: UUID,
        pdf_text: str,
        extracted_data: dict[str, Any],
        usage: LlmUsage,
    ) -> tuple[dict[str, str] | None, LlmUsage]:
        """Verify pass (mode check inside the glue) + the ONE post-verify
        section-snapshot build. The returned usage includes the verify
        tokens, so every run total the callers write is the summed one."""
        verdicts, usage, snapshot = await verify_and_snapshot(
            engine=self._engine,
            api_key=self._llm_api_key,
            key_scope=self._key_scope,
            ran_by_user_id=self.user_id,
            pdf_text=pdf_text,
            extracted_data=extracted_data,
            extract_usage=usage,
            inputs=self._snapshot_inputs,
            prompt_input_info=self._prompt_input_info,
            run_id=run_id,
            entity_type_id=entity_type_id,
            trace_id=self.trace_id,
            logger=self.logger,
        )
        if snapshot is not None:
            self._run_provenance = snapshot
        return verdicts, usage

    async def _create_suggestions(
        self,
        project_id: UUID,
        article_id: UUID,
        entity_type_id: UUID,
        parent_instance_id: UUID | None,
        extracted_data: dict[str, Any],
        run: ExtractionRun,
        verdicts: dict[str, str] | None = None,
    ) -> int:
        """Create extraction suggestions in database via repository.

        Auto-creates the instance when missing; links proposals to the run.
        As the single choke-point for AI proposals it also persists the
        per-section ``provenance`` snapshot (built post-verify by
        ``_maybe_verify``) keyed by ``entity_type_id``. ``verdicts`` are the
        Verified-mode per-field verdicts — ANNOTATION only, written as the
        ``verification`` sibling on found fields. Returns the number of
        created suggestions.
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

        # Verified-mode drift guard (panel A4): a verdict keyed outside the
        # field vocabulary would silently annotate nothing — be loud instead.
        for _vk in set(verdicts or ()) - set(field_map):
            self.logger.warning("verify_verdict_unmatched", trace_id=self.trace_id, field=_vk)

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

            # "No information found": a bare None or a structured not_found
            # abstention. Record it as a first-class proposal carrying the coded
            # no-information marker (built below) so the run's outcome is
            # traceable to the reviewer, instead of silently dropping the field.
            # ``ambiguous`` ("present but conflicting") is deliberately excluded
            # (ADR-0016 Phase 1): it is not "absent", so it stays a
            # needs-attention proposal with a value and no marker — still
            # blocking the finalize gate.
            is_no_info = value is None or (
                isinstance(value, dict) and value.get("status") == "not_found"
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
            proposed_value: dict[str, Any] = {"value": inner_value}
            if is_no_info:
                # A resolved "no information" disposition: the typed value stays
                # null and the coded ``absent_reason`` sibling marks it as an
                # affirmative "the source is silent" answer (ADR-0016), so the
                # coordinate counts as filled once a reviewer accepts it.
                proposed_value["absent_reason"] = AbsentReason.NO_INFORMATION.value
            elif verdicts and field_name in verdicts:
                # Verified mode: the verdict is ANNOTATION, never mutation
                # (§IX) — the ``absent_reason`` sibling-key precedent. Found
                # fields only; the glue never verifies a no-info proposal.
                proposed_value["verification"] = VerificationAnnotation(
                    verdict=verdicts[field_name]  # type: ignore[arg-type]
                ).model_dump()

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
            engine = self._engine
            _judge_model = build_model(engine.provider, engine.model, api_key=self._llm_api_key)
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

        # Single choke-point for per-section provenance: persist HOW this
        # section's suggestions were generated, keyed by entity_type_id, wherever
        # proposals are recorded — so no extraction path can silently omit it and
        # concurrent sections on one run don't clobber each other. The snapshot
        # (tokens + prompt composition + mode/passes) was built section-scoped,
        # post-verify, in _maybe_verify. Skipped when no LLM ran (None).
        if count and self._run_provenance is not None:
            await self._runs.merge_provenance_section(run.id, entity_type_id, self._run_provenance)

        return count

    async def run_from_request(
        self,
        payload: SectionExtractionRequest,
        engine: LlmTarget | None = None,
    ) -> SectionExtractionResult | BatchExtractionResult:
        """Dispatch a SectionExtractionRequest to the correct extraction method.

        Mirrors the 3-branch dispatch in the section_extraction endpoint so
        the same logic can be reused from a Celery task without touching the
        HTTP layer.  The caller is responsible for committing (or rolling back)
        the session — this method does not commit.

        ``engine`` is the effective candidate: the worker passes the one it
        already resolved (pinned-run pair, or the project engine) so the key
        it looked up matches; when ``None`` the project engine is resolved
        here (C1b — raises ``EngineRetiredError`` for a retired stored pair).

        Branch priority (first match wins):
        1. ``entity_type_id`` present → single-section path via
           ``extract_section``. Handles both standalone and existing-run
           (``run_id`` set) callers; the service routes internally.
        2. ``parent_instance_id`` present (no ``entity_type_id``) →
           ``extract_all_sections`` batch sweep of child sections under that
           model instance. Checked BEFORE the ``run_id`` branch so a batch
           request that now carries the session ``run_id`` (to REUSE it, not
           fork a shadow run) still routes here — the full-run sweep below has
           no ``parent_instance_id``.
        3. ``run_id`` set (no ``entity_type_id``/``parent_instance_id``) →
           ``extract_for_run`` iterates every top-level entity_type of that
           run's template (QA / full-run surface).
        """
        # C1a: server-owned, never client-chosen. C1b: the candidate is the
        # project's resolved engine, not a ``settings`` re-read.
        if engine is None:
            engine = await resolve_project_engine(self.db, payload.project_id)

        if payload.entity_type_id is not None:
            return await self.extract_section(
                project_id=payload.project_id,
                article_id=payload.article_id,
                template_id=payload.template_id,
                entity_type_id=payload.entity_type_id,
                parent_instance_id=payload.parent_instance_id,
                engine=engine,
                run_id=payload.run_id,
            )

        if payload.parent_instance_id is not None:
            return await self.extract_all_sections(
                project_id=payload.project_id,
                article_id=payload.article_id,
                template_id=payload.template_id,
                parent_instance_id=payload.parent_instance_id,
                section_ids=payload.section_ids,
                pdf_text=payload.pdf_text,
                engine=engine,
                run_id=payload.run_id,
            )

        if payload.run_id is not None:
            return await self.extract_for_run(
                run_id=payload.run_id,
                skip_fields_with_human_proposals=payload.skip_fields_with_human_proposals,
                auto_advance_to_review=payload.auto_advance_to_review,
                engine=engine,
            )

        # The request validator requires one of entity_type_id / parent_instance_id
        # / run_id, so this is unreachable — kept as a defensive guard.
        raise ValueError(
            "SectionExtractionRequest matched no dispatch branch "
            "(need entity_type_id, parent_instance_id, or run_id)"
        )
