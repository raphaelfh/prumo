"""Repository for ExtractionProposalRecord."""

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.extraction_workflow import ExtractionProposalRecord


class ExtractionProposalRepository:
    """Append-only access for proposal records."""

    def __init__(self, db: AsyncSession):
        self.db = db

    async def add(self, record: ExtractionProposalRecord) -> ExtractionProposalRecord:
        self.db.add(record)
        await self.db.flush()
        await self.db.refresh(record)
        return record

    async def get(self, proposal_id: UUID) -> ExtractionProposalRecord | None:
        stmt = select(ExtractionProposalRecord).where(ExtractionProposalRecord.id == proposal_id)
        return (await self.db.execute(stmt)).scalar_one_or_none()

    async def list_by_item(
        self,
        run_id: UUID,
        instance_id: UUID,
        field_id: UUID,
    ) -> list[ExtractionProposalRecord]:
        stmt = (
            select(ExtractionProposalRecord)
            .where(
                ExtractionProposalRecord.run_id == run_id,
                ExtractionProposalRecord.instance_id == instance_id,
                ExtractionProposalRecord.field_id == field_id,
            )
            .order_by(ExtractionProposalRecord.created_at.asc())
        )
        result = await self.db.execute(stmt)
        return list(result.scalars().all())

    async def list_by_run(self, run_id: UUID) -> list[ExtractionProposalRecord]:
        stmt = (
            select(ExtractionProposalRecord)
            .where(ExtractionProposalRecord.run_id == run_id)
            .order_by(ExtractionProposalRecord.created_at.asc())
        )
        result = await self.db.execute(stmt)
        return list(result.scalars().all())

    async def get_latest_for_coord(
        self,
        run_id: UUID,
        instance_id: UUID,
        field_id: UUID,
        source: str,
        source_user_id: UUID | None,
    ) -> ExtractionProposalRecord | None:
        """Newest proposal for a coord scoped to source (+ user), for the
        idempotency check. ``id`` is the deterministic tiebreaker on equal
        ``created_at`` (same-transaction inserts share the timestamp)."""
        stmt = (
            select(ExtractionProposalRecord)
            .where(
                ExtractionProposalRecord.run_id == run_id,
                ExtractionProposalRecord.instance_id == instance_id,
                ExtractionProposalRecord.field_id == field_id,
                ExtractionProposalRecord.source == source,
                ExtractionProposalRecord.source_user_id == source_user_id,
            )
            .order_by(
                ExtractionProposalRecord.created_at.desc(),
                ExtractionProposalRecord.id.desc(),
            )
            .limit(1)
        )
        return (await self.db.execute(stmt)).scalar_one_or_none()
