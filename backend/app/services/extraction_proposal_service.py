"""Service: validate + record proposals append-only."""

from typing import Any
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.extraction import ExtractionRunStage
from app.models.extraction_workflow import (
    ExtractionProposalRecord,
    ExtractionProposalSource,
)
from app.repositories.extraction_proposal_repository import (
    ExtractionProposalRepository,
)
from app.services._extraction_run_lock import load_run_for_update
from app.services.coordinate_coherence import assert_coords_coherent


class InvalidProposalError(Exception):
    """Raised when a proposal violates business rules (stage / source / coords)."""


class ExtractionProposalService:
    """Append-only proposal writes with rule validation."""

    def __init__(self, db: AsyncSession):
        self.db = db
        self._repo = ExtractionProposalRepository(db)

    async def record_proposal(
        self,
        *,
        run_id: UUID,
        instance_id: UUID,
        field_id: UUID,
        source: ExtractionProposalSource | str,
        proposed_value: dict[str, Any],
        source_user_id: UUID | None = None,
        confidence_score: float | None = None,
        rationale: str | None = None,
    ) -> ExtractionProposalRecord:
        run = await load_run_for_update(self.db, run_id)
        if run is None:
            raise InvalidProposalError(f"Run {run_id} not found")

        source_value = source.value if isinstance(source, ExtractionProposalSource) else source
        # Stage gate is source-specific AND kind-aware:
        #
        # * ``ai`` proposals only make sense in PROPOSAL — once the run
        #   has advanced past it the AI phase is conceptually closed.
        # * ``human`` / ``system`` proposals at REVIEW are kind-gated
        #   (Layer 1b of the multi-reviewer blind fix):
        #     - kind='quality_assessment': allowed. QA's publish flow
        #       advances proposal -> review unconditionally; an
        #       interrupted downstream consensus call leaves the run
        #       parked at REVIEW and the user must be able to keep
        #       typing for the retry.
        #     - kind='extraction': REJECTED. Reviewer writes during
        #       REVIEW must land as per-user ``ReviewerDecision`` rows
        #       so the blind-review contract holds (``loadValuesForUser``
        #       filters by reviewer_id). Allowing ``human`` proposals
        #       here opens the leak Layer 1 patched on the read side;
        #       this gate closes it on the write side so a frontend
        #       bypass (curl, agent client) cannot resurrect the bug.
        if source_value == "ai" or run.kind == "extraction":
            allowed_stages = {ExtractionRunStage.PROPOSAL.value}
        else:
            allowed_stages = {
                ExtractionRunStage.PROPOSAL.value,
                ExtractionRunStage.REVIEW.value,
            }
        if run.stage not in allowed_stages:
            raise InvalidProposalError(
                f"Cannot record proposal: kind={run.kind} run stage is "
                f"{run.stage}, not in {sorted(allowed_stages)}. "
                f"For kind='extraction', writes at REVIEW must go through "
                f"/decisions (ReviewerDecision), not /proposals."
            )

        await assert_coords_coherent(
            self.db,
            run_id=run_id,
            instance_id=instance_id,
            field_id=field_id,
        )

        if source_value == "human" and source_user_id is None:
            raise InvalidProposalError("source='human' requires source_user_id")

        # Idempotent re-record: a client replaying an unchanged value (form
        # remount, debounce double-fire, retry) must not append a duplicate
        # row. The audit trail captures value *changes*, not redundant
        # replays. A genuinely changed value still appends.
        latest = await self._repo.get_latest_for_coord(
            run_id, instance_id, field_id, source_value, source_user_id
        )
        if latest is not None and latest.proposed_value == proposed_value:
            return latest

        record = ExtractionProposalRecord(
            run_id=run_id,
            instance_id=instance_id,
            field_id=field_id,
            source=source_value,
            source_user_id=source_user_id,
            proposed_value=proposed_value,
            confidence_score=confidence_score,
            rationale=rationale,
        )
        return await self._repo.add(record)

    async def list_by_item(
        self,
        run_id: UUID,
        instance_id: UUID,
        field_id: UUID,
    ) -> list[ExtractionProposalRecord]:
        return await self._repo.list_by_item(run_id, instance_id, field_id)

    async def list_by_run(self, run_id: UUID) -> list[ExtractionProposalRecord]:
        return await self._repo.list_by_run(run_id)
