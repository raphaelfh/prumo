"""Repository for ExtractionPublishedState with optimistic concurrency."""

from uuid import UUID

from sqlalchemy import func, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.extraction_workflow import ExtractionPublishedState


class ExtractionPublishedStateRepository:
    """Canonical-state writes with version-based optimistic concurrency."""

    def __init__(self, db: AsyncSession):
        self.db = db

    async def get(
        self,
        *,
        run_id: UUID,
        instance_id: UUID,
        field_id: UUID,
    ) -> ExtractionPublishedState | None:
        stmt = select(ExtractionPublishedState).where(
            ExtractionPublishedState.run_id == run_id,
            ExtractionPublishedState.instance_id == instance_id,
            ExtractionPublishedState.field_id == field_id,
        )
        return (await self.db.execute(stmt)).scalar_one_or_none()

    async def insert_first(
        self,
        *,
        run_id: UUID,
        instance_id: UUID,
        field_id: UUID,
        value: dict,
        published_by: UUID,
    ) -> ExtractionPublishedState:
        record = ExtractionPublishedState(
            run_id=run_id,
            instance_id=instance_id,
            field_id=field_id,
            value=value,
            published_by=published_by,
            version=1,
        )
        self.db.add(record)
        await self.db.flush()
        await self.db.refresh(record)
        return record

    async def insert_first_if_absent(
        self,
        *,
        run_id: UUID,
        instance_id: UUID,
        field_id: UUID,
        value: dict,
        published_by: UUID,
    ) -> ExtractionPublishedState | None:
        """INSERT ... ON CONFLICT DO NOTHING — returns the row on insert, else None.

        Avoids the TOCTOU race in get-then-insert when two concurrent callers
        race to publish the first state for a given (run, instance, field).
        """
        stmt = (
            pg_insert(ExtractionPublishedState)
            .values(
                run_id=run_id,
                instance_id=instance_id,
                field_id=field_id,
                value=value,
                published_by=published_by,
                version=1,
            )
            .on_conflict_do_nothing(
                constraint="uq_extraction_published_states_run_item",
            )
            .returning(ExtractionPublishedState)
        )
        result = await self.db.execute(stmt)
        await self.db.flush()
        row = result.scalar_one_or_none()
        if row is None:
            return None
        # Re-load to get the full ORM object with all defaults populated.
        return await self.get(run_id=run_id, instance_id=instance_id, field_id=field_id)

    async def update_with_optimistic_lock(
        self,
        *,
        run_id: UUID,
        instance_id: UUID,
        field_id: UUID,
        value: dict,
        published_by: UUID,
        expected_version: int,
    ) -> int:
        """Returns the rowcount; 0 means optimistic-concurrency conflict."""
        stmt = (
            update(ExtractionPublishedState)
            .where(
                ExtractionPublishedState.run_id == run_id,
                ExtractionPublishedState.instance_id == instance_id,
                ExtractionPublishedState.field_id == field_id,
                ExtractionPublishedState.version == expected_version,
            )
            .values(
                value=value,
                published_by=published_by,
                version=expected_version + 1,
                published_at=func.now(),
            )
        )
        result = await self.db.execute(stmt)
        await self.db.flush()
        return result.rowcount
