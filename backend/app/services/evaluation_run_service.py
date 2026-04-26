"""Service layer for evaluation run lifecycle."""

from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.evaluation_run import EvaluationRun, EvaluationRunStage, EvaluationRunStatus
from app.repositories.evaluation_run_repository import EvaluationRunRepository
from app.schemas.evaluation_runs import CreateEvaluationRunRequest
from app.services.evaluation_observability_service import log_evaluation_event


class EvaluationRunService:
    """Business logic for creating and reading evaluation runs."""

    def __init__(self, db: AsyncSession, user_id: UUID, trace_id: str):
        self.db = db
        self.user_id = user_id
        self.trace_id = trace_id
        self._runs = EvaluationRunRepository(db)

    async def create_run(self, payload: CreateEvaluationRunRequest) -> EvaluationRun:
        run = EvaluationRun(
            project_id=payload.project_id,
            schema_version_id=payload.schema_version_id,
            name=payload.name or f"Run {payload.schema_version_id}",
            status=EvaluationRunStatus.PENDING.value,
            current_stage=EvaluationRunStage.PROPOSAL.value,
            started_by=self.user_id,
        )
        run = await self._runs.create_run(run)
        await self._runs.add_targets(run_id=run.id, target_ids=payload.target_ids)
        await self.db.commit()
        log_evaluation_event(
            "evaluation_run_created",
            trace_id=self.trace_id,
            run_id=run.id,
            project_id=run.project_id,
        )
        return run

    async def get_run_or_404(self, run_id: UUID) -> EvaluationRun:
        run = await self._runs.get_run(run_id)
        if run is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Evaluation run not found",
            )
        return run

    async def move_to_active_proposal(self, run_id: UUID) -> EvaluationRun:
        run = await self.get_run_or_404(run_id)
        run.status = EvaluationRunStatus.ACTIVE.value
        run.current_stage = EvaluationRunStage.PROPOSAL.value
        await self.db.flush()
        await self.db.refresh(run)
        await self.db.commit()
        log_evaluation_event(
            "evaluation_run_proposal_generation_started",
            trace_id=self.trace_id,
            run_id=run.id,
            project_id=run.project_id,
        )
        return run
