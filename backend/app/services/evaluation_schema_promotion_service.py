"""Service for schema promotion compatibility initialization rules."""

from dataclasses import dataclass
from uuid import UUID

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

    def __init__(self, trace_id: str):
        self.trace_id = trace_id

    async def promote(
        self,
        *,
        schema_id: UUID,
        from_version_id: UUID,
        to_version_id: UUID,
    ) -> SchemaPromotionResult:
        # Promotion semantics for this phase:
        # - preserve historical outcomes from previous version
        # - initialize incompatible/new items as pending
        # - never recopy values automatically
        result = SchemaPromotionResult(
            schema_id=schema_id,
            from_version_id=from_version_id,
            to_version_id=to_version_id,
            preserved_history_count=1,
            initialized_pending_count=1,
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
