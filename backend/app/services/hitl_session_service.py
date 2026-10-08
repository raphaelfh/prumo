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

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.extraction import (
    ExtractionEntityType,
    ExtractionRun,
    ExtractionRunStage,
    ProjectExtractionTemplate,
    TemplateKind,
)
from app.services.article_read_service import ArticleNotFoundError, owned_article
from app.services.instance_seeding import ensure_instances
from app.services.run_lifecycle_service import (
    NON_TERMINAL_STAGES,
    RunLifecycleService,
    last_human_activity_order,
)
from app.services.template_clone_service import (
    TemplateCloneService,
    TemplateNotFoundError,
)
from app.services.template_versioning import PendingConfigDraftError, clone_template


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
        instances = await ensure_instances(
            self.db,
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
        # One implementation of the article-in-project predicate, with the
        # scope in the WHERE clause (`.claude/rules/backend.md` § Ownership
        # guards). The message is unchanged: it already answered "missing"
        # and "foreign" identically, and echoes only ids the caller supplied.
        try:
            await owned_article(self.db, project_id=project_id, article_id=article_id)
        except ArticleNotFoundError as exc:
            raise HITLSessionInputError(
                f"article {article_id} does not belong to project {project_id}"
            ) from exc

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
            try:
                clone = await clone_template(
                    self.db,
                    project_id=project_id,
                    global_template_id=global_template_id,
                    user_id=user_id,
                    kind=kind,
                )
            except PendingConfigDraftError:
                # B-4: a pending config draft must NEVER gate session-open
                # (the global constraint that keeps reviewers out of the
                # manager's edit loop). Either heal of an EXISTING clone can
                # refuse — use that clone AS-IS: the run pins to the current
                # ACTIVE version and the draft stays unpublished until the
                # manager presses Publish.
                #
                # What AS-IS means differs by branch. After a drift refusal
                # the live tree is intact and the form renders. After a
                # ZERO-STATE refusal it is empty, and ``ensure_instances``
                # below seeds from live rows — so the reviewer gets an empty
                # form until the manager publishes. Deliberate: the template
                # is mid-edit, and healing it would both publish the staged
                # instruction and resurrect the sections just deleted.
                existing = await self._clone.resolve_existing_clone(project_id, global_template_id)
                assert existing is not None, "PendingConfigDraftError implies an existing clone"
                return existing.id
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
        in ``ensure_instances`` is already held for this transaction;
        the active-run SELECT below cannot race with itself.
        """

        # Prefer the non-terminal run that HOLDS HUMAN WORK — the one whose most
        # recent human activity (reviewer decision, consensus decision, or
        # human proposal) is latest — falling back to the newest by created_at
        # when no run carries any. Ordering by created_at alone silently
        # orphans saved work the moment a newer (e.g. AI/model-extraction) run
        # appears for the same coordinate: the opener would resume the newer
        # empty run and the earlier run's work would vanish on refresh.
        # ``last_human_activity_order`` is the shared ranking (also used by the
        # standalone-extraction gate) — see run_lifecycle_service for the
        # NULLS-LAST semantics. Under the one-live-run index (0045) at most one
        # row matches; the ranking is the pre-heal / defense-in-depth ordering.
        active_stmt = (
            select(ExtractionRun)
            .where(
                ExtractionRun.project_id == project_id,
                ExtractionRun.article_id == article_id,
                ExtractionRun.template_id == project_template_id,
                ExtractionRun.stage.in_(NON_TERMINAL_STAGES),
            )
            .order_by(
                last_human_activity_order().desc().nulls_last(),
                ExtractionRun.created_at.desc(),
            )
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
