"""Attempt persistence; authorization and transaction ownership stay in services."""

from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.extraction_attempt import ExtractionAttempt
from app.schemas.extraction_attempt import AttemptScope


class ExtractionAttemptRepository:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def get_or_create(
        self,
        *,
        request_id: UUID,
        owner_id: UUID,
        scope: AttemptScope,
        request_payload: dict[str, Any],
        job_id: str | None,
    ) -> tuple[ExtractionAttempt, bool]:
        statement = (
            insert(ExtractionAttempt)
            .values(
                request_id=request_id,
                owner_id=owner_id,
                **scope.model_dump(),
                request_payload=request_payload,
                job_id=job_id,
            )
            .on_conflict_do_nothing(index_elements=["request_id"])
            .returning(ExtractionAttempt)
        )
        row = (await self.db.execute(statement)).scalar_one_or_none()
        if row is not None:
            await self.db.flush()
            return row, True
        row = (
            await self.db.execute(
                select(ExtractionAttempt).where(
                    ExtractionAttempt.request_id == request_id,
                )
            )
        ).scalar_one()
        return row, False

    async def get_owned(self, request_id: UUID, owner_id: UUID) -> ExtractionAttempt | None:
        return (
            await self.db.execute(
                select(ExtractionAttempt).where(
                    ExtractionAttempt.request_id == request_id,
                    ExtractionAttempt.owner_id == owner_id,
                )
            )
        ).scalar_one_or_none()

    async def lock(self, attempt_id: UUID) -> ExtractionAttempt | None:
        # Compatible with proposal FK KEY SHARE locks from domain transactions.
        return (
            await self.db.execute(
                select(ExtractionAttempt)
                .where(
                    ExtractionAttempt.id == attempt_id,
                )
                .with_for_update(key_share=True)
            )
        ).scalar_one_or_none()
