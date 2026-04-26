"""Repository helpers for evaluation runs and run targets."""

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.evaluation_run import EvaluationRun, EvaluationRunTarget
from app.repositories.evaluation_repository_base import EvaluationRepositoryBase


class EvaluationRunRepository(EvaluationRepositoryBase):
    """Persistence operations for evaluation run aggregates."""

    def __init__(self, db: AsyncSession):
        super().__init__(db=db, model=EvaluationRun)

    async def create_run(self, run: EvaluationRun) -> EvaluationRun:
        self.db.add(run)
        await self.db.flush()
        await self.db.refresh(run)
        return run

    async def add_targets(
        self,
        *,
        run_id: UUID,
        target_ids: list[UUID],
        target_type: str = "article",
    ) -> list[EvaluationRunTarget]:
        targets = [
            EvaluationRunTarget(
                run_id=run_id,
                target_id=target_id,
                target_type=target_type,
            )
            for target_id in target_ids
        ]
        self.db.add_all(targets)
        await self.db.flush()
        return targets

    async def get_run(self, run_id: UUID) -> EvaluationRun | None:
        result = await self.db.execute(select(EvaluationRun).where(EvaluationRun.id == run_id))
        return result.scalar_one_or_none()
