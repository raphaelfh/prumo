"""Publish the live template structure as a new active version.

Template configuration edits (sections/fields/flags) are written by the
frontend through the Supabase client, so they never pass through the API
— and until this service existed, nothing ever refreshed
``extraction_template_versions.schema_``. Every run (including brand-new
ones) kept rendering the schema frozen at clone time.

``republish`` closes that gap: it snapshots the live structure into a NEW
version row (v+1, active), leaves prior rows untouched (runs from
``consensus`` on stay pinned to the schema they were assessed under),
re-pins runs still in an editable stage (``pending`` / ``extract``) so
open extraction/QA forms pick up the edit, and materializes the singleton
instances a re-pinned run needs for any newly added section (otherwise
the ADR-0009 finalize gate — which counts required fields per EXISTING
instance — would silently skip the new section).
"""

from datetime import UTC, datetime
from typing import Any, cast
from uuid import UUID

from sqlalchemy import CursorResult, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.extraction import (
    ExtractionEntityType,
    ExtractionRun,
    ExtractionRunStage,
    ProjectExtractionTemplate,
)
from app.models.extraction_versioning import ExtractionTemplateVersion
from app.services.extraction_snapshot import build_template_version_snapshot
from app.services.hitl_session_service import (
    HITLSessionService,
    take_advisory_xact_lock,
)
from app.services.template_clone_service import TemplateNotFoundError

__all__ = ["RepublishResult", "TemplateNotFoundError", "TemplateVersionService"]

_EDITABLE_STAGES = (
    ExtractionRunStage.PENDING.value,
    ExtractionRunStage.EXTRACT.value,
)


class RepublishResult:
    """Result envelope returned by ``TemplateVersionService.republish``."""

    def __init__(
        self,
        *,
        version_id: UUID,
        version: int,
        changed: bool,
        repinned_run_count: int,
    ) -> None:
        self.version_id = version_id
        self.version = version
        self.changed = changed
        self.repinned_run_count = repinned_run_count


class TemplateVersionService:
    """Owns the template-version publish lifecycle for project templates."""

    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def republish(
        self,
        *,
        project_id: UUID,
        project_template_id: UUID,
        user_id: UUID,
    ) -> RepublishResult:
        # BOLA defense (unlocked read): validate ownership before taking any
        # lock, so a caller who is only a manager elsewhere can never lock —
        # or even match — a foreign project's template row.
        owned = (
            await self.db.execute(
                select(ProjectExtractionTemplate.id).where(
                    ProjectExtractionTemplate.id == project_template_id,
                    ProjectExtractionTemplate.project_id == project_id,
                )
            )
        ).scalar_one_or_none()
        if owned is None:
            raise TemplateNotFoundError(f"Template {project_template_id} not found")

        # Lock ordering mirrors HITLSessionService.open_or_resume — advisory
        # (article, template) locks FIRST (sorted for a deterministic global
        # order), THEN the template row. open_or_resume holds the advisory
        # lock while create_run takes the template row FOR SHARE; taking the
        # template FOR UPDATE before the advisory locks here would invert
        # that order and deadlock.
        run_pairs: list[tuple[UUID, UUID]] = [
            (row.project_id, row.article_id)
            for row in (
                await self.db.execute(
                    select(ExtractionRun.project_id, ExtractionRun.article_id)
                    .where(
                        ExtractionRun.template_id == project_template_id,
                        ExtractionRun.stage.in_(_EDITABLE_STAGES),
                    )
                    .distinct()
                )
            ).all()
        ]
        for _, article_id in sorted(run_pairs, key=lambda pair: str(pair[1])):
            await take_advisory_xact_lock(self.db, article_id, project_template_id)

        # Serialization: FOR UPDATE so two concurrent republishes cannot both
        # compute the same next version number (unique on
        # (project_template_id, version)), and so run creation (FOR SHARE on
        # this row) cannot pin a version this transaction is deactivating.
        await self.db.execute(
            select(ProjectExtractionTemplate.id)
            .where(ProjectExtractionTemplate.id == project_template_id)
            .with_for_update()
        )

        snapshot = await build_template_version_snapshot(self.db, project_template_id)

        current = (
            await self.db.execute(
                select(ExtractionTemplateVersion).where(
                    ExtractionTemplateVersion.project_template_id == project_template_id,
                    ExtractionTemplateVersion.is_active.is_(True),
                )
            )
        ).scalar_one_or_none()

        if current is not None and current.schema_ == snapshot:
            # Nothing changed — don't spawn version rows, but still re-pin:
            # runs created before this service existed may sit on an older
            # version even though the active snapshot is current.
            repinned = await self._repin_editable_runs(project_template_id, current.id)
            if repinned:
                await self._materialize_singleton_instances(
                    project_template_id=project_template_id,
                    run_pairs=run_pairs,
                    user_id=user_id,
                )
            return RepublishResult(
                version_id=current.id,
                version=current.version,
                changed=False,
                repinned_run_count=repinned,
            )

        max_version = (
            await self.db.execute(
                select(func.max(ExtractionTemplateVersion.version)).where(
                    ExtractionTemplateVersion.project_template_id == project_template_id
                )
            )
        ).scalar_one()
        if current is not None:
            # The partial unique index (one active per template) is checked
            # on flush — deactivate before inserting the successor.
            current.is_active = False
            await self.db.flush()

        new_version = ExtractionTemplateVersion(
            project_template_id=project_template_id,
            version=(max_version or 0) + 1,
            schema_=snapshot,
            published_at=datetime.now(UTC),
            published_by=user_id,
            is_active=True,
        )
        self.db.add(new_version)
        await self.db.flush()

        repinned = await self._repin_editable_runs(project_template_id, new_version.id)
        await self._materialize_singleton_instances(
            project_template_id=project_template_id,
            run_pairs=run_pairs,
            user_id=user_id,
        )
        return RepublishResult(
            version_id=new_version.id,
            version=new_version.version,
            changed=True,
            repinned_run_count=repinned,
        )

    async def _repin_editable_runs(self, project_template_id: UUID, version_id: UUID) -> int:
        result = await self.db.execute(
            update(ExtractionRun)
            .where(
                ExtractionRun.template_id == project_template_id,
                ExtractionRun.stage.in_(_EDITABLE_STAGES),
                ExtractionRun.version_id != version_id,
            )
            .values(version_id=version_id)
        )
        # execute() types the return as Result[Any]; an UPDATE yields a
        # CursorResult at runtime, which carries rowcount.
        return cast("CursorResult[Any]", result).rowcount or 0

    async def _materialize_singleton_instances(
        self,
        *,
        project_template_id: UUID,
        run_pairs: list[tuple[UUID, UUID]],
        user_id: UUID,
    ) -> None:
        """Seed missing cardinality-one instances for every re-pinned run.

        Reuses ``HITLSessionService.ensure_instances`` (the session-open
        seeding path) per affected article; idempotent, and the advisory
        lock it re-takes is already held by this transaction.
        """
        if not run_pairs:
            return
        entity_types = list(
            (
                await self.db.execute(
                    select(ExtractionEntityType)
                    .where(ExtractionEntityType.project_template_id == project_template_id)
                    .order_by(ExtractionEntityType.sort_order)
                )
            )
            .scalars()
            .all()
        )
        session_service = HITLSessionService(self.db)
        for run_project_id, article_id in run_pairs:
            await session_service.ensure_instances(
                project_id=run_project_id,
                article_id=article_id,
                project_template_id=project_template_id,
                entity_types=entity_types,
                user_id=user_id,
            )
