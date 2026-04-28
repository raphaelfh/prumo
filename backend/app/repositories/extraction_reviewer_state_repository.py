"""Repository for ExtractionReviewerState — upsert keyed on (run, reviewer, instance, field)."""

from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.extraction_workflow import ExtractionReviewerState


class ExtractionReviewerStateRepository:
    """Materialized current-decision state per (reviewer, run, item)."""

    def __init__(self, db: AsyncSession):
        self.db = db

    async def upsert(
        self,
        *,
        run_id: UUID,
        reviewer_id: UUID,
        instance_id: UUID,
        field_id: UUID,
        current_decision_id: UUID,
    ) -> ExtractionReviewerState:
        stmt = (
            insert(ExtractionReviewerState)
            .values(
                run_id=run_id,
                reviewer_id=reviewer_id,
                instance_id=instance_id,
                field_id=field_id,
                current_decision_id=current_decision_id,
            )
            .on_conflict_do_update(
                constraint="uq_extraction_reviewer_states_run_reviewer_item",
                set_={
                    "current_decision_id": current_decision_id,
                    "last_updated": func.now(),
                },
            )
        )
        await self.db.execute(stmt)
        await self.db.flush()
        # Read back the row
        select_stmt = select(ExtractionReviewerState).where(
            ExtractionReviewerState.run_id == run_id,
            ExtractionReviewerState.reviewer_id == reviewer_id,
            ExtractionReviewerState.instance_id == instance_id,
            ExtractionReviewerState.field_id == field_id,
        )
        row = (await self.db.execute(select_stmt)).scalar_one()
        return row

    async def get(
        self,
        *,
        run_id: UUID,
        reviewer_id: UUID,
        instance_id: UUID,
        field_id: UUID,
    ) -> ExtractionReviewerState | None:
        stmt = select(ExtractionReviewerState).where(
            ExtractionReviewerState.run_id == run_id,
            ExtractionReviewerState.reviewer_id == reviewer_id,
            ExtractionReviewerState.instance_id == instance_id,
            ExtractionReviewerState.field_id == field_id,
        )
        return (await self.db.execute(stmt)).scalar_one_or_none()
