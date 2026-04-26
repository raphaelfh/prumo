"""Service layer for proposal generation kickoff."""

from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.services.evaluation_observability_service import log_evaluation_event
from app.services.evaluation_run_service import EvaluationRunService


class EvaluationProposalService:
    """Coordinates asynchronous proposal generation flow."""

    def __init__(self, db: AsyncSession, user_id: UUID, trace_id: str):
        self.db = db
        self.user_id = user_id
        self.trace_id = trace_id
        self._run_service = EvaluationRunService(db=db, user_id=user_id, trace_id=trace_id)

    async def kickoff_for_run(self, run_id: UUID) -> bool:
        await self._run_service.move_to_active_proposal(run_id)
        # Queue integration with Celery is introduced in later story tasks.
        log_evaluation_event(
            "evaluation_proposal_kickoff_accepted",
            trace_id=self.trace_id,
            run_id=run_id,
        )
        return True
