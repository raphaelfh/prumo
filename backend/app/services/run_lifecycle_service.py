"""Run lifecycle service: create + advance stage with precondition checks."""

from datetime import UTC, datetime
from typing import Any
from uuid import UUID

from sqlalchemy import func, select, text
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.article import Article
from app.models.extraction import (
    ExtractionRun,
    ExtractionRunStage,
    ExtractionRunStatus,
    ProjectExtractionTemplate,
)
from app.models.extraction_versioning import ExtractionTemplateVersion
from app.models.extraction_workflow import (
    ExtractionConsensusDecision,
    ExtractionProposalRecord,
    ExtractionProposalSource,
    ExtractionPublishedState,
    ExtractionReviewerDecision,
    ExtractionReviewerDecisionType,
    ExtractionReviewerState,
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


class CreateRunInputError(Exception):
    """Raised when create_run receives cross-project or otherwise invalid ids."""


class EmptyFinalizeError(InvalidStageTransitionError):
    """Raised when a Run cannot be finalized because it has no consensus
    decisions. A FINALIZED Run is meant to represent "the canonical
    PublishedState is set" — finalizing without any consensus decision
    produces an empty-but-published Run, which is logically incoherent
    and breaks downstream consumers that assume PublishedState rows exist.
    """


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
        # BOLA defense: verify both the article and the template belong to the
        # requested project before materialising any state. Returns the same
        # error message for "does not exist" and "wrong project" to avoid
        # leaking which UUIDs are valid in other projects.
        article = await self.db.get(Article, article_id)
        if article is None or article.project_id != project_id:
            raise CreateRunInputError(
                f"article {article_id} does not belong to project {project_id}"
            )

        # Resolve template (for kind) — must exist and belong to the same project
        template = await self.db.get(ProjectExtractionTemplate, project_template_id)
        if template is None or template.project_id != project_id:
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
        if target == ExtractionRunStage.FINALIZED.value:
            # Invariant: a FINALIZED run must carry at least one published
            # value, which in turn requires at least one ConsensusDecision
            # (manual_override or select_existing). Without this the UI
            # shows a "Published" badge over a run that has nothing to
            # display, and downstream consumers that join on
            # ExtractionPublishedState return empty sets without warning.
            consensus_count = (
                await self.db.execute(
                    select(func.count())
                    .select_from(ExtractionConsensusDecision)
                    .where(ExtractionConsensusDecision.run_id == run_id)
                )
            ).scalar_one()
            if consensus_count == 0:
                raise EmptyFinalizeError(
                    f"Cannot finalize run {run_id}: no consensus decisions recorded. "
                    "Resolve at least one field before finalizing."
                )
        run.stage = target
        if target == ExtractionRunStage.CANCELLED.value:
            run.status = ExtractionRunStatus.FAILED.value
        elif target == ExtractionRunStage.FINALIZED.value:
            run.status = ExtractionRunStatus.COMPLETED.value
        await self.db.flush()

        # Invariant I-1: in REVIEW+, every human proposal must have a
        # corresponding reviewer_decision so the form's per-user read can
        # render the typed value. The autosave path writes proposals
        # regardless of stage, and AI-extraction services advance to
        # REVIEW without round-tripping through a "confirm" step — so
        # any human input the user typed before the advance would be
        # orphaned without this materialization step.
        if target == ExtractionRunStage.REVIEW.value:
            await self._materialize_human_decisions(run_id)

        await self.db.refresh(run)
        return run

    async def _materialize_human_decisions(self, run_id: UUID) -> None:
        """For each (instance, field) on this run that has a human
        ``ProposalRecord`` (``source='human'``, ``source_user_id`` set)
        but no existing ``ReviewerDecision`` for that source user,
        insert a ``decision='accept_proposal'`` row pointing at the
        latest proposal and upsert the matching ``ReviewerState``.

        Idempotent: skips any (run, instance, field, reviewer) triple
        that already has a decision row, so retries / re-advances do
        not duplicate.

        AI proposals are NOT materialized — reviewers must explicitly
        accept/edit/reject them. The premise of the auto-materialize is
        "user typed = user committed"; AI output has no analogous
        commitment.
        """
        # Latest human proposal per (instance, field, source_user_id).
        # DISTINCT ON keeps the newest row per coord, since
        # extraction_proposal_records is append-only and "the latest
        # typed value wins".
        latest_proposals = (
            await self.db.execute(
                select(ExtractionProposalRecord)
                .where(
                    ExtractionProposalRecord.run_id == run_id,
                    ExtractionProposalRecord.source
                    == ExtractionProposalSource.HUMAN.value,
                    ExtractionProposalRecord.source_user_id.is_not(None),
                )
                .order_by(
                    ExtractionProposalRecord.instance_id,
                    ExtractionProposalRecord.field_id,
                    ExtractionProposalRecord.source_user_id,
                    ExtractionProposalRecord.created_at.desc(),
                )
                .distinct(
                    ExtractionProposalRecord.instance_id,
                    ExtractionProposalRecord.field_id,
                    ExtractionProposalRecord.source_user_id,
                )
            )
        ).scalars().all()

        if not latest_proposals:
            return

        for proposal in latest_proposals:
            existing = (
                await self.db.execute(
                    select(ExtractionReviewerDecision.id)
                    .where(
                        ExtractionReviewerDecision.run_id == run_id,
                        ExtractionReviewerDecision.instance_id == proposal.instance_id,
                        ExtractionReviewerDecision.field_id == proposal.field_id,
                        ExtractionReviewerDecision.reviewer_id == proposal.source_user_id,
                    )
                    .limit(1)
                )
            ).scalar_one_or_none()
            if existing is not None:
                continue

            decision = ExtractionReviewerDecision(
                run_id=run_id,
                reviewer_id=proposal.source_user_id,
                instance_id=proposal.instance_id,
                field_id=proposal.field_id,
                decision=ExtractionReviewerDecisionType.ACCEPT_PROPOSAL.value,
                proposal_record_id=proposal.id,
                value=proposal.proposed_value,
            )
            self.db.add(decision)
            await self.db.flush()

            # Upsert the materialized reviewer_state pointer so subsequent
            # reads (including the form's loadValuesForUser) see this
            # decision as current. The unique key is
            # (run_id, reviewer_id, instance_id, field_id).
            stmt = (
                pg_insert(ExtractionReviewerState)
                .values(
                    run_id=run_id,
                    reviewer_id=proposal.source_user_id,
                    instance_id=proposal.instance_id,
                    field_id=proposal.field_id,
                    current_decision_id=decision.id,
                )
                .on_conflict_do_update(
                    index_elements=[
                        "run_id",
                        "reviewer_id",
                        "instance_id",
                        "field_id",
                    ],
                    set_={"current_decision_id": decision.id},
                )
            )
            await self.db.execute(stmt)
        await self.db.flush()

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

        # Idempotency: if a live (non-cancelled) child already exists for
        # this parent, return it instead of forking a second revision. A
        # cancelled child is NOT a blocker — the user abandoned that attempt
        # and must be able to start a fresh revision from the original parent.
        existing_child = (
            await self.db.execute(
                select(ExtractionRun)
                .where(
                    ExtractionRun.template_id == old_run.template_id,
                    ExtractionRun.article_id == old_run.article_id,
                    ExtractionRun.parameters["parent_run_id"].astext == str(old_run.id),
                    ExtractionRun.stage != ExtractionRunStage.CANCELLED.value,
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
