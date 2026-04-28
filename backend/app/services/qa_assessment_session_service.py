"""Set up a Quality-Assessment session: clone + instances + Run + advance."""

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.extraction import (
    ExtractionEntityType,
    ExtractionInstance,
    ExtractionInstanceStatus,
    ExtractionRun,
    ExtractionRunStage,
)
from app.services.qa_template_clone_service import QaTemplateCloneService
from app.services.run_lifecycle_service import RunLifecycleService


class QaAssessmentSession:
    """Result envelope: enough state for the UI to write proposals."""

    def __init__(
        self,
        *,
        run_id: UUID,
        project_template_id: UUID,
        instances_by_entity_type: dict[str, str],
    ) -> None:
        self.run_id = run_id
        self.project_template_id = project_template_id
        self.instances_by_entity_type = instances_by_entity_type


class QaAssessmentSessionService:
    """One-shot setup: clone the QA template, ensure one instance per domain
    for this article, open a Run, and park it in the PROPOSAL stage so the
    UI can immediately record human proposals.

    Idempotent on (project, article, project_template): re-calling reuses the
    existing instances and the latest non-finalized Run, advancing it to
    PROPOSAL only when needed.
    """

    def __init__(self, db: AsyncSession) -> None:
        self.db = db
        self._clone = QaTemplateCloneService(db)
        self._lifecycle = RunLifecycleService(db)

    async def open(
        self,
        *,
        project_id: UUID,
        article_id: UUID,
        global_template_id: UUID,
        user_id: UUID,
    ) -> QaAssessmentSession:
        clone = await self._clone.clone(
            project_id=project_id,
            global_template_id=global_template_id,
            user_id=user_id,
        )

        entity_types = await self._project_entity_types(clone.project_template_id)
        instances = await self._ensure_instances(
            project_id=project_id,
            article_id=article_id,
            project_template_id=clone.project_template_id,
            entity_types=entity_types,
            user_id=user_id,
        )

        run = await self._reuse_or_create_run(
            project_id=project_id,
            article_id=article_id,
            project_template_id=clone.project_template_id,
            user_id=user_id,
        )

        return QaAssessmentSession(
            run_id=run.id,
            project_template_id=clone.project_template_id,
            instances_by_entity_type={
                str(et_id): str(inst_id) for et_id, inst_id in instances.items()
            },
        )

    async def _project_entity_types(self, project_template_id: UUID) -> list[ExtractionEntityType]:
        stmt = (
            select(ExtractionEntityType)
            .where(ExtractionEntityType.project_template_id == project_template_id)
            .order_by(ExtractionEntityType.sort_order)
        )
        return list((await self.db.execute(stmt)).scalars().all())

    async def _ensure_instances(
        self,
        *,
        project_id: UUID,
        article_id: UUID,
        project_template_id: UUID,
        entity_types: list[ExtractionEntityType],
        user_id: UUID,
    ) -> dict[UUID, UUID]:
        existing_stmt = select(ExtractionInstance).where(
            ExtractionInstance.article_id == article_id,
            ExtractionInstance.template_id == project_template_id,
        )
        existing_rows = list((await self.db.execute(existing_stmt)).scalars().all())
        by_entity: dict[UUID, UUID] = {row.entity_type_id: row.id for row in existing_rows}

        for et in entity_types:
            if et.id in by_entity:
                continue
            inst = ExtractionInstance(
                project_id=project_id,
                article_id=article_id,
                template_id=project_template_id,
                entity_type_id=et.id,
                parent_instance_id=None,
                label=et.label,
                sort_order=et.sort_order,
                metadata_={"created_via": "qa_assessment_session"},
                created_by=user_id,
                status=ExtractionInstanceStatus.PENDING.value,
            )
            self.db.add(inst)
            await self.db.flush()
            by_entity[et.id] = inst.id

        return by_entity

    async def _reuse_or_create_run(
        self,
        *,
        project_id: UUID,
        article_id: UUID,
        project_template_id: UUID,
        user_id: UUID,
    ) -> ExtractionRun:
        """Resolve the run to expose to the QA UI.

        Lookup order:
          1. Latest *non-terminal* run for (project, article, template) —
             still editable, advance pending → proposal if needed.
          2. Latest *finalized* run — read-only; the UI shows it with a
             "Reopen for revision" button. We do NOT auto-create a new
             run here because that would silently abandon the previously
             published values. Reopen is an explicit action with its own
             endpoint that seeds the new run from the published state.
          3. No run at all → create a fresh one in PROPOSAL.
        """
        active_stmt = (
            select(ExtractionRun)
            .where(
                ExtractionRun.project_id == project_id,
                ExtractionRun.article_id == article_id,
                ExtractionRun.template_id == project_template_id,
                ExtractionRun.stage.in_(
                    [
                        ExtractionRunStage.PENDING.value,
                        ExtractionRunStage.PROPOSAL.value,
                        ExtractionRunStage.REVIEW.value,
                        ExtractionRunStage.CONSENSUS.value,
                    ]
                ),
            )
            .order_by(ExtractionRun.created_at.desc())
        )
        run = (await self.db.execute(active_stmt)).scalars().first()

        if run is None:
            finalized_stmt = (
                select(ExtractionRun)
                .where(
                    ExtractionRun.project_id == project_id,
                    ExtractionRun.article_id == article_id,
                    ExtractionRun.template_id == project_template_id,
                    ExtractionRun.stage == ExtractionRunStage.FINALIZED.value,
                )
                .order_by(ExtractionRun.created_at.desc())
            )
            run = (await self.db.execute(finalized_stmt)).scalars().first()

        if run is None:
            run = await self._lifecycle.create_run(
                project_id=project_id,
                article_id=article_id,
                project_template_id=project_template_id,
                user_id=user_id,
                parameters={"opened_via": "qa_assessment_session"},
            )

        if run.stage == ExtractionRunStage.PENDING.value:
            run = await self._lifecycle.advance_stage(
                run_id=run.id,
                target_stage=ExtractionRunStage.PROPOSAL,
                user_id=user_id,
            )
        return run
