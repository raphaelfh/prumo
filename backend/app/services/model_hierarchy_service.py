"""Service to create extraction model hierarchy in one transaction."""

from dataclasses import dataclass
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.extraction import (
    ExtractionCardinality,
    ExtractionEntityType,
    ExtractionField,
    ExtractionInstance,
    ExtractionRun,
    ExtractionRunStage,
    ProjectExtractionTemplate,
)
from app.models.extraction_workflow import ExtractionProposalSource
from app.models.extraction_versioning import TemplateKind
from app.services.extraction_proposal_service import ExtractionProposalService


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
            metadata_={},
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

        proposal_run_id = await self._record_modelling_method_if_possible(
            article_id=article_id,
            template_id=template_id,
            model_entity_type_id=model_entity_type.id,
            model_instance_id=parent.id,
            user_id=user_id,
            modelling_method=modelling_method,
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

    async def _prediction_models_entity_type(self, template_id: UUID) -> ExtractionEntityType | None:
        stmt = select(ExtractionEntityType).where(
            ExtractionEntityType.project_template_id == template_id,
            ExtractionEntityType.name == "prediction_models",
        )
        return (await self.db.execute(stmt)).scalars().first()

    async def _model_singleton_children(self, parent_entity_type_id: UUID) -> list[ExtractionEntityType]:
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

    async def _record_modelling_method_if_possible(
        self,
        *,
        article_id: UUID,
        template_id: UUID,
        model_entity_type_id: UUID,
        model_instance_id: UUID,
        user_id: UUID,
        modelling_method: str | None,
    ) -> UUID | None:
        if not modelling_method:
            return None

        field_stmt = select(ExtractionField).where(
            ExtractionField.entity_type_id == model_entity_type_id,
            ExtractionField.name == "modelling_method",
        )
        field = (await self.db.execute(field_stmt)).scalars().first()
        if field is None:
            return None

        run_stmt = (
            select(ExtractionRun)
            .where(
                ExtractionRun.article_id == article_id,
                ExtractionRun.template_id == template_id,
                ExtractionRun.kind == TemplateKind.EXTRACTION.value,
                ExtractionRun.stage.in_(
                    [
                        ExtractionRunStage.PROPOSAL.value,
                        ExtractionRunStage.REVIEW.value,
                    ]
                ),
            )
            .order_by(ExtractionRun.created_at.desc())
            .limit(1)
        )
        run = (await self.db.execute(run_stmt)).scalars().first()
        if run is None:
            return None

        proposal_service = ExtractionProposalService(self.db)
        await proposal_service.record_proposal(
            run_id=run.id,
            instance_id=model_instance_id,
            field_id=field.id,
            source=ExtractionProposalSource.HUMAN,
            source_user_id=user_id,
            proposed_value={"value": modelling_method},
        )
        return run.id
