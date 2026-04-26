"""Service for schema promotion compatibility initialization rules."""

from dataclasses import dataclass
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.evaluation_decision import PublishedState
from app.models.evaluation_schema import EvaluationItem, EvaluationSchemaVersion
from app.services.evaluation_observability_service import log_evaluation_event


@dataclass(slots=True)
class SchemaPromotionResult:
    """Structured promotion result for verification tests."""

    schema_id: UUID
    from_version_id: UUID
    to_version_id: UUID
    preserved_history_count: int
    initialized_pending_count: int
    recopy_performed: bool


class EvaluationSchemaPromotionService:
    """Implements compatibility init semantics for version promotion."""

    def __init__(self, db: AsyncSession, trace_id: str):
        self.db = db
        self.trace_id = trace_id

    async def promote(
        self,
        *,
        schema_id: UUID,
        from_version_id: UUID,
        to_version_id: UUID,
    ) -> SchemaPromotionResult:
        from_version_schema = await self.db.execute(
            select(EvaluationSchemaVersion.schema_id).where(EvaluationSchemaVersion.id == from_version_id)
        )
        to_version_schema = await self.db.execute(
            select(EvaluationSchemaVersion.schema_id).where(EvaluationSchemaVersion.id == to_version_id)
        )
        from_schema_id = from_version_schema.scalar_one_or_none()
        to_schema_id = to_version_schema.scalar_one_or_none()
        if from_schema_id is None or to_schema_id is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Schema version not found for promotion",
            )
        if from_schema_id != schema_id or to_schema_id != schema_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Schema version does not belong to schema_id",
            )

        from_items_result = await self.db.execute(
            select(EvaluationItem.id, EvaluationItem.item_key, EvaluationItem.item_type).where(
                EvaluationItem.schema_version_id == from_version_id,
                EvaluationItem.is_deleted.is_(False),
            )
        )
        to_items_result = await self.db.execute(
            select(EvaluationItem.id, EvaluationItem.item_key, EvaluationItem.item_type).where(
                EvaluationItem.schema_version_id == to_version_id,
                EvaluationItem.is_deleted.is_(False),
            )
        )

        from_items = list(from_items_result.all())
        to_items = list(to_items_result.all())
        from_by_key = {row.item_key: row for row in from_items}

        compatible_old_item_ids: list[UUID] = []
        initialized_pending_count = 0
        for row in to_items:
            old_row = from_by_key.get(row.item_key)
            if old_row is None or old_row.item_type != row.item_type:
                initialized_pending_count += 1
            else:
                compatible_old_item_ids.append(old_row.id)

        preserved_history_count = 0
        if compatible_old_item_ids:
            preserved_result = await self.db.execute(
                select(func.count(PublishedState.id)).where(
                    PublishedState.schema_version_id == from_version_id,
                    PublishedState.item_id.in_(compatible_old_item_ids),
                )
            )
            preserved_history_count = int(preserved_result.scalar_one())

        # Governance rule: no automatic value recopy.
        result = SchemaPromotionResult(
            schema_id=schema_id,
            from_version_id=from_version_id,
            to_version_id=to_version_id,
            preserved_history_count=preserved_history_count,
            initialized_pending_count=initialized_pending_count,
            recopy_performed=False,
        )
        log_evaluation_event(
            "evaluation_schema_promoted",
            trace_id=self.trace_id,
            extra={
                "schema_id": str(schema_id),
                "from_version_id": str(from_version_id),
                "to_version_id": str(to_version_id),
            },
        )
        return result
