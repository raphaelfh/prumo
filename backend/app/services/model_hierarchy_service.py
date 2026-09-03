"""Service to create extraction model hierarchy in one transaction."""

from dataclasses import dataclass
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.article import Article
from app.models.extraction import (
    ExtractionCardinality,
    ExtractionEntityRole,
    ExtractionEntityType,
    ExtractionField,
    ExtractionInstance,
    ExtractionRun,
    ExtractionRunStage,
    ProjectExtractionTemplate,
)
from app.models.extraction_versioning import TemplateKind
from app.repositories.extraction_repository import ExtractionEntityTypeRepository
from app.services.entity_key import stamp
from app.services.extraction_review_service import (
    ExtractionReviewService,
    InvalidDecisionError,
)


@dataclass
class ModelHierarchyChild:
    """Payload for a child instance created with the parent model."""

    id: UUID
    entity_type_id: UUID
    parent_instance_id: UUID
    label: str


@dataclass
class ModelHierarchyResult:
    """Result envelope returned to the API layer."""

    model_id: UUID
    model_label: str
    child_instances: list[ModelHierarchyChild]
    proposal_run_id: UUID | None


class ModelHierarchyService:
    """Creates `prediction_models` + one-cardinality child sections."""

    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def create_model_hierarchy(
        self,
        *,
        project_id: UUID,
        article_id: UUID,
        template_id: UUID,
        user_id: UUID,
        model_name: str,
        modelling_method: str | None = None,
    ) -> ModelHierarchyResult:
        model_label = model_name.strip()
        if not model_label:
            raise ValueError("modelName is required")

        template = await self.db.get(ProjectExtractionTemplate, template_id)
        if template is None or template.project_id != project_id:
            raise ValueError("Template not found in project")
        if template.kind != TemplateKind.EXTRACTION.value:
            raise ValueError("Template kind must be extraction")

        article = await self.db.get(Article, article_id)
        if article is None or article.project_id != project_id:
            raise ValueError("Article not found in project")

        model_entity_type = await self._prediction_models_entity_type(template_id)
        if model_entity_type is None:
            raise ValueError("prediction_models entity type not found in template")

        child_entity_types = await self._model_singleton_children(model_entity_type.id)

        unique_label = await self._ensure_unique_model_label(
            article_id=article_id,
            entity_type_id=model_entity_type.id,
            base_label=model_label,
        )
        sort_order = await self._next_sort_order(
            article_id=article_id,
            entity_type_id=model_entity_type.id,
            parent_instance_id=None,
        )

        parent = ExtractionInstance(
            project_id=project_id,
            article_id=article_id,
            template_id=template_id,
            entity_type_id=model_entity_type.id,
            parent_instance_id=None,
            label=unique_label,
            sort_order=sort_order,
            # The manual entry carries the same materialized identity an
            # AI-created one does (identity spec §5.1.1): the name IS the
            # key, so an AI re-run that finds this model reuses this row.
            metadata_=stamp({"created_via": "manual"}, unique_label),
            created_by=user_id,
        )
        self.db.add(parent)
        await self.db.flush()

        children: list[ExtractionInstance] = []
        for entity_type in child_entity_types:
            children.append(
                ExtractionInstance(
                    project_id=project_id,
                    article_id=article_id,
                    template_id=template_id,
                    entity_type_id=entity_type.id,
                    parent_instance_id=parent.id,
                    label=f"{parent.label} - {entity_type.label} 1",
                    sort_order=0,
                    metadata_={},
                    created_by=user_id,
                )
            )
        if children:
            self.db.add_all(children)
            await self.db.flush()

        proposal_run_id = await self._record_initial_field_values(
            project_id=project_id,
            article_id=article_id,
            template_id=template_id,
            model_entity_type_id=model_entity_type.id,
            model_instance_id=parent.id,
            user_id=user_id,
            # parent.label, not the raw input: the label may have been
            # uniquified ("Cox Model (2)") and the append-only decision
            # value must match every visible surface.
            values={
                "model_name": parent.label,
                "modelling_method": modelling_method,
            },
        )

        return ModelHierarchyResult(
            model_id=parent.id,
            model_label=parent.label,
            child_instances=[
                ModelHierarchyChild(
                    id=child.id,
                    entity_type_id=child.entity_type_id,
                    parent_instance_id=parent.id,
                    label=child.label,
                )
                for child in children
            ],
            proposal_run_id=proposal_run_id,
        )

    async def _prediction_models_entity_type(
        self, template_id: UUID
    ) -> ExtractionEntityType | None:
        # Migration 0016 promoted the "prediction_models" magic name to the
        # ``extraction_entity_role`` enum; the partial unique index guarantees
        # at most one MODEL_CONTAINER per template.
        return await ExtractionEntityTypeRepository(self.db).get_by_role(
            role=ExtractionEntityRole.MODEL_CONTAINER.value,
            template_id=template_id,
            is_project_template=True,
        )

    async def _model_singleton_children(
        self, parent_entity_type_id: UUID
    ) -> list[ExtractionEntityType]:
        stmt = (
            select(ExtractionEntityType)
            .where(
                ExtractionEntityType.parent_entity_type_id == parent_entity_type_id,
                ExtractionEntityType.cardinality == ExtractionCardinality.ONE.value,
            )
            .order_by(ExtractionEntityType.sort_order.asc())
        )
        return list((await self.db.execute(stmt)).scalars().all())

    async def _next_sort_order(
        self,
        *,
        article_id: UUID,
        entity_type_id: UUID,
        parent_instance_id: UUID | None,
    ) -> int:
        stmt = select(func.count(ExtractionInstance.id)).where(
            ExtractionInstance.article_id == article_id,
            ExtractionInstance.entity_type_id == entity_type_id,
            ExtractionInstance.parent_instance_id.is_(parent_instance_id),
        )
        return int((await self.db.execute(stmt)).scalar_one() or 0)

    async def _ensure_unique_model_label(
        self,
        *,
        article_id: UUID,
        entity_type_id: UUID,
        base_label: str,
    ) -> str:
        candidate = base_label
        attempt = 1
        while attempt <= 10:
            stmt = (
                select(ExtractionInstance.id)
                .where(
                    ExtractionInstance.article_id == article_id,
                    ExtractionInstance.entity_type_id == entity_type_id,
                    ExtractionInstance.label == candidate,
                )
                .limit(1)
            )
            exists = (await self.db.execute(stmt)).scalar_one_or_none()
            if exists is None:
                return candidate
            attempt += 1
            candidate = f"{base_label} ({attempt})"
        raise ValueError("Could not derive a unique model label after multiple attempts")

    async def _record_initial_field_values(
        self,
        *,
        project_id: UUID,
        article_id: UUID,
        template_id: UUID,
        model_entity_type_id: UUID,
        model_instance_id: UUID,
        user_id: UUID,
        values: dict[str, str | None],
    ) -> UUID | None:
        """Record the dialog-provided values as per-user ReviewerDecisions.

        ``values`` maps container field *names* to raw strings; empty/None
        entries and names the template does not carry are skipped. Returns
        the live extract-stage run id when at least one decision landed,
        ``None`` otherwise (no run open, nothing to record, or the run
        advanced out of extract mid-flight).
        """
        to_record = {name: value for name, value in values.items() if value}

        field_stmt = select(ExtractionField).where(
            ExtractionField.entity_type_id == model_entity_type_id,
            ExtractionField.name.in_(to_record.keys()),
        )
        fields = list((await self.db.execute(field_stmt)).scalars().all())
        if not fields:
            return None

        run_stmt = (
            select(ExtractionRun)
            .where(
                ExtractionRun.project_id == project_id,
                ExtractionRun.article_id == article_id,
                ExtractionRun.template_id == template_id,
                ExtractionRun.kind == TemplateKind.EXTRACTION.value,
                ExtractionRun.stage == ExtractionRunStage.EXTRACT.value,
            )
            .order_by(ExtractionRun.created_at.desc())
            .limit(1)
        )
        run = (await self.db.execute(run_stmt)).scalars().first()
        if run is None:
            return None

        # A human-entered extraction value must land as a per-user
        # ReviewerDecision (blind-review write defense), not a shared proposal —
        # the form's /decisions path does the same. Recording it as a proposal
        # would leak this reviewer's value to peers via the shared proposal track.
        review_service = ExtractionReviewService(self.db)
        try:
            for field in fields:
                await review_service.record_decision(
                    run_id=run.id,
                    instance_id=model_instance_id,
                    field_id=field.id,
                    reviewer_id=user_id,
                    decision="edit",
                    value={"value": to_record[field.name]},
                )
        except InvalidDecisionError:
            # The run advanced out of extract between lookup and record —
            # the model itself was created fine; losing the prefill must
            # not 500 the whole creation.
            return None
        return run.id
