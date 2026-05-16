"""Service: consensus decisions + publish with optimistic concurrency."""

from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.extraction import ExtractionRun, ExtractionRunStage
from app.models.extraction_workflow import (
    ExtractionConsensusDecision,
    ExtractionConsensusMode,
    ExtractionPublishedState,
    ExtractionReviewerDecisionType,
)
from app.repositories.extraction_consensus_decision_repository import (
    ExtractionConsensusDecisionRepository,
)
from app.repositories.extraction_published_state_repository import (
    ExtractionPublishedStateRepository,
)
from app.repositories.extraction_reviewer_decision_repository import (
    ExtractionReviewerDecisionRepository,
)
from app.services.coordinate_coherence import assert_coords_coherent


class InvalidConsensusError(Exception):
    """Raised when a consensus decision violates business rules."""


class OptimisticConcurrencyError(Exception):
    """Raised when expected_version doesn't match the published state."""


class ExtractionConsensusService:
    """Append-only consensus + canonical PublishedState writes."""

    def __init__(self, db: AsyncSession):
        self.db = db
        self._consensus = ExtractionConsensusDecisionRepository(db)
        self._published = ExtractionPublishedStateRepository(db)
        self._decisions = ExtractionReviewerDecisionRepository(db)

    async def record_consensus(
        self,
        *,
        run_id: UUID,
        instance_id: UUID,
        field_id: UUID,
        consensus_user_id: UUID,
        mode: ExtractionConsensusMode | str,
        selected_decision_id: UUID | None = None,
        value: dict | None = None,
        rationale: str | None = None,
    ) -> tuple[ExtractionConsensusDecision, ExtractionPublishedState]:
        run = await self.db.get(ExtractionRun, run_id)
        if run is None:
            raise InvalidConsensusError(f"Run {run_id} not found")
        if run.stage != ExtractionRunStage.CONSENSUS.value:
            raise InvalidConsensusError(
                f"Cannot record consensus: run stage is {run.stage}, not 'consensus'"
            )

        await assert_coords_coherent(
            self.db,
            run_id=run_id,
            instance_id=instance_id,
            field_id=field_id,
        )

        mode_value = mode.value if isinstance(mode, ExtractionConsensusMode) else mode

        if mode_value == "select_existing" and selected_decision_id is None:
            raise InvalidConsensusError("mode='select_existing' requires selected_decision_id")
        if mode_value == "manual_override" and (value is None or rationale is None):
            raise InvalidConsensusError("mode='manual_override' requires both value and rationale")

        # Resolve value to publish: from selected reviewer decision or from manual override
        if mode_value == "select_existing":
            decisions = await self._decisions.list_by_run(run_id)
            selected = next((d for d in decisions if d.id == selected_decision_id), None)
            if selected is None:
                raise InvalidConsensusError(
                    f"selected_decision_id {selected_decision_id} not in run {run_id}"
                )
            # Coordinate guard: selected decision must target the same (instance, field).
            if selected.instance_id != instance_id or selected.field_id != field_id:
                raise InvalidConsensusError(
                    f"selected_decision_id {selected_decision_id} belongs to "
                    f"(instance={selected.instance_id}, field={selected.field_id}), "
                    f"not (instance={instance_id}, field={field_id})"
                )
            # Reject decisions carry no publishable value; require manual_override instead.
            if selected.decision == ExtractionReviewerDecisionType.REJECT.value:
                raise InvalidConsensusError(
                    f"selected_decision_id {selected_decision_id} is a 'reject' decision "
                    "and carries no publishable value; use mode='manual_override' instead."
                )
            published_value = selected.value or {}
            # accept_proposal decisions don't carry a value column directly; in that
            # case we fall back to the proposal's value via the proposal_record_id.
            if not published_value and selected.proposal_record_id:
                from app.repositories.extraction_proposal_repository import (
                    ExtractionProposalRepository,
                )

                proposal_repo = ExtractionProposalRepository(self.db)
                proposals = await proposal_repo.list_by_run(run_id)
                proposal = next(
                    (p for p in proposals if p.id == selected.proposal_record_id),
                    None,
                )
                if proposal is None:
                    raise InvalidConsensusError(
                        f"Proposal {selected.proposal_record_id} referenced by "
                        f"decision {selected_decision_id} not found in run {run_id}"
                    )
                published_value = proposal.proposed_value
            # Final guard: never publish an empty value silently.
            if not published_value:
                raise InvalidConsensusError(
                    f"selected_decision_id {selected_decision_id} resolved to an empty "
                    "value; use mode='manual_override' to publish an explicit value."
                )
        else:  # manual_override
            published_value = value or {}

        consensus_record = ExtractionConsensusDecision(
            run_id=run_id,
            instance_id=instance_id,
            field_id=field_id,
            consensus_user_id=consensus_user_id,
            mode=mode_value,
            selected_decision_id=selected_decision_id,
            value=value,
            rationale=rationale,
        )
        await self._consensus.add(consensus_record)

        published = await self._publish_internal(
            run_id=run_id,
            instance_id=instance_id,
            field_id=field_id,
            value=published_value,
            published_by=consensus_user_id,
        )
        return consensus_record, published

    async def publish(
        self,
        *,
        run_id: UUID,
        instance_id: UUID,
        field_id: UUID,
        value: dict,
        published_by: UUID,
        expected_version: int,
    ) -> ExtractionPublishedState:
        run = await self.db.get(ExtractionRun, run_id)
        if run is None:
            raise InvalidConsensusError(f"Run {run_id} not found")
        if run.stage != ExtractionRunStage.CONSENSUS.value:
            raise InvalidConsensusError(
                f"Cannot publish: run stage is {run.stage!r}, not 'consensus'"
            )
        rowcount = await self._published.update_with_optimistic_lock(
            run_id=run_id,
            instance_id=instance_id,
            field_id=field_id,
            value=value,
            published_by=published_by,
            expected_version=expected_version,
        )
        if rowcount == 0:
            raise OptimisticConcurrencyError(
                f"expected_version={expected_version} did not match current state"
            )
        existing = await self._published.get(
            run_id=run_id, instance_id=instance_id, field_id=field_id
        )
        if existing is None:
            raise RuntimeError(
                f"PublishedState vanished after update for {run_id}/{instance_id}/{field_id}"
            )
        return existing

    async def _publish_internal(
        self,
        *,
        run_id: UUID,
        instance_id: UUID,
        field_id: UUID,
        value: dict,
        published_by: UUID,
    ) -> ExtractionPublishedState:
        # Race-free first publish: INSERT ... ON CONFLICT DO NOTHING. If a row
        # was inserted, we're done. If a concurrent caller already inserted,
        # this returns None and we fall through to the optimistic-lock UPDATE.
        inserted = await self._published.insert_first_if_absent(
            run_id=run_id,
            instance_id=instance_id,
            field_id=field_id,
            value=value,
            published_by=published_by,
        )
        if inserted is not None:
            return inserted
        existing = await self._published.get(
            run_id=run_id, instance_id=instance_id, field_id=field_id
        )
        if existing is None:
            # Should be impossible: ON CONFLICT means a row exists.
            raise OptimisticConcurrencyError(
                f"PublishedState insert conflicted but row not visible for "
                f"{run_id}/{instance_id}/{field_id}"
            )
        rowcount = await self._published.update_with_optimistic_lock(
            run_id=run_id,
            instance_id=instance_id,
            field_id=field_id,
            value=value,
            published_by=published_by,
            expected_version=existing.version,
        )
        if rowcount == 0:
            raise OptimisticConcurrencyError(
                f"PublishedState changed during consensus write for {run_id}/{instance_id}/{field_id}"
            )
        latest = await self._published.get(
            run_id=run_id, instance_id=instance_id, field_id=field_id
        )
        if latest is None:
            raise RuntimeError(
                f"PublishedState vanished after update for {run_id}/{instance_id}/{field_id}"
            )
        return latest
