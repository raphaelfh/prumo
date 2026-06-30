"""Run lifecycle service: create + advance stage with precondition checks."""

import json
from datetime import UTC, datetime
from typing import Any
from uuid import UUID

from sqlalchemy import and_, func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.article import Article
from app.models.extraction import (
    ExtractionInstance,
    ExtractionRun,
    ExtractionRunStage,
    ExtractionRunStatus,
    ProjectExtractionTemplate,
    TemplateKind,
)
from app.models.extraction_versioning import ExtractionTemplateVersion
from app.models.extraction_workflow import (
    ExtractionConsensusDecision,
    ExtractionConsensusMode,
    ExtractionProposalRecord,
    ExtractionProposalSource,
    ExtractionPublishedState,
    ExtractionReviewerDecision,
    ExtractionReviewerDecisionType,
    ExtractionReviewerState,
)
from app.services._extraction_run_lock import load_run_for_update
from app.services.extraction_consensus_service import ExtractionConsensusService
from app.services.extraction_snapshot import build_template_version_snapshot
from app.services.hitl_config_service import HitlConfigService
from app.services.value_semantics import is_value_filled


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


class IncompleteFinalizeError(InvalidStageTransitionError):
    """Raised when a Run cannot be finalized because one or more REQUIRED
    fields on an existing instance have no resolved value.

    This is the authoritative server-side mirror of the frontend
    completeness gate (``frontend/lib/extraction/progress.ts``): a run may
    not publish while required data is missing. "Resolved value" means a
    non-empty published value OR a non-empty current reviewer decision
    (``accept_proposal`` resolves through the referenced proposal;
    ``reject`` counts as unfilled). Completeness is measured per EXISTING
    instance (no phantom instances), so an optional many-cardinality entity
    type with zero instances — e.g. CHARMS ``prediction_models`` with no
    models — does not block. See ADR 0009.
    """


