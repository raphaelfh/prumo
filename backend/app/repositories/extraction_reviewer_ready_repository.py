"""Repository for ExtractionReviewerReady — upsert keyed on (run, reviewer)."""

from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.extraction_workflow import ExtractionReviewerReady


class ExtractionReviewerReadyRepository:
    """Per-(run, reviewer) advisory "ready" flag."""

    def __init__(self, db: AsyncSession):
        self.db = db

    async def upsert(
        self,
        *,
        run_id: UUID,
        reviewer_id: UUID,
        is_ready: bool,
    ) -> ExtractionReviewerReady:
        marked_at = func.now() if is_ready else None
        stmt = (
            insert(ExtractionReviewerReady)
            .values(
                run_id=run_id,
                reviewer_id=reviewer_id,
                is_ready=is_ready,
                marked_ready_at=marked_at,
            )
            .on_conflict_do_update(
                constraint="uq_extraction_reviewer_ready_run_reviewer",
                set_={
                    "is_ready": is_ready,
                    "marked_ready_at": marked_at,
                    # BaseModel.updated_at's onupdate hook does not fire on a Core
                    # ON CONFLICT DO UPDATE, so refresh it explicitly on a toggle.
                    "updated_at": func.now(),
                },
            )
        )
        await self.db.execute(stmt)
        await self.db.flush()
        # ``populate_existing`` overwrites any identity-mapped copy with fresh DB
        # values — without it, a re-upsert in the same session (e.g. toggling
        # is_ready) returns the stale cached row.
        select_stmt = (
            select(ExtractionReviewerReady)
            .where(
                ExtractionReviewerReady.run_id == run_id,
                ExtractionReviewerReady.reviewer_id == reviewer_id,
            )
            .execution_options(populate_existing=True)
        )
        return (await self.db.execute(select_stmt)).scalar_one()

    async def ready_reviewer_ids(self, run_id: UUID) -> list[UUID]:
        stmt = select(ExtractionReviewerReady.reviewer_id).where(
            ExtractionReviewerReady.run_id == run_id,
            ExtractionReviewerReady.is_ready.is_(True),
        )
        rows = (await self.db.execute(stmt)).scalars().all()
        return list(rows)
