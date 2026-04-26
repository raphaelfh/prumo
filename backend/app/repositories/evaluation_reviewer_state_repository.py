"""Repository for reviewer state materialization table."""

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.evaluation_decision import ReviewerState
from app.repositories.evaluation_repository_base import EvaluationRepositoryBase


class EvaluationReviewerStateRepository(EvaluationRepositoryBase):
    """Read and upsert reviewer current-state rows."""

    def __init__(self, db: AsyncSession):
        super().__init__(db=db, model=ReviewerState)

    async def get_by_identity(
        self,
        *,
        reviewer_id: UUID,
        target_id: UUID,
        item_id: UUID,
        schema_version_id: UUID,
    ) -> ReviewerState | None:
        result = await self.db.execute(
            select(ReviewerState).where(
                ReviewerState.reviewer_id == reviewer_id,
                ReviewerState.target_id == target_id,
                ReviewerState.item_id == item_id,
                ReviewerState.schema_version_id == schema_version_id,
            )
        )
        return result.scalar_one_or_none()

    async def upsert(
        self,
        *,
        project_id: UUID,
        reviewer_id: UUID,
        target_id: UUID,
        item_id: UUID,
        schema_version_id: UUID,
        latest_decision_id: UUID,
        latest_decision: str,
    ) -> ReviewerState:
        state = await self.get_by_identity(
            reviewer_id=reviewer_id,
            target_id=target_id,
            item_id=item_id,
            schema_version_id=schema_version_id,
        )
        if state is None:
            state = ReviewerState(
                project_id=project_id,
                reviewer_id=reviewer_id,
                target_id=target_id,
                item_id=item_id,
                schema_version_id=schema_version_id,
                latest_decision_id=latest_decision_id,
                latest_decision=latest_decision,
            )
            self.db.add(state)
        else:
            state.latest_decision_id = latest_decision_id
            state.latest_decision = latest_decision
        await self.db.flush()
        await self.db.refresh(state)
        return state
