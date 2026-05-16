"""Run lifecycle service: create + advance stage with precondition checks."""

from datetime import UTC, datetime
from typing import Any
from uuid import UUID

from sqlalchemy import select, text
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.extraction import (
    ExtractionRun,
    ExtractionRunStage,
    ExtractionRunStatus,
    ProjectExtractionTemplate,
)
from app.models.extraction_versioning import ExtractionTemplateVersion
from app.models.extraction_workflow import (
    ExtractionProposalRecord,
    ExtractionProposalSource,
    ExtractionPublishedState,
)
from app.services.hitl_config_service import HitlConfigService


class InvalidStageTransitionError(Exception):
    """Raised when a stage transition is not permitted from the current stage."""


class TemplateVersionNotFoundError(Exception):
    """Raised when no active TemplateVersion exists for a template."""


class TemplateNotFoundError(Exception):
    """Raised when no ProjectExtractionTemplate exists for the supplied id."""


class CannotReopenRunError(Exception):
    """Raised when a Run cannot be reopened (e.g., not finalized)."""


# Allowed transitions: from -> set of valid target stages
_ALLOWED_TRANSITIONS: dict[str, set[str]] = {
    ExtractionRunStage.PENDING.value: {
        ExtractionRunStage.PROPOSAL.value,
        ExtractionRunStage.CANCELLED.value,
    },
    ExtractionRunStage.PROPOSAL.value: {
        ExtractionRunStage.REVIEW.value,
        ExtractionRunStage.CANCELLED.value,
    },
    ExtractionRunStage.REVIEW.value: {
        ExtractionRunStage.CONSENSUS.value,
        ExtractionRunStage.CANCELLED.value,
    },
    ExtractionRunStage.CONSENSUS.value: {
        ExtractionRunStage.FINALIZED.value,
        ExtractionRunStage.CANCELLED.value,
    },
    ExtractionRunStage.FINALIZED.value: set(),  # terminal
    ExtractionRunStage.CANCELLED.value: set(),  # terminal
}


