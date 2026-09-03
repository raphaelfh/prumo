"""
Model Extraction Service.

Service for automatic extraction of article prediction models.
Implements:
- Model identification via LLM
- Automatic hierarchy creation (model + child sections)
- extraction_runs and token tracking
- Repository Pattern with SQLAlchemy
"""

from dataclasses import dataclass
from time import perf_counter
from typing import Any
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.logging import LoggerMixin
from app.infrastructure.storage import StorageAdapter
from app.llm.extractor import LlmUsage, extract_structured
from app.llm.prompts import entry_identification
from app.llm.provider import build_model
from app.models.extraction import (
    DEFAULT_ENTRY_LABEL,
    ExtractionEntityRole,
    ExtractionInstance,
    ExtractionRun,
    ExtractionRunStage,
)
from app.repositories import (
    ArticleFileRepository,
    ExtractionEntityTypeRepository,
    ExtractionInstanceRepository,
    ExtractionRunRepository,
    ExtractionTemplateRepository,
    GlobalTemplateRepository,
)
from app.schemas.extraction_run import RunViewEntityType
from app.schemas.llm_target import LlmTarget
from app.services.engine_credentials import EngineCredentials
from app.services.entity_key import (
    MissingEntityKeyError,
    existing_keys,
    key_field_of,
    resolve_instance,
)
from app.services.extraction_prompt_input import build_prompt_input
from app.services.extraction_snapshot import entity_types_for_version
from app.services.run_engine_freeze import freeze_run_engine
from app.services.run_lifecycle_service import RunLifecycleService
from app.services.run_prompt_context import resolve_run_prompt_context


@dataclass
class ModelExtractionResult:
    """Model extraction result."""

    extraction_run_id: str
    models_created: list[dict[str, Any]]
    total_models: int
    child_instances_created: int
    tokens_prompt: int
    tokens_completion: int
    tokens_total: int
    duration_ms: float


