"""Integration tests preserving historical outcomes after schema promotion."""

import pytest
from uuid import uuid4

from app.services.evaluation_schema_promotion_service import EvaluationSchemaPromotionService


@pytest.mark.asyncio
async def test_schema_promotion_preserves_history() -> None:
    service = EvaluationSchemaPromotionService(trace_id=str(uuid4()))
    result = await service.promote(
        schema_id=uuid4(),
        from_version_id=uuid4(),
        to_version_id=uuid4(),
    )
    assert result.preserved_history_count >= 1
