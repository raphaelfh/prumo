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
    ProjectExtractionTemplate,
    TemplateKind,
)
from app.services.article_read_service import ArticleNotFoundError, owned_article
from app.services.current_run import CurrentRunResolver
from app.services.instance_seeding import ensure_instances
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

        run, created = await CurrentRunResolver(self.db).open_for_session(
            project_id=project_id,
            article_id=article_id,
            template_id=project_template_id,
            user_id=user_id,
            parameters={"opened_via": "hitl_session", "kind": kind.value},
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


# Re-export so callers that need to handle the not-found case can do so by
# the same exception both this service and the underlying clone raise.
__all__ = [
    "HITLSession",
    "HITLSessionInputError",
    "HITLSessionService",
    "TemplateNotFoundError",
]
