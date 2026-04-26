"""Integration tests enforcing item type immutability semantics."""

import pytest
from uuid import uuid4

from app.services.evaluation_schema_promotion_service import EvaluationSchemaPromotionService


@pytest.mark.asyncio
async def test_item_type_immutability_after_extraction() -> None:
    service = EvaluationSchemaPromotionService(trace_id=str(uuid4()))
    result = await service.promote(
        schema_id=uuid4(),
        from_version_id=uuid4(),
        to_version_id=uuid4(),
    )
    assert result.recopy_performed is False
