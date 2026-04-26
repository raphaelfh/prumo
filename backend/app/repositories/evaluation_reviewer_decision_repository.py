"""Repository for reviewer decision history records."""

from uuid import UUID

from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.evaluation_decision import ReviewerDecisionRecord
from app.repositories.evaluation_repository_base import EvaluationRepositoryBase


class EvaluationReviewerDecisionRepository(EvaluationRepositoryBase):
    """Append and query reviewer decisions."""

    def __init__(self, db: AsyncSession):
        super().__init__(db=db, model=ReviewerDecisionRecord)

    async def append(self, decision: ReviewerDecisionRecord) -> ReviewerDecisionRecord:
        self.db.add(decision)
        await self.db.flush()
        await self.db.refresh(decision)
        return decision

    async def list_for_reviewer(
        self,
        *,
        reviewer_id: UUID,
        run_id: UUID | None = None,
        limit: int = 200,
    ) -> list[ReviewerDecisionRecord]:
        query = (
            select(ReviewerDecisionRecord)
            .where(ReviewerDecisionRecord.reviewer_id == reviewer_id)
            .order_by(desc(ReviewerDecisionRecord.created_at))
            .limit(limit)
        )
        if run_id:
            query = query.where(ReviewerDecisionRecord.run_id == run_id)
        result = await self.db.execute(query)
        return list(result.scalars().all())