class RunLifecycleService:
    """Owns Run creation and stage transitions."""

    def __init__(self, db: AsyncSession):
        self.db = db
        self._hitl = HitlConfigService(db)

    async def create_run(
        self,
        *,
        project_id: UUID,
        article_id: UUID,
        project_template_id: UUID,
        user_id: UUID,
        parameters: dict[str, Any] | None = None,
    ) -> ExtractionRun:
        # Resolve template (for kind) — must exist
        template = await self.db.get(ProjectExtractionTemplate, project_template_id)
        if template is None:
            raise TemplateNotFoundError(f"Template {project_template_id} not found")

        # Resolve active TemplateVersion. Templates created directly through
        # the frontend (Supabase client) skip the backend backfill from
        # alembic 0010, so lazily snapshot v=1 on first Run.
        version_stmt = select(ExtractionTemplateVersion).where(
            ExtractionTemplateVersion.project_template_id == project_template_id,
            ExtractionTemplateVersion.is_active.is_(True),
        )
        version = (await self.db.execute(version_stmt)).scalar_one_or_none()
        if version is None:
            version = await self._snapshot_initial_version(
                project_template_id=project_template_id,
                user_id=user_id,
            )

        snapshot = await self._hitl.resolve_snapshot(project_id, project_template_id)

        run = ExtractionRun(
            project_id=project_id,
            article_id=article_id,
            template_id=project_template_id,
            kind=template.kind,
            version_id=version.id,
            hitl_config_snapshot=snapshot,
            stage=ExtractionRunStage.PENDING.value,
            status=ExtractionRunStatus.PENDING.value,
            parameters=parameters or {},
            results={},
            created_by=user_id,
        )
        self.db.add(run)
        await self.db.flush()
        await self.db.refresh(run)
        return run

    async def advance_stage(
        self,
        *,
        run_id: UUID,
        target_stage: ExtractionRunStage | str,
        user_id: UUID,  # noqa: ARG002 — captured for audit later
    ) -> ExtractionRun:
        target = (
            target_stage.value if isinstance(target_stage, ExtractionRunStage) else target_stage
        )
        # Lock the row for the duration of the transaction so two concurrent
        # callers cannot both pass the precondition check and silently
        # overwrite each other's transition.
        run = (
            await self.db.execute(
                select(ExtractionRun).where(ExtractionRun.id == run_id).with_for_update()
            )
        ).scalar_one_or_none()
        if run is None:
            raise ValueError(f"Run {run_id} not found")
        allowed = _ALLOWED_TRANSITIONS.get(run.stage, set())
        if target not in allowed:
            raise InvalidStageTransitionError(f"Cannot transition from {run.stage} to {target}")
        run.stage = target
        if target == ExtractionRunStage.CANCELLED.value:
            run.status = ExtractionRunStatus.FAILED.value
        elif target == ExtractionRunStage.FINALIZED.value:
            run.status = ExtractionRunStatus.COMPLETED.value
        await self.db.flush()
        await self.db.refresh(run)
        return run

    async def reopen_run(
        self,
        *,
        run_id: UUID,
        user_id: UUID,
    ) -> ExtractionRun:
        """Create a new Run derived from a finalized one, pre-populated with
        the previous published values as ``source='system'`` proposals.

        Implements the "Option C" reopen UX: each revision is its own
        immutable Run, linked to the parent via
        ``parameters.parent_run_id``. The previous PublishedState rows
        are not mutated; the new Run will publish its own (with version+1
        per coordinate via the normal consensus flow).

        The new Run lands in stage=REVIEW so the form can immediately
        accept ReviewerDecisions over the seeded proposals — same UX as
        post-AI-extraction.
        """
        # Lock the parent run for the duration of the transaction so two
        # concurrent reopen requests serialise. Inside the locked section
        # we additionally check whether a child run already exists for this
        # parent: if so, the previous caller already executed the reopen
        # and we return its child idempotently instead of forking a second
        # one. Without this guard, the FOR UPDATE only delays the second
        # caller — once it wakes up, ``old_run.stage`` is still FINALIZED
        # (the reopen does not mutate the parent), so it would happily
        # create another child run.
        old_run = (
            await self.db.execute(
                select(ExtractionRun).where(ExtractionRun.id == run_id).with_for_update()
            )
        ).scalar_one_or_none()
        if old_run is None:
            raise ValueError(f"Run {run_id} not found")
        if old_run.stage != ExtractionRunStage.FINALIZED.value:
            raise CannotReopenRunError(
                f"Run {run_id} is in stage {old_run.stage}; only finalized runs can be reopened."
            )

        existing_child = (
            await self.db.execute(
                select(ExtractionRun)
                .where(
                    ExtractionRun.template_id == old_run.template_id,
                    ExtractionRun.article_id == old_run.article_id,
                    ExtractionRun.parameters["parent_run_id"].astext == str(old_run.id),
                )
                .order_by(ExtractionRun.created_at.desc())
                .limit(1)
            )
        ).scalar_one_or_none()
        if existing_child is not None:
            return existing_child

        # 1. Resolve the active version (lazy-create if the template was
        #    born outside the backfill path).
        version_stmt = select(ExtractionTemplateVersion).where(
            ExtractionTemplateVersion.project_template_id == old_run.template_id,
            ExtractionTemplateVersion.is_active.is_(True),
        )
        version = (await self.db.execute(version_stmt)).scalar_one_or_none()
        if version is None:
            version = await self._snapshot_initial_version(
                project_template_id=old_run.template_id,
                user_id=user_id,
            )

        snapshot = await self._hitl.resolve_snapshot(old_run.project_id, old_run.template_id)

        # 2. Create the new Run carrying the parent reference + a copy of
        #    the original `parameters` so the lineage stays intact.
        carry_over_params = dict(old_run.parameters or {})
        carry_over_params["parent_run_id"] = str(old_run.id)
        carry_over_params["reopened_at"] = datetime.now(UTC).isoformat()
        carry_over_params["reopened_by"] = str(user_id)

        new_run = ExtractionRun(
            project_id=old_run.project_id,
            article_id=old_run.article_id,
            template_id=old_run.template_id,
            kind=old_run.kind,
            version_id=version.id,
            hitl_config_snapshot=snapshot,
            stage=ExtractionRunStage.PENDING.value,
            status=ExtractionRunStatus.PENDING.value,
            parameters=carry_over_params,
            results={},
            created_by=user_id,
        )
        self.db.add(new_run)
        await self.db.flush()
        await self.db.refresh(new_run)

        # 3. Advance pending → proposal so the seed-proposal writes pass
        #    the lifecycle precondition.
        new_run.stage = ExtractionRunStage.PROPOSAL.value
        await self.db.flush()

        # 4. Seed: each PublishedState in the old run becomes a system
        #    ProposalRecord in the new run. The form sees them as the
        #    starting point and the user can keep / edit / reject.
        old_published = (
            (
                await self.db.execute(
                    select(ExtractionPublishedState).where(
                        ExtractionPublishedState.run_id == old_run.id
                    )
                )
            )
            .scalars()
            .all()
        )
        for pub in old_published:
            self.db.add(
                ExtractionProposalRecord(
                    run_id=new_run.id,
                    instance_id=pub.instance_id,
                    field_id=pub.field_id,
                    source=ExtractionProposalSource.SYSTEM.value,
                    proposed_value=pub.value,
                    rationale=(f"Carried over from previous published version (run {old_run.id})."),
                )
            )
        await self.db.flush()

        # 5. Advance proposal → review so the form can immediately
        #    record decisions on the seeded proposals.
        new_run.stage = ExtractionRunStage.REVIEW.value
        await self.db.flush()
        await self.db.refresh(new_run)
        return new_run

    async def _snapshot_initial_version(
        self,
        *,
        project_template_id: UUID,
        user_id: UUID,
    ) -> ExtractionTemplateVersion:
        """Mirror alembic 0010's backfill query for a single template.

        Captures the current entity_types + fields tree as the v=1 snapshot.
        Marked active so subsequent runs reuse it via the ``is_active`` index.
        """
        snapshot_row = await self.db.execute(
            text(
                """
                SELECT jsonb_build_object(
                    'entity_types', COALESCE(
                        (
                            SELECT jsonb_agg(
                                jsonb_build_object(
                                    'id', et.id,
                                    'name', et.name,
                                    'label', et.label,
                                    'parent_entity_type_id', et.parent_entity_type_id,
                                    'cardinality', et.cardinality,
                                    'sort_order', et.sort_order,
                                    'is_required', et.is_required,
                                    'fields', COALESCE(
                                        (
                                            SELECT jsonb_agg(jsonb_build_object(
                                                'id', f.id,
                                                'name', f.name,
                                                'label', f.label,
                                                'field_type', f.field_type,
                                                'is_required', f.is_required,
                                                'allowed_values', f.allowed_values,
                                                'sort_order', f.sort_order
                                            ) ORDER BY f.sort_order)
                                            FROM public.extraction_fields f
                                            WHERE f.entity_type_id = et.id
                                        ),
                                        '[]'::jsonb
                                    )
                                ) ORDER BY et.sort_order
                            )
                            FROM public.extraction_entity_types et
                            WHERE et.project_template_id = :tid
                        ),
                        '[]'::jsonb
                    )
                )
                """
            ),
            {"tid": str(project_template_id)},
        )
        snapshot = snapshot_row.scalar_one()

        # Upsert v=1 idempotently. Three races to handle:
        #
        # 1. Two concurrent first-run requests (issue #54 / #69) — only one
        #    INSERT can win the (project_template_id, version) unique
        #    constraint; the loser must fall through to the SELECT below
        #    and return the winner's row.
        # 2. A v=1 row exists but ``is_active = false`` (issue #65) — the
        #    plain INSERT collides with the same unique constraint; we
        #    instead reactivate it so the caller has an active version to
        #    attach to its new Run.
        # 3. A v=1 row already exists and is active — the upsert leaves it
        #    untouched and we just re-fetch it.
        now = datetime.now(UTC)
        upsert_stmt = (
            pg_insert(ExtractionTemplateVersion)
            .values(
                project_template_id=project_template_id,
                version=1,
                schema_=snapshot,
                published_at=now,
                published_by=user_id,
                is_active=True,
            )
            .on_conflict_do_update(
                constraint="uq_extraction_template_versions_template_version",
                set_={"is_active": True},
            )
        )
        await self.db.execute(upsert_stmt)
        await self.db.flush()

        version_stmt = select(ExtractionTemplateVersion).where(
            ExtractionTemplateVersion.project_template_id == project_template_id,
            ExtractionTemplateVersion.version == 1,
        )
        version = (await self.db.execute(version_stmt)).scalar_one()
        return version
