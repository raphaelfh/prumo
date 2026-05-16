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

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.extraction import (
    ExtractionCardinality,
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


def _advisory_key_pair(left: UUID, right: UUID) -> tuple[int, int]:
    """Derive a stable signed-int32 pair from two UUIDs for
    ``pg_advisory_xact_lock(int, int)``.

    Both UUIDs contribute to both keys (high XOR low) so the pair is
    unique per (left, right) combination and stable across processes.
    Postgres treats the two arguments as signed int32, so we keep each
    component inside the positive range with ``0x7FFFFFFF``.
    """
    a = left.int
    b = right.int
    key1 = ((a >> 64) ^ (b & 0xFFFFFFFFFFFFFFFF)) & 0x7FFFFFFF
    key2 = ((a & 0xFFFFFFFFFFFFFFFF) ^ (b >> 64)) & 0x7FFFFFFF
    return key1, key2


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
        created: bool,
    ) -> None:
        self.run_id = run_id
        self.kind = kind
        self.project_template_id = project_template_id
        self.instances_by_entity_type = instances_by_entity_type
        # Issue #32: distinguish a freshly created Run (HTTP 201) from a
        # resumed one (HTTP 200) so the endpoint can return correct status.
        self.created = created


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

        run, created = await self._reuse_or_create_run(
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
            created=created,
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
        # Issue #64: serialise concurrent open_or_resume calls for the same
        # (article, template) pair so the SELECT-then-INSERT below cannot
        # race and produce duplicate singleton instances. The lock is
        # transaction-scoped, so it is released on commit / rollback and
        # does not require explicit cleanup.
        key1, key2 = _advisory_key_pair(article_id, project_template_id)
        await self.db.execute(
            text("SELECT pg_advisory_xact_lock(:k1, :k2)"),
            {"k1": key1, "k2": key2},
        )

        existing_stmt = select(ExtractionInstance).where(
            ExtractionInstance.article_id == article_id,
            ExtractionInstance.template_id == project_template_id,
        )
        existing_rows = list((await self.db.execute(existing_stmt)).scalars().all())
        by_entity: dict[UUID, UUID] = {row.entity_type_id: row.id for row in existing_rows}

        for et in entity_types:
            # Many-cardinality entity types add instances dynamically through the
            # extraction UI; the session only seeds the singletons (top-level,
            # one-cardinality entity types).
            if et.id in by_entity:
                continue
            if et.parent_entity_type_id is not None:
                continue
            # Issue #71: the parent-id guard only filters child entity types.
            # Top-level entity types with cardinality=MANY must NOT receive
            # a phantom singleton instance — the UI creates them on demand.
            if et.cardinality != ExtractionCardinality.ONE.value:
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
        kind: TemplateKind,
        user_id: UUID,
    ) -> tuple[ExtractionRun, bool]:
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

        Returns ``(run, created)`` where ``created`` is True only when a
        brand-new Run row was inserted (path 3); both reuse paths return
        ``False`` so the endpoint can emit 200 instead of 201.
        """
        # Issue #70: serialise concurrent open_or_resume calls for the same
        # (project, article, template) tuple so the active-run SELECT below
        # cannot race with itself and produce two PROPOSAL runs. We reuse
        # the article/template advisory key already taken in
        # ``_ensure_instances`` to keep the critical section coherent.
        key1, key2 = _advisory_key_pair(article_id, project_template_id)
        await self.db.execute(
            text("SELECT pg_advisory_xact_lock(:k1, :k2)"),
            {"k1": key1, "k2": key2},
        )

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
        created = False

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
            created = True

        if run.stage == ExtractionRunStage.PENDING.value:
            run = await self._lifecycle.advance_stage(
                run_id=run.id,
                target_stage=ExtractionRunStage.PROPOSAL,
                user_id=user_id,
            )
        return run, created


# Re-export so callers that need to handle the not-found case can do so by
# the same exception both this service and the underlying clone raise.
__all__ = [
    "HITLSession",
    "HITLSessionInputError",
    "HITLSessionService",
    "TemplateNotFoundError",
]
