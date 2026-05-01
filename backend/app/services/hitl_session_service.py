"""Open or resume a HITL session: clone (QA only) + instances + Run + advance.

Single entry point for both kinds:

* ``kind=quality_assessment`` requires ``global_template_id`` and clones the
  global QA template (PROBAST / QUADAS-2 / ...) into the project on first
  call. The project template is then used for every subsequent call.
* ``kind=extraction`` requires ``project_template_id`` directly — extraction
  templates are authored per-project, not cloned from a global pool.

Either way, this service ensures the article has one instance per top-level
entity type, opens (or resumes) a Run, and parks it in ``PROPOSAL`` so the
UI can immediately record proposals.
"""

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.extraction import (
    ExtractionEntityType,
    ExtractionInstance,
    ExtractionInstanceStatus,
    ExtractionRun,
    ExtractionRunStage,
    ProjectExtractionTemplate,
    TemplateKind,
)
from app.services.run_lifecycle_service import RunLifecycleService
from app.services.template_clone_service import (
    TemplateCloneService,
    TemplateNotFoundError,
)


class HITLSessionInputError(Exception):
    """The caller passed a kind / template-id combination that doesn't make sense."""


class HITLSession:
    """Result envelope: enough state for the UI to start writing proposals."""

    def __init__(
        self,
        *,
        run_id: UUID,
        kind: TemplateKind,
        project_template_id: UUID,
        instances_by_entity_type: dict[str, str],
    ) -> None:
        self.run_id = run_id
        self.kind = kind
        self.project_template_id = project_template_id
        self.instances_by_entity_type = instances_by_entity_type


class HITLSessionService:
    """Idempotent setup for both extraction and quality-assessment HITL flows.

    Re-calling for the same ``(project, article, project_template)`` reuses
    the existing instances and the latest non-finalized Run. A finalized
    Run is returned read-only — the UI shows it with a "Reopen for revision"
    button rather than silently forking a new run.
    """

    def __init__(self, db: AsyncSession) -> None:
        self.db = db
        self._clone = TemplateCloneService(db)
        self._lifecycle = RunLifecycleService(db)

    async def open_or_resume(
        self,
        *,
        kind: TemplateKind,
        project_id: UUID,
        article_id: UUID,
        user_id: UUID,
        project_template_id: UUID | None = None,
        global_template_id: UUID | None = None,
    ) -> HITLSession:
        project_template_id = await self._resolve_project_template(
            kind=kind,
            project_id=project_id,
            project_template_id=project_template_id,
            global_template_id=global_template_id,
            user_id=user_id,
        )

        entity_types = await self._project_entity_types(project_template_id)
        instances = await self._ensure_instances(
            project_id=project_id,
            article_id=article_id,
            project_template_id=project_template_id,
            entity_types=entity_types,
            user_id=user_id,
        )

        run = await self._reuse_or_create_run(
            project_id=project_id,
            article_id=article_id,
            project_template_id=project_template_id,
            kind=kind,
            user_id=user_id,
        )

        return HITLSession(
            run_id=run.id,
            kind=kind,
            project_template_id=project_template_id,
            instances_by_entity_type={
                str(et_id): str(inst_id) for et_id, inst_id in instances.items()
            },
        )

    async def _resolve_project_template(
        self,
        *,
        kind: TemplateKind,
        project_id: UUID,
        project_template_id: UUID | None,
        global_template_id: UUID | None,
        user_id: UUID,
    ) -> UUID:
        if project_template_id is not None:
            tpl = await self.db.get(ProjectExtractionTemplate, project_template_id)
            if tpl is None or tpl.project_id != project_id:
                raise HITLSessionInputError(
                    f"project_template_id {project_template_id} not found in project"
                )
            if tpl.kind != kind.value:
                raise HITLSessionInputError(
                    f"project_template_id {project_template_id} has kind={tpl.kind}, "
                    f"expected {kind.value}"
                )
            return tpl.id

        if kind == TemplateKind.QUALITY_ASSESSMENT:
            if global_template_id is None:
                raise HITLSessionInputError(
                    "kind=quality_assessment requires either project_template_id "
                    "or global_template_id"
                )
            clone = await self._clone.clone(
                project_id=project_id,
                global_template_id=global_template_id,
                user_id=user_id,
                kind=kind,
            )
            return clone.project_template_id

        raise HITLSessionInputError(
            "kind=extraction requires project_template_id (extraction templates "
            "are not cloned from a global pool)"
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

        pending_instances: list[tuple[UUID, ExtractionInstance]] = []
        for et in entity_types:
            # Many-cardinality entity types add instances dynamically through the
            # extraction UI; the session only seeds the singletons (top-level,
            # one-cardinality entity types).
            if et.id in by_entity:
                continue
            if et.parent_entity_type_id is not None:
                continue
            inst = ExtractionInstance(
                project_id=project_id,
                article_id=article_id,
                template_id=project_template_id,
                entity_type_id=et.id,
                parent_instance_id=None,
                label=et.label,
                sort_order=et.sort_order,
                metadata_={"created_via": "hitl_session"},
                created_by=user_id,
                status=ExtractionInstanceStatus.PENDING.value,
            )
            pending_instances.append((et.id, inst))

        if pending_instances:
            self.db.add_all([inst for _, inst in pending_instances])
            await self.db.flush()
            for entity_type_id, instance in pending_instances:
                by_entity[entity_type_id] = instance.id

        return by_entity

    async def _reuse_or_create_run(
        self,
        *,
        project_id: UUID,
        article_id: UUID,
        project_template_id: UUID,
        kind: TemplateKind,
        user_id: UUID,
    ) -> ExtractionRun:
        """Resolve the run to expose to the UI.

        Lookup order:
          1. Latest *non-terminal* run for (project, article, template) —
             still editable, advance pending → proposal if needed.
          2. Latest *finalized* run — read-only; the UI shows it with a
             "Reopen for revision" button. We do NOT auto-create a new
             run here because that would silently abandon the previously
             published values. Reopen is an explicit action with its own
             endpoint that seeds the new run from the published state.
          3. No run at all → create a fresh one and advance to PROPOSAL.
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
                parameters={"opened_via": "hitl_session", "kind": kind.value},
            )

        if run.stage == ExtractionRunStage.PENDING.value:
            run = await self._lifecycle.advance_stage(
                run_id=run.id,
                target_stage=ExtractionRunStage.PROPOSAL,
                user_id=user_id,
            )
        return run


# Re-export so callers that need to handle the not-found case can do so by
# the same exception both this service and the underlying clone raise.
__all__ = [
    "HITLSession",
    "HITLSessionInputError",
    "HITLSessionService",
    "TemplateNotFoundError",
]
