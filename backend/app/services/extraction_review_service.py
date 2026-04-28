"""Service: validate reviewer decisions, write append-only, upsert ReviewerState."""

from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.extraction import ExtractionRun, ExtractionRunStage
from app.models.extraction_workflow import (
    ExtractionReviewerDecision,
    ExtractionReviewerDecisionType,
    ExtractionReviewerState,
)
from app.repositories.extraction_reviewer_decision_repository import (
    ExtractionReviewerDecisionRepository,
)
from app.repositories.extraction_reviewer_state_repository import (
    ExtractionReviewerStateRepository,
)


class InvalidDecisionError(Exception):
    """Raised when a reviewer decision violates business rules."""


class ExtractionReviewService:
    """Append-only reviewer decisions + materialized ReviewerState upsert."""

    def __init__(self, db: AsyncSession):
        self.db = db
        self._decisions = ExtractionReviewerDecisionRepository(db)
        self._states = ExtractionReviewerStateRepository(db)

    async def record_decision(
        self,
        *,
        run_id: UUID,
        instance_id: UUID,
        field_id: UUID,
        reviewer_id: UUID,
        decision: ExtractionReviewerDecisionType | str,
        proposal_record_id: UUID | None = None,
        value: dict | None = None,
        rationale: str | None = None,
    ) -> ExtractionReviewerDecision:
        run = await self.db.get(ExtractionRun, run_id)
        if run is None:
            raise InvalidDecisionError(f"Run {run_id} not found")
        if run.stage != ExtractionRunStage.REVIEW.value:
            raise InvalidDecisionError(
                f"Cannot record decision: run stage is {run.stage}, not 'review'"
            )

        decision_value = (
            decision.value
            if isinstance(decision, ExtractionReviewerDecisionType)
            else decision
        )
        if decision_value == "accept_proposal" and proposal_record_id is None:
            raise InvalidDecisionError(
                "decision='accept_proposal' requires proposal_record_id"
            )
        if decision_value == "edit" and value is None:
            raise InvalidDecisionError("decision='edit' requires value")

        record = ExtractionReviewerDecision(
            run_id=run_id,
            instance_id=instance_id,
            field_id=field_id,
            reviewer_id=reviewer_id,
            decision=decision_value,
            proposal_record_id=proposal_record_id,
            value=value,
            rationale=rationale,
        )
        await self._decisions.add(record)
        await self._states.upsert(
            run_id=run_id,
            reviewer_id=reviewer_id,
            instance_id=instance_id,
            field_id=field_id,
            current_decision_id=record.id,
        )
        return record

    async def get_reviewer_state(
        self,
        *,
        run_id: UUID,
        reviewer_id: UUID,
        instance_id: UUID,
        field_id: UUID,
    ) -> ExtractionReviewerState | None:
        return await self._states.get(
            run_id=run_id,
            reviewer_id=reviewer_id,
            instance_id=instance_id,
            field_id=field_id,
        )
