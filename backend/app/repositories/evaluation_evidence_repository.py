"""Repository for evidence metadata persistence."""

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.evaluation_decision import EvidenceRecord
from app.repositories.evaluation_repository_base import EvaluationRepositoryBase


class EvaluationEvidenceRepository(EvaluationRepositoryBase):
    """Append evidence metadata records."""

    def __init__(self, db: AsyncSession):
        super().__init__(db=db, model=EvidenceRecord)

    async def append(self, record: EvidenceRecord) -> EvidenceRecord:
        self.db.add(record)
        await self.db.flush()
        await self.db.refresh(record)
        return record
