"""Service: validate + record proposals append-only."""

from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.extraction import ExtractionRun, ExtractionRunStage
from app.models.extraction_workflow import (
    ExtractionProposalRecord,
    ExtractionProposalSource,
)
from app.repositories.extraction_proposal_repository import (
    ExtractionProposalRepository,
)


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
        proposed_value: dict,
        source_user_id: UUID | None = None,
        confidence_score: float | None = None,
        rationale: str | None = None,
    ) -> ExtractionProposalRecord:
        run = await self.db.get(ExtractionRun, run_id)
        if run is None:
            raise InvalidProposalError(f"Run {run_id} not found")
        if run.stage != ExtractionRunStage.PROPOSAL.value:
            raise InvalidProposalError(
                f"Cannot record proposal: run stage is {run.stage}, not 'proposal'"
            )

        source_value = source.value if isinstance(source, ExtractionProposalSource) else source
        if source_value == "human" and source_user_id is None:
            raise InvalidProposalError("source='human' requires source_user_id")

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
