"""Open or resume a HITL session: clone (QA only) + instances + Run + advance.

Single entry point for both kinds:

* ``kind=quality_assessment`` requires ``global_template_id`` and clones the
  global QA template (PROBAST / QUADAS-2 / ...) into the project on first
  call. The project template is then used for every subsequent call.
* ``kind=extraction`` requires ``project_template_id`` directly — extraction
  templates are authored per-project, not cloned from a global pool.

Either way, this service ensures the article has one instance per top-level
entity type, opens (or resumes) a Run, and parks it in ``EXTRACT`` so the
UI can immediately record decisions.
"""

from uuid import UUID

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.article import Article
from app.models.extraction import (
    ExtractionCardinality,
    ExtractionEntityType,
    ExtractionInstance,
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


async def _take_advisory_xact_lock(db: AsyncSession, left: UUID, right: UUID) -> None:
    """Take a transaction-scoped advisory lock keyed by (left, right).

    Uses Postgres' built-in ``hashtextextended`` to derive a bigint
    fingerprint from the UUID pair — Postgres treats the result as a
    signed bigint, which is exactly what ``pg_advisory_xact_lock(bigint)``
    wants. The lock is released automatically on commit/rollback.
    """
    await db.execute(
        text("SELECT pg_advisory_xact_lock(hashtextextended(:key, 0))"),
        {"key": f"{left}:{right}"},
    )


class HITLSessionInputError(Exception):
    """The caller passed a kind / template-id combination that doesn't make sense."""


class HITLSession:
    """Result envelope: enough state for the UI to start recording decisions."""

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
        # BOLA defense: the endpoint enforces membership for ``project_id`` but
        # treats ``article_id`` as opaque. Verify the article truly belongs to
        # the project before we materialise any state on it. Returning a
        # uniform input error (400) avoids leaking which article ids exist.
        await self._ensure_article_in_project(project_id=project_id, article_id=article_id)

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

    async def _ensure_article_in_project(self, *, project_id: UUID, article_id: UUID) -> None:
        stmt = select(Article.project_id).where(Article.id == article_id)
        owner = (await self.db.execute(stmt)).scalar_one_or_none()
        if owner is None or owner != project_id:
            raise HITLSessionInputError(
                f"article {article_id} does not belong to project {project_id}"
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
        # does not require explicit cleanup. The same lock also protects
        # the active-run lookup in ``_reuse_or_create_run`` (issue #70).
        await _take_advisory_xact_lock(self.db, article_id, project_template_id)

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
            )
            pending_instances.append((et.id, inst))

        if pending_instances:
            self.db.add_all([inst for _, inst in pending_instances])
            await self.db.flush()
            for entity_type_id, instance in pending_instances:
                by_entity[entity_type_id] = instance.id
                existing_rows.append(instance)

        # Backfill of late-added singleton children (issue #71 follow-up) runs
        # over the full ``existing_rows`` snapshot — both the pre-existing rows
        # and the ones we just flushed — so cardinality=one children of every
        # parent instance are materialised on session open.
        await self._backfill_child_singletons(
            project_id=project_id,
            article_id=article_id,
            project_template_id=project_template_id,
            entity_types=entity_types,
            user_id=user_id,
            existing_rows=existing_rows,
        )

        return by_entity

    async def _backfill_child_singletons(
        self,
        *,
        project_id: UUID,
        article_id: UUID,
        project_template_id: UUID,
        entity_types: list[ExtractionEntityType],
        user_id: UUID,
        existing_rows: list[ExtractionInstance],
    ) -> None:
        """Materialise missing cardinality='one' child instances for
        existing parent instances.

        Maintains the invariant: for every parent instance, every
        cardinality='one' child entity type has exactly one matching
        instance under it. The original ``_ensure_instances`` only seeded
        top-level singletons; it never touched children. That left a gap:

        * A manager adds a new sub-section under ``prediction_models`` in
          the Configuration tab (e.g. inserts a new ``extraction_entity_types``
          row with ``parent_entity_type_id`` pointing at an existing
          many-parent) AFTER models for the article were already created.
        * Existing model instances would not have an instance of the new
          sub-section, so the form rendered the fields but had no instance
          to bind ``ReviewerDecision``/``PublishedState`` to — orphan UI.

        Running this on every session open also covers the symmetric case
        for cardinality='one' parents whose children were added later, and
        is idempotent: it only inserts when the (parent_instance, child
        entity_type) pair has no row yet. Same advisory lock as the
        top-level seeding above guards against duplicates under
        concurrent opens.
        """
        many_one_pairs: dict[UUID, list[ExtractionEntityType]] = {}
        for et in entity_types:
            if et.parent_entity_type_id is None:
                continue
            if et.cardinality != ExtractionCardinality.ONE.value:
                continue
            many_one_pairs.setdefault(et.parent_entity_type_id, []).append(et)

        if not many_one_pairs:
            return

        existing_children: set[tuple[UUID, UUID]] = {
            (row.parent_instance_id, row.entity_type_id)
            for row in existing_rows
            if row.parent_instance_id is not None
        }

        # Snapshot parent instances by entity_type so we can iterate the
        # singleton invariant per (parent_instance, child_entity_type).
        parent_instances_by_et: dict[UUID, list[ExtractionInstance]] = {}
        for row in existing_rows:
            if row.entity_type_id in many_one_pairs:
                parent_instances_by_et.setdefault(row.entity_type_id, []).append(row)

        inserted = False
        for parent_et_id, child_ets in many_one_pairs.items():
            for parent_inst in parent_instances_by_et.get(parent_et_id, []):
                for child_et in child_ets:
                    if (parent_inst.id, child_et.id) in existing_children:
                        continue
                    self.db.add(
                        ExtractionInstance(
                            project_id=project_id,
                            article_id=article_id,
                            template_id=project_template_id,
                            entity_type_id=child_et.id,
                            parent_instance_id=parent_inst.id,
                            label=f"{parent_inst.label} - {child_et.label} 1",
                            sort_order=child_et.sort_order,
                            metadata_={"created_via": "hitl_session_backfill"},
                            created_by=user_id,
                        )
                    )
                    existing_children.add((parent_inst.id, child_et.id))
                    inserted = True

        if inserted:
            await self.db.flush()

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
             still editable, advance pending → extract if needed.
          2. Latest *finalized* run — read-only; the UI shows it with a
             "Reopen for revision" button. We do NOT auto-create a new
             run here because that would silently abandon the previously
             published values. Reopen is an explicit action with its own
             endpoint that seeds the new run from the published state.
          3. No run at all → create a fresh one and advance to EXTRACT.

        Returns ``(run, created)`` where ``created`` is True only when a
        brand-new Run row was inserted (path 3); both reuse paths return
        ``False`` so the endpoint can emit 200 instead of 201.

        Concurrency note (issue #70): callers always go through
        ``open_or_resume`` so the (article, template) advisory lock taken
        in ``_ensure_instances`` is already held for this transaction;
        the active-run SELECT below cannot race with itself.
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
                        ExtractionRunStage.EXTRACT.value,
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
                target_stage=ExtractionRunStage.EXTRACT,
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
