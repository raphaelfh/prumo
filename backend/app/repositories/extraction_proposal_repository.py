"""Repository for ExtractionProposalRecord."""

from collections.abc import Sequence
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.extraction_workflow import ExtractionProposalRecord


class ExtractionProposalRepository:
    """Append-only access for proposal records."""

    def __init__(self, db: AsyncSession):
        self.db = db

    async def get(self, proposal_id: UUID) -> ExtractionProposalRecord | None:
        stmt = select(ExtractionProposalRecord).where(ExtractionProposalRecord.id == proposal_id)
        return (await self.db.execute(stmt)).scalar_one_or_none()

    async def list_by_run(self, run_id: UUID) -> list[ExtractionProposalRecord]:
        stmt = (
            select(ExtractionProposalRecord)
            .where(ExtractionProposalRecord.run_id == run_id)
            .order_by(ExtractionProposalRecord.created_at.asc())
        )
        result = await self.db.execute(stmt)
        return list(result.scalars().all())

    async def latest_by_field(
        self, run_id: UUID, instance_id: UUID, field_ids: Sequence[UUID], source: str
    ) -> dict[UUID, ExtractionProposalRecord]:
        """Newest unattributed proposal of ``source`` per field of one instance,
        for the landing's value dedupe. ``id`` is the deterministic tiebreaker
        on equal ``created_at`` (same-transaction inserts share the timestamp)."""
        record = ExtractionProposalRecord
        stmt = (
            select(record)
            .where(
                record.run_id == run_id,
                record.instance_id == instance_id,
                record.field_id.in_(field_ids),
                record.source == source,
                record.source_user_id.is_(None),
            )
            .distinct(record.field_id)
            .order_by(record.field_id, record.created_at.desc(), record.id.desc())
        )
        return {row.field_id: row for row in (await self.db.scalars(stmt)).all()}

    async def for_attempt(
        self, attempt_id: UUID, instance_id: UUID, field_ids: Sequence[UUID], source: str
    ) -> dict[UUID, ExtractionProposalRecord]:
        """An attempt's own rows per field of one instance (replay detection)."""
        record = ExtractionProposalRecord
        stmt = select(record).where(
            record.extraction_attempt_id == attempt_id,
            record.instance_id == instance_id,
            record.field_id.in_(field_ids),
            record.source == source,
        )
        return {row.field_id: row for row in (await self.db.scalars(stmt)).all()}
