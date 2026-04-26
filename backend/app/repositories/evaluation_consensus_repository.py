"""Repository for consensus decision history records."""

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.evaluation_decision import ConsensusDecisionRecord
from app.repositories.evaluation_repository_base import EvaluationRepositoryBase


class EvaluationConsensusRepository(EvaluationRepositoryBase):
    """Append-only writes for consensus decisions."""

    def __init__(self, db: AsyncSession):
        super().__init__(db=db, model=ConsensusDecisionRecord)

    async def append(self, record: ConsensusDecisionRecord) -> ConsensusDecisionRecord:
        self.db.add(record)
        await self.db.flush()
        await self.db.refresh(record)
        return record
