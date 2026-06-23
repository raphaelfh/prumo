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
from app.llm.prompts import model_identification
from app.llm.provider import build_model
from app.models.extraction import (
    ExtractionEntityRole,
    ExtractionInstance,
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
from app.services.extraction_prompt_input import build_prompt_input
from app.services.pdf_processor import PDFProcessor
from app.services.run_lifecycle_service import RunLifecycleService


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
        openai_api_key: str | None = None,
    ):
        """
        Initialize the service.

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
        self._llm_api_key = openai_api_key

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
        model: str = settings.LLM_DEFAULT_MODEL,
    ) -> ModelExtractionResult:
        """
        Extract prediction models from an article.

        Args:
            project_id: Project ID.
            article_id: Article ID.
            template_id: Template ID.
            model: OpenAI model to use.

        Returns:
            ModelExtractionResult with extraction_run_id, models and tokens.
        """
        start_time = perf_counter()
        phase_durations_ms: dict[str, float] = {}

        # 1. Create extraction_run via the unified lifecycle service so the new
        # NOT NULL columns (version_id, hitl_config_snapshot) and the kind
        # discriminator are populated correctly. Then advance pending → extract.
        run = await self._lifecycle.create_run(
            project_id=project_id,
            article_id=article_id,
            project_template_id=template_id,
            user_id=UUID(self.user_id),
            parameters={
                "model": model,
                "extraction_type": "model_identification",
            },
        )
        run = await self._lifecycle.advance_stage(
            run_id=run.id,
            target_stage=ExtractionRunStage.EXTRACT,
            user_id=UUID(self.user_id),
        )

        await self._runs.start_run(run.id)

        self.logger.info(
            "model_extraction_start",
            trace_id=self.trace_id,
            run_id=str(run.id),
            article_id=str(article_id),
            operation_id=str(run.id),
        )

        try:
            # 2-3. Assemble budgeted block-markdown prompt input (pypdf fallback inside).
            phase_start = perf_counter()
            pdf_text, _, _ = await build_prompt_input(
                db=self.db,
                article_files=self._article_files,
                pdf_processor=self.pdf_processor,
                get_pdf=self._get_pdf,
                article_id=article_id,
                model=model,
                logger=self.logger,
            )
            phase_durations_ms["assemble_prompt"] = (perf_counter() - phase_start) * 1000

            # 4. Fetch template and entity types
            phase_start = perf_counter()
            template = await self._get_template(template_id)
            phase_durations_ms["fetch_template"] = (perf_counter() - phase_start) * 1000

            # 5. Identificar modelos usando LLM (com tracking de tokens)
            phase_start = perf_counter()
            models, llm_usage = await self._identify_models(pdf_text, template, model)
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

            # 7. Completar run with resultados
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
            # Issue #21: a DB-level error during instance creation aborts the
            # session, so roll back before marking the run failed (otherwise
            # fail_run hits InFailedSQLTransactionError and leaves an orphaned
            # status='running' row). Shared with SectionExtractionService.
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

    async def _get_pdf(self, article_id: UUID) -> bytes:
        """Fetch and download article PDF via Storage Adapter."""
        pdf_file = await self._article_files.get_latest_pdf(article_id)

        if not pdf_file:
            raise FileNotFoundError(f"PDF not found for article {article_id}")

        return await self.storage.download("articles", pdf_file.storage_key)

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
        template: Any,
        model: str,
    ) -> tuple[list[dict[str, Any]], LlmUsage]:
        """
        Use LLM to identify models in PDF text.

        Returns:
            Tuple of model list and token usage.
        """
        # Find the model container entity type by structural role —
        # replaces the legacy ``name in ("prediction_models", "model", ...)``
        # lookup that silently masked typos and template renames.
        entity_types = template.entity_types if hasattr(template, "entity_types") else []
        model_entity = next(
            (et for et in entity_types if et.role == ExtractionEntityRole.MODEL_CONTAINER.value),
            None,
        )

        if not model_entity:
            self.logger.warning(
                "no_model_container_entity_type",
                trace_id=self.trace_id,
                template_id=str(template.id),
                available_entity_types=[{"name": et.name, "role": et.role} for et in entity_types]
                if entity_types
                else [],
            )

        container_label = model_entity.label if model_entity else "prediction models"
        output, usage = await extract_structured(
            output_model=model_identification.ModelIdentificationOutput,
            system_prompt=model_identification.SYSTEM_PROMPT,
            user_prompt=model_identification.render(
                container_label=container_label,
                article_text=pdf_text,
            ),
            model=build_model(settings.LLM_PROVIDER, model, api_key=self._llm_api_key),
            prompt_name=model_identification.NAME,
            prompt_version=model_identification.VERSION,
        )
        models = [m.model_dump() for m in output.models]

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

        for idx, model_data in enumerate(models):
            # 1. Criar instance do modelo (parent). The label comes from
            # the LLM's neutral "name" field — see
            # ``app/llm/prompts/model_identification.py`` for the contract.
            model_instance = ExtractionInstance(
                project_id=project_id,
                article_id=article_id,
                template_id=template_id,
                entity_type_id=UUID(entity_type_id),
                label=model_data.get("name") or f"Model {idx + 1}",
                sort_order=idx,
                metadata_={
                    "ai_extracted": True,
                    "ai_run_id": str(run.id),
                    "raw_extraction": model_data,
                },
                created_by=UUID(self.user_id),
            )

            # Issue #21: do NOT catch-and-continue here. `create()` calls
            # `session.flush()` and any DB error puts the asyncpg connection
            # into a failed-transaction state — every subsequent SQL on the
            # same session then raises InFailedSQLTransactionError. Letting
            # the exception propagate gives the outer handler a chance to
            # rollback() and then mark the run as failed on a clean session.
            saved_instance = await self._instances.create(model_instance)
            created.append(saved_instance)

            self.logger.info(
                "model_instance_created",
                trace_id=self.trace_id,
                instance_id=str(saved_instance.id),
                label=model_instance.label,
            )

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

    def to_dict(self, result: ModelExtractionResult) -> dict[str, Any]:
        """
        Converte resultado for dict compativel with resposta do endpoint.

        Mantem formato compativel with a Edge Function original.
        """
        return {
            "extractionRunId": result.extraction_run_id,
            "modelsCreated": result.models_created,
            "totalModels": result.total_models,
            "childInstancesCreated": result.child_instances_created,
            "metadata": {
                "duration": int(result.duration_ms),
                "modelsFound": result.total_models,
                "tokensPrompt": result.tokens_prompt,
                "tokensCompletion": result.tokens_completion,
                "tokensTotal": result.tokens_total,
            },
        }