class ModelExtractionService(LoggerMixin):
    """
    Service for prediction model extraction.

    Identifies and creates model instances automatically.
    Migrated to use SQLAlchemy via Repository Pattern.
    Supports BYOK (Bring Your Own Key) with fallback to global key.
    """

    def __init__(
        self,
        db: AsyncSession,
        user_id: str,
        storage: StorageAdapter,
        trace_id: str,
        llm_credentials: EngineCredentials | None = None,
    ):
        """
        Initialize the service.

        Args:
            db: Async SQLAlchemy session.
            user_id: Authenticated user ID.
            storage: Storage adapter.
            trace_id: Trace ID.
            llm_credentials: Key + scope + base_url + endpoint identity for
                the engine passed to ``extract``, resolved by the caller
                (``resolve_engine_credentials``). They travel together: an
                endpoint engine has no host without its ``base_url``.
                ``None`` means no credentials (global-key fallback).
        """
        self.db = db
        self.user_id = user_id
        self.storage = storage
        self.trace_id = trace_id
        self._credentials = llm_credentials or EngineCredentials(None, None, None, None)
        # Engine for every LLM call: the env-default candidate until the
        # caller passes its resolved one into ``extract`` (C1b). Constructed
        # at call time — never an import-time default-parameter value.
        self._engine = LlmTarget(provider=settings.LLM_PROVIDER, model=settings.LLM_DEFAULT_MODEL)

        # Repositories
        self._article_files = ArticleFileRepository(db)
        self._templates = ExtractionTemplateRepository(db)
        self._global_templates = GlobalTemplateRepository(db)
        self._entity_types = ExtractionEntityTypeRepository(db)
        self._instances = ExtractionInstanceRepository(db)
        self._runs = ExtractionRunRepository(db)
        # Lifecycle service: owns Run creation + stage transitions and ensures
        # version_id + hitl_config_snapshot are populated correctly.
        self._lifecycle = RunLifecycleService(db)

    async def extract(
        self,
        project_id: UUID,
        article_id: UUID,
        template_id: UUID,
        engine: LlmTarget | None = None,
        run_id: UUID | None = None,
        *,
        repin: bool = False,
    ) -> ModelExtractionResult:
        """
        Extract prediction models from an article.

        Args:
            project_id: Project ID.
            article_id: Article ID.
            template_id: Template ID.
            engine: The caller's resolved engine (C1b — endpoint/worker
                resolve the project engine and the matching key together).
                ``None`` falls back to the env-default candidate.
            repin: this call is a HUMAN kickoff, so it overwrites the
                resolved run's pin with ``engine`` (see ``freeze_engine``).
                The endpoint always passes True — it executes in-request and
                has no retry path into it.
            run_id: Existing run to append the model instances/proposals to.
                When provided (the extraction surface, via the HITL session),
                the run is REUSED instead of creating a fresh one — so the
                session's run stays the single source of truth and a reviewer's
                saved decisions are never orphaned onto a shadow run. Mirrors
                ``SectionExtractionService.extract_section``'s ``run_id`` reuse.

        Returns:
            ModelExtractionResult with extraction_run_id, models and tokens.
        """
        start_time = perf_counter()
        phase_durations_ms: dict[str, float] = {}
        if engine is not None:
            self._engine = engine
        model = self._engine.model

        # 1. Resolve the run. When ``run_id`` is passed (extraction surface),
        # REUSE that session-owned run and leave its lifecycle to the HITL
        # session — creating a fresh run here would fork a parallel run that
        # shadows the reviewer's decisions (the orphaning bug). Without a
        # ``run_id`` the resolve-or-create gate applies: the coordinate's live
        # run is reused when one exists (one-live-run invariant, index 0045 —
        # an unconditional create would 23505), and only a truly fresh
        # coordinate creates + owns its run. ``manage_lifecycle`` therefore
        # follows CREATION, not the run_id parameter: reused runs are never
        # started/completed/failed here. Mirrors ``extract_section``.
        if run_id is not None:
            existing_run = await self.db.get(ExtractionRun, run_id)
            if existing_run is None:
                raise ValueError(f"Run {run_id} not found")
            if existing_run.stage != ExtractionRunStage.EXTRACT.value:
                raise ValueError(
                    f"Run {run_id} stage is {existing_run.stage}; model extraction requires EXTRACT"
                )
            if existing_run.template_id != template_id:
                # B-2 splits identification (run-PINNED tree) from instance
                # creation (caller's template_id): a mismatched pair would
                # identify against one template and materialize into another.
                raise ValueError(
                    f"Run {run_id} belongs to template {existing_run.template_id}, "
                    f"not {template_id}"
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
                    "model": model,
                    "extraction_type": "model_identification",
                },
            )
            if manage_lifecycle:
                await self._runs.start_run(run.id)

        # Pin the run this call actually resolved — the ``run_id=None``
        # branch above reuses the coordinate's LIVE run, which the caller
        # could not name, and whose stale pin otherwise left the service
        # running one engine while ``provenance.engine`` named another.
        # Under ``repin`` the freeze returns ``engine`` unchanged, so the
        # re-read below is an identity and the credentials still fit.
        self._engine = await freeze_run_engine(self._runs, run.id, self._engine, repin=repin)
        model = self._engine.model

        self.logger.info(
            "model_extraction_start",
            trace_id=self.trace_id,
            run_id=str(run.id),
            article_id=str(article_id),
            operation_id=str(run.id),
        )

        try:
            # 2-3. Assemble budgeted block-markdown prompt input (on-demand parse inside).
            phase_start = perf_counter()
            pdf_text, _ = await build_prompt_input(
                db=self.db,
                article_files=self._article_files,
                storage=self.storage,
                article_id=article_id,
                model=model,
                logger=self.logger,
                user_id=self.user_id,
                trace_id=self.trace_id,
            )
            phase_durations_ms["assemble_prompt"] = (perf_counter() - phase_start) * 1000

            # 4. The template must exist (the prompt itself reads the run-PINNED
            # container, not the live template).
            phase_start = perf_counter()
            await self._get_template(template_id)
            phase_durations_ms["fetch_template"] = (perf_counter() - phase_start) * 1000

            # 5. Identify models with the LLM (token usage tracked)
            phase_start = perf_counter()
            models, llm_usage = await self._identify_models(pdf_text, model, run)
            phase_durations_ms["identify_models_llm"] = (perf_counter() - phase_start) * 1000

            # 6. Create instances in DB (model + children)
            phase_start = perf_counter()
            created_models, total_children = await self._create_model_instances(
                project_id=project_id,
                article_id=article_id,
                template_id=template_id,
                models=models,
                run=run,
            )
            phase_durations_ms["create_model_instances"] = (perf_counter() - phase_start) * 1000

            # The run is already in EXTRACT, where the form UI writes
            # ReviewerDecisions on top of the instances we just created.
            # The collapsed lifecycle has no separate review stage to advance to.

            duration = (perf_counter() - start_time) * 1000

            # 7. Complete the run with results — standalone path only. In the
            # session-run (reuse) path the HITL session owns the lifecycle, so
            # completing here would close the run after model extraction and
            # break subsequent AI clicks + form editing on the same run. The
            # model instances/proposals were already persisted above.
            if manage_lifecycle:
                phase_start = perf_counter()
                await self._runs.complete_run(
                    run_id=run.id,
                    results={
                        "models_count": len(created_models),
                        "children_count": total_children,
                        "models_identified": len(models),
                        "tokens_prompt": llm_usage.prompt_tokens,
                        "tokens_completion": llm_usage.completion_tokens,
                        "tokens_total": llm_usage.total_tokens,
                        "duration_ms": duration,
                        "phase_durations_ms": phase_durations_ms,
                    },
                )
                phase_durations_ms["complete_run"] = (perf_counter() - phase_start) * 1000

            self.logger.info(
                "model_extraction_complete",
                trace_id=self.trace_id,
                run_id=str(run.id),
                operation_id=str(run.id),
                models_count=len(created_models),
                children_count=total_children,
                tokens_total=llm_usage.total_tokens,
                duration_ms=duration,
                phase_durations_ms=phase_durations_ms,
            )

            # Formatar modelos criados in the formato esperado pelo frontend (camelCase)
            formatted_models = [
                {
                    "instanceId": str(model_instance.id),
                    "modelName": model_instance.label or "Unknown Model",
                    "modellingMethod": (model_instance.metadata_ or {}).get("model_type"),
                }
                for model_instance in created_models
            ]

            return ModelExtractionResult(
                extraction_run_id=str(run.id),
                models_created=formatted_models,
                total_models=len(formatted_models),
                child_instances_created=total_children,
                tokens_prompt=llm_usage.prompt_tokens,
                tokens_completion=llm_usage.completion_tokens,
                tokens_total=llm_usage.total_tokens,
                duration_ms=duration,
            )

        except Exception as e:
            # Only mark the run failed in the standalone path. In the session-run
            # (reuse) path the HITL session owns the lifecycle — failing it here
            # would break subsequent extractions + form editing on the same run;
            # the error propagates for the caller (session) to handle.
            # Issue #21: a DB-level error during instance creation aborts the
            # session, so roll back before marking the run failed (otherwise
            # fail_run hits InFailedSQLTransactionError and leaves an orphaned
            # status='running' row). Shared with SectionExtractionService.
            if manage_lifecycle:
                await self._runs.rollback_and_fail(
                    run.id,
                    str(e),
                    logger=self.logger,
                    trace_id=self.trace_id,
                    log_prefix="model_extraction",
                )
            self.logger.error(
                "model_extraction_failed",
                trace_id=self.trace_id,
                run_id=str(run.id),
                operation_id=str(run.id),
                error=str(e),
                phase_durations_ms=phase_durations_ms,
            )
            raise

    async def _get_template(self, template_id: UUID) -> Any:
        """
        Fetch template with entity types.

        Tries project_extraction_templates first (project template),
        then extraction_templates_global (global template).
        """
        # First try project template
        template = await self._templates.get_with_entity_types(template_id)

        if template:
            return template

        # If not found, try global template
        template = await self._global_templates.get_by_id(template_id)

        if template:
            return template

        raise ValueError(f"Template not found: {template_id}")

    async def _identify_models(
        self,
        pdf_text: str,
        model: str,
        run: Any,
    ) -> tuple[list[dict[str, Any]], LlmUsage]:
        """
        Use LLM to identify models in PDF text.

        The prompt is parameterized by the model container as the run is
        PINNED to it (B-2): label, entry noun, key field and description
        come from the snapshot, never live rows (``_pinned_container`` falls
        back to the live row only when the pin carries no container). A
        template without a container has nothing to identify into, so no
        LLM call is spent; a keyless container refuses here, before the call.

        Returns:
            Tuple of model list and token usage.
        """
        container = await self._pinned_container(run)
        if container is None:
            self.logger.warning(
                "no_model_container_entity_type",
                trace_id=self.trace_id,
                template_id=str(run.template_id),
            )
            return [], LlmUsage()
        key_field = key_field_of(container)
        if key_field is None:
            # A container always repeats; a pin that says otherwise is as
            # keyless as one with no key field.
            raise MissingEntityKeyError(container.id, container.label or container.name)
        entry_label = container.entry_label or DEFAULT_ENTRY_LABEL
        prompt_context = await resolve_run_prompt_context(self.db, run)

        # Re-run grounding: show the model what this article already has, so
        # it returns the existing name instead of a fresh wording for the
        # same entity. The identity key is free text and would otherwise
        # drift between runs, and matching on a drifted key recreates the
        # very duplicate it exists to prevent. Reads instances only — no
        # reviewer-attributable row is touched.
        already_identified = sorted(
            (
                await existing_keys(
                    self.db,
                    article_id=run.article_id,
                    entity_type_id=container.id,
                )
            ).keys()
        )

        output, usage = await extract_structured(
            output_model=entry_identification.EntryIdentificationOutput,
            system_prompt=entry_identification.system_prompt(entry_label),
            user_prompt=entry_identification.render(
                group_label=container.label,
                entry_label=entry_label,
                key_label=key_field.label,
                article_text=pdf_text,
                instruction=container.description,
                allowed_values=key_field.allowed_values,
                general_instructions=prompt_context.general_instructions,
                review_context=prompt_context.review_context,
                existing_keys=already_identified,
            ),
            model=build_model(
                self._engine.provider,
                model,
                api_key=self._credentials.api_key,
                base_url=self._credentials.base_url,
            ),
            prompt_name=entry_identification.NAME,
            prompt_version=entry_identification.VERSION,
        )
        models = [entry.model_dump() for entry in output.entries]

        self.logger.info(
            "models_identified",
            trace_id=self.trace_id,
            models_count=len(models),
            tokens_total=usage.total_tokens,
        )

        return models, usage

    async def _get_model_container_entity_type_id(
        self,
        template_id: UUID,
    ) -> str | None:
        """
        Fetch the entity_type_id of the template's model container.

        Looks up by structural ``role='model_container'`` (the schema
        guarantees at most one per template). Falls back to the global
        catalogue if the project clone lookup misses, so callers can pass
        either id flavour without branching.

        Returns:
            entity_type_id or None if the template has no model container.
        """
        entity_type = await self._entity_types.get_by_role(
            ExtractionEntityRole.MODEL_CONTAINER.value,
            template_id,
            is_project_template=True,
        )
        if entity_type:
            return str(entity_type.id)

        entity_type = await self._entity_types.get_by_role(
            ExtractionEntityRole.MODEL_CONTAINER.value,
            template_id,
            is_project_template=False,
        )
        if entity_type:
            return str(entity_type.id)

        return None

    async def _pinned_container(self, run: Any) -> RunViewEntityType | None:
        """The model container as the run is PINNED to it — the one shape the
        identification prompt, the entry noun (B-8) and the entry key (0059)
        are all read from, so a key moved in an unpublished draft gates
        nothing until Publish re-pins. Falls back to the live row when the
        pinned tree carries no container (a narrow pre-0026 snapshot, or a
        re-pin race). ``None`` when the template has no container at all.
        """
        pinned_tree = await entity_types_for_version(
            self.db, version_id=run.version_id, template_id=run.template_id
        )
        container = next(
            (et for et in pinned_tree if et.role == ExtractionEntityRole.MODEL_CONTAINER.value),
            None,
        )
        if container is not None:
            return container
        live_container_id = await self._get_model_container_entity_type_id(run.template_id)
        if live_container_id is None:
            return None
        live = await self._entity_types.get_with_fields(live_container_id)
        return RunViewEntityType.model_validate(live) if live is not None else None

    async def _get_child_entity_types(
        self,
        parent_entity_type_id: str,
        _template_id: UUID,
    ) -> list[Any]:
        """
        Fetch child entity types of a parent entity type.

        Returns only those with cardinality='one' (auto-creation).
        """
        return await self._entity_types.get_children(
            parent_entity_type_id,
            cardinality="one",
        )

    async def _create_child_instances(
        self,
        parent_instance_id: str,
        parent_entity_type_id: str,
        project_id: UUID,
        article_id: UUID,
        template_id: UUID,
        run_id: UUID,
    ) -> int:
        """
        Create child instances for a model.

        For each entity_type with parent_entity_type_id pointing to
        prediction_models and cardinality='one', create one instance.

        Returns:
            Number of child instances created.
        """
        child_entity_types = await self._get_child_entity_types(parent_entity_type_id, template_id)

        created_count = 0

        for child_et in child_entity_types:
            child_instance = ExtractionInstance(
                project_id=project_id,
                article_id=article_id,
                template_id=template_id,
                entity_type_id=child_et.id,
                parent_instance_id=UUID(parent_instance_id),
                label=child_et.label,
                sort_order=child_et.sort_order or 0,
                metadata_={
                    "auto_created": True,
                    "parent_instance_id": parent_instance_id,
                    "ai_run_id": str(run_id),
                },
                created_by=UUID(self.user_id),
            )

            # Issue #21: same reasoning as `_create_model_instances`. A failed
            # `create()` aborts the underlying transaction; catching it here
            # would only make every subsequent statement on the same session
            # raise InFailedSQLTransactionError, including the lifecycle and
            # fail_run calls in the outer handler. Let it bubble up.
            await self._instances.create(child_instance)
            created_count += 1

            self.logger.debug(
                "child_instance_created",
                trace_id=self.trace_id,
                parent_id=parent_instance_id,
                child_id=str(child_instance.id),
                entity_type=child_et.name,
            )

        return created_count

    async def _create_model_instances(
        self,
        project_id: UUID,
        article_id: UUID,
        template_id: UUID,
        models: list[dict[str, Any]],
        run: Any,
    ) -> tuple[list[ExtractionInstance], int]:
        """
        Create model instances in DB with full hierarchy.

        For each identified model:
        1. Create the model instance (parent)
        2. Automatically create child instances (sections with cardinality='one')

        Returns:
            Tuple (list of created models, total children created).
        """
        # Fetch entity_type_id of the template's model container (role-keyed).
        entity_type_id = await self._get_model_container_entity_type_id(template_id)

        if not entity_type_id:
            self.logger.warning(
                "no_model_container_entity_type",
                trace_id=self.trace_id,
                template_id=str(template_id),
            )
            return [], 0

        created: list[ExtractionInstance] = []
        total_children_created = 0
        container = await self._pinned_container(run)
        if container is None:
            raise ValueError(f"Model container not found: {entity_type_id}")
        # B-8: unnamed models are labelled with the container's entry noun.
        label_stem = (container.entry_label or DEFAULT_ENTRY_LABEL).title()

        # Refuse rather than duplicate when the container declares no
        # identity: without a key this loop cannot tell a new model from one
        # a previous run already extracted, which is the bug it exists to
        # fix. Read off the PINNED tree, raised before any write so the run
        # fails clean.
        key_field_of(container)

        for idx, model_data in enumerate(models):
            # 1. Reuse or create the model instance (parent). The label comes
            # from the LLM's neutral "name" field — see
            # ``app/llm/prompts/entry_identification.py`` for the contract —
            # and that same name is the container's identity. A match reuses
            # the row so reviewer decisions anchored on it stay attached; the
            # per-field guard (``skip_fields_with_human_proposals``) decides
            # what happens to its values, and its children already exist.
            # Issue #21: no catch-and-continue around the write — a DB error
            # leaves the asyncpg connection in a failed transaction, so it
            # must propagate to the outer handler's rollback + fail_run.
            model_label = model_data.get("name") or f"{label_stem} {idx + 1}"
            saved_instance, is_new = await resolve_instance(
                self.db,
                project_id=project_id,
                article_id=article_id,
                template_id=template_id,
                entity_type_id=UUID(entity_type_id),
                parent_instance_id=None,
                key_value=model_label,
                sort_order=idx,
                created_by=UUID(self.user_id),
                metadata={
                    "ai_extracted": True,
                    "ai_run_id": str(run.id),
                    "raw_extraction": model_data,
                },
            )
            created.append(saved_instance)
            self.logger.info(
                "model_instance_created" if is_new else "model_instance_reused",
                trace_id=self.trace_id,
                instance_id=str(saved_instance.id),
                label=model_label,
            )
            if not is_new:
                continue

            # 2. Criar child instances for este modelo
            children_count = await self._create_child_instances(
                parent_instance_id=str(saved_instance.id),
                parent_entity_type_id=entity_type_id,
                project_id=project_id,
                article_id=article_id,
                template_id=template_id,
                run_id=run.id,
            )

            total_children_created += children_count

            self.logger.info(
                "model_hierarchy_created",
                trace_id=self.trace_id,
                model_id=str(saved_instance.id),
                children_created=children_count,
            )

        self.logger.info(
            "all_hierarchies_created",
            trace_id=self.trace_id,
            models_count=len(created),
            total_children_count=total_children_created,
        )

        return created, total_children_created