# Allowed transitions: from -> set of valid target stages
_ALLOWED_TRANSITIONS: dict[str, set[str]] = {
    ExtractionRunStage.PENDING.value: {
        ExtractionRunStage.EXTRACT.value,
        ExtractionRunStage.CANCELLED.value,
    },
    ExtractionRunStage.EXTRACT.value: {
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
            # Completeness gate (extraction only): every required field of
            # every existing instance must carry a resolved value before
            # publishing. Mirrors the frontend progress metric on the
            # authoritative side. Quality-assessment runs keep the
            # consensus-only rule above — their finalize semantics are out of
            # scope for this decision. See ADR 0009.
            if run.kind == TemplateKind.EXTRACTION.value:
                missing = await self._find_unfilled_required_coords(run)
                if missing:
                    raise IncompleteFinalizeError(
                        f"Cannot finalize run {run_id}: {len(missing)} required "
                        "field(s) have no resolved value. Fill every required "
                        "field before finalizing."
                    )
        run.stage = target
        if target == ExtractionRunStage.CANCELLED.value:
            run.status = ExtractionRunStatus.FAILED.value
        elif target == ExtractionRunStage.FINALIZED.value:
            run.status = ExtractionRunStatus.COMPLETED.value
        await self.db.flush()
        await self.db.refresh(run)
        return run

    async def approve_and_finalize(
        self, *, run_id: UUID, user_id: UUID
    ) -> tuple[ExtractionRun, int]:
        """Atomically publish every agreed-but-unpublished coord, then finalize.

        The single-action "Approve & finalize" for extraction: each existing-instance
        × field coord that has a single unambiguous resolved reviewer value and no
        ``PublishedState`` yet is published via
        ``ExtractionConsensusService.record_consensus`` (a ``manual_override``), then the
        run advances CONSENSUS → FINALIZED. Because the publishes and the finalize gates
        run in the SAME transaction, ``EmptyFinalizeError`` and ``IncompleteFinalizeError``
        become satisfiable naturally (the no-divergence dead-end is gone). Coords whose
        reviewers still diverge unresolved are rejected so the manager resolves them
        first via the per-coord consensus endpoint. Extraction-only — QA publishes via
        its own flow.
        """
        run = await load_run_for_update(self.db, run_id)
        if run is None:
            raise ValueError(f"Run {run_id} not found")
        if run.kind != TemplateKind.EXTRACTION.value:
            raise InvalidStageTransitionError(
                "approve_and_finalize applies to extraction runs only; "
                "quality-assessment runs publish via their own flow."
            )
        if run.stage != ExtractionRunStage.CONSENSUS.value:
            raise InvalidStageTransitionError(
                f"approve_and_finalize requires stage 'consensus', got '{run.stage}'."
            )
        to_publish, unresolved = await self._agreed_unpublished_values(run)
        if unresolved:
            raise InvalidStageTransitionError(
                f"Cannot approve run {run_id}: {len(unresolved)} field(s) still diverge. "
                "Resolve each diverging field before finalizing."
            )
        consensus = ExtractionConsensusService(self.db)
        for (instance_id, field_id), envelope in to_publish.items():
            await consensus.record_consensus(
                run_id=run_id,
                instance_id=instance_id,
                field_id=field_id,
                consensus_user_id=user_id,
                mode=ExtractionConsensusMode.MANUAL_OVERRIDE,
                value=envelope,
                rationale="Approved: reviewers agree (Phase 2 approve-all).",
            )
        finalized = await self.advance_stage(
            run_id=run_id, target_stage=ExtractionRunStage.FINALIZED, user_id=user_id
        )
        return finalized, len(to_publish)

    async def _agreed_unpublished_values(
        self, run: ExtractionRun
    ) -> tuple[dict[tuple[UUID, UUID], Any], list[tuple[UUID, UUID]]]:
        """Per existing-instance × field coord with NO ``PublishedState`` yet: the single
        agreed value envelope to publish, plus the coords that still diverge unresolved.

        Distinctness is compared on the FULL value envelope (Phase B, decision G):
        ``{"value":"5","unit":"mg"}`` and ``{"value":"5","unit":"g"}`` are a conflict, not
        agreement — keying on the unit-stripped scalar used to publish one unit silently.
        The original envelope is published verbatim into ``PublishedState.value``. Mirrors
        ``_filled_coords`` resolution (``reject`` skipped; ``accept_proposal`` resolves
        through the referenced proposal). One distinct envelope → publishable; ≥2 →
        unresolved divergence; coords already carrying a ``PublishedState``
        (manager-resolved) are skipped.
        """
        published_coords = {
            (instance_id, field_id)
            for instance_id, field_id in (
                await self.db.execute(
                    select(
                        ExtractionPublishedState.instance_id,
                        ExtractionPublishedState.field_id,
                    ).where(ExtractionPublishedState.run_id == run.id)
                )
            ).all()
        }

        # One pass over each reviewer's current value: first distinct value per
        # unpublished coord is the publish candidate; a second DIFFERENT value
        # (compared on the FULL envelope, so a unit/structured difference counts)
        # demotes the coord to unresolved.
        to_publish: dict[tuple[UUID, UUID], Any] = {}
        seen_key: dict[tuple[UUID, UUID], str] = {}
        unresolved: set[tuple[UUID, UUID]] = set()
        for instance_id, field_id, resolved in await self._resolved_reviewer_values(run.id):
            coord = (instance_id, field_id)
            if coord in published_coords or coord in unresolved:
                continue
            key = json.dumps(resolved, sort_keys=True, default=str)
            if coord not in seen_key:
                seen_key[coord] = key
                to_publish[coord] = resolved
            elif seen_key[coord] != key:
                del to_publish[coord]
                unresolved.add(coord)
        return to_publish, list(unresolved)

    async def _find_unfilled_required_coords(self, run: ExtractionRun) -> list[tuple[UUID, UUID]]:
        """Return ``(instance_id, field_id)`` for every required field that
        lacks a resolved value on this run.

        Required-field metadata is read from the run's frozen template
        version snapshot (so a mid-run template edit cannot change the gate),
        and measured per EXISTING instance — entity types with no instances
        contribute nothing, which is how an optional many-cardinality entity
        type (e.g. CHARMS ``prediction_models`` with zero models) stays
        finalizable. An empty list means "complete".
        """
        version = await self.db.get(ExtractionTemplateVersion, run.version_id)
        schema = (version.schema_ if version is not None else None) or {}
        required_by_entity: dict[UUID, set[UUID]] = {}
        for et in schema.get("entity_types", []):
            req = {UUID(str(f["id"])) for f in et.get("fields", []) if f.get("is_required")}
            if req:
                required_by_entity[UUID(str(et["id"]))] = req
        if not required_by_entity:
            return []

        instance_rows = (
            await self.db.execute(
                select(
                    ExtractionInstance.id,
                    ExtractionInstance.entity_type_id,
                ).where(
                    ExtractionInstance.article_id == run.article_id,
                    ExtractionInstance.template_id == run.template_id,
                )
            )
        ).all()

        filled = await self._filled_coords(run.id)

        missing: list[tuple[UUID, UUID]] = []
        for instance_id, entity_type_id in instance_rows:
            for field_id in required_by_entity.get(entity_type_id, set()):
                if (instance_id, field_id) not in filled:
                    missing.append((instance_id, field_id))
        return missing

    async def _filled_coords(self, run_id: UUID) -> set[tuple[UUID, UUID]]:
        """The set of ``(instance_id, field_id)`` coords on a run that hold a
        resolved, non-empty value — the union of published (consensus)
        values and each reviewer's current decision.

        ``accept_proposal`` decisions may carry their value on the referenced
        proposal rather than the decision row, so those resolve through a
        proposal-value map. ``reject`` decisions never count as filled.
        """
        filled: set[tuple[UUID, UUID]] = set()

        published_rows = (
            await self.db.execute(
                select(
                    ExtractionPublishedState.instance_id,
                    ExtractionPublishedState.field_id,
                    ExtractionPublishedState.value,
                ).where(ExtractionPublishedState.run_id == run_id)
            )
        ).all()
        for instance_id, field_id, value in published_rows:
            if is_value_filled(value):
                filled.add((instance_id, field_id))

        for instance_id, field_id, _resolved in await self._resolved_reviewer_values(run_id):
            filled.add((instance_id, field_id))

        return filled

    async def _resolved_reviewer_values(self, run_id: UUID) -> list[tuple[UUID, UUID, Any]]:
        """Each reviewer's current non-empty resolved value envelope per coord:
        ``(instance_id, field_id, envelope)``.

        ``reject`` decisions are skipped; an ``accept_proposal`` whose decision row
        carries no value resolves through the referenced proposal's
        ``proposed_value``; empty values (``None`` / ``""`` after one envelope peel)
        are dropped. Shared by the finalize completeness gate (``_filled_coords``)
        and the approve-all resolver (``_agreed_unpublished_values``) so the
        resolution semantics live in one place.
        """
        proposal_values: dict[UUID, Any] = dict(
            (
                await self.db.execute(
                    select(
                        ExtractionProposalRecord.id,
                        ExtractionProposalRecord.proposed_value,
                    ).where(ExtractionProposalRecord.run_id == run_id)
                )
            ).all()
        )

        state_rows = (
            await self.db.execute(
                select(
                    ExtractionReviewerState.instance_id,
                    ExtractionReviewerState.field_id,
                    ExtractionReviewerDecision.decision,
                    ExtractionReviewerDecision.value,
                    ExtractionReviewerDecision.proposal_record_id,
                )
                .join(
                    ExtractionReviewerDecision,
                    and_(
                        ExtractionReviewerDecision.run_id == ExtractionReviewerState.run_id,
                        ExtractionReviewerDecision.id
                        == ExtractionReviewerState.current_decision_id,
                    ),
                )
                .where(ExtractionReviewerState.run_id == run_id)
            )
        ).all()

        resolved_values: list[tuple[UUID, UUID, Any]] = []
        for instance_id, field_id, decision, value, proposal_record_id in state_rows:
            if decision == ExtractionReviewerDecisionType.REJECT.value:
                continue
            resolved = value
            if resolved is None and proposal_record_id is not None:
                resolved = proposal_values.get(proposal_record_id)
            if is_value_filled(resolved):
                resolved_values.append((instance_id, field_id, resolved))
        return resolved_values

    async def reopen_run(
        self,
        *,
        run_id: UUID,
        user_id: UUID,
    ) -> tuple[ExtractionRun, bool]:
        """Create a new Run derived from a finalized one, pre-populated with
        the previous published values as ``source='system'`` proposals.

        Returns ``(run, created)``: ``created`` is False when an existing live
        child is resumed idempotently (the endpoint maps that to HTTP 200) and
        True when a fresh revision is forked (HTTP 201).

        Implements the "Option C" reopen UX: each revision is its own
        immutable Run, linked to the parent via
        ``parameters.parent_run_id``. The previous PublishedState rows
        are not mutated; the new Run will publish its own (with version+1
        per coordinate via the normal consensus flow).

        The new Run lands in stage=EXTRACT so the form can immediately
        record decisions over the seeded proposals.
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

        # Idempotency: if a live (non-cancelled, non-finalized) child already
        # exists for this parent, return it instead of forking a second
        # revision. Two stages do NOT count as a blocking live child:
        #   - cancelled: the user abandoned that attempt and must be able to
        #     start a fresh revision from the original parent.
        #   - finalized: the previous reopen was completed and re-finalized, so
        #     the caller is asking for a NEW editable revision. Returning the
        #     finalized child here would hand back a read-only run (the reopen
        #     button would appear to do nothing).
        existing_child = (
            await self.db.execute(
                select(ExtractionRun)
                .where(
                    ExtractionRun.template_id == old_run.template_id,
                    ExtractionRun.article_id == old_run.article_id,
                    ExtractionRun.parameters["parent_run_id"].astext == str(old_run.id),
                    ExtractionRun.stage.not_in(
                        [
                            ExtractionRunStage.CANCELLED.value,
                            ExtractionRunStage.FINALIZED.value,
                        ]
                    ),
                )
                .order_by(ExtractionRun.created_at.desc())
                .limit(1)
            )
        ).scalar_one_or_none()
        if existing_child is not None:
            return existing_child, False

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

        # 3. Seed: each PublishedState in the old run becomes a system
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

        # 4. Land the child run in EXTRACT so the form can immediately record decisions.
        new_run.stage = ExtractionRunStage.EXTRACT.value
        await self.db.flush()
        await self.db.refresh(new_run)
        return new_run, True

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
        snapshot = await build_template_version_snapshot(self.db, project_template_id)

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
