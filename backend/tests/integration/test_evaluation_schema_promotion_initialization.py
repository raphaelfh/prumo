"""Integration tests for pending initialization on promotion."""

from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest

from app.services.evaluation_schema_promotion_service import EvaluationSchemaPromotionService


class _ScalarResult:
    def __init__(self, value):
        self._value = value

    def scalar_one_or_none(self):
        return self._value

    def scalar_one(self):
        return self._value


class _RowsResult:
    def __init__(self, rows):
        self._rows = rows

    def all(self):
        return self._rows


@pytest.mark.asyncio
async def test_schema_promotion_initializes_pending_items() -> None:
    schema_id = uuid4()
    from_version_id = uuid4()
    to_version_id = uuid4()
    db = AsyncMock()
    db.execute = AsyncMock(
        side_effect=[
            _ScalarResult(schema_id),
            _ScalarResult(schema_id),
            _RowsResult([SimpleNamespace(id=uuid4(), item_key="risk", item_type="text")]),
            _RowsResult(
                [
                    SimpleNamespace(id=uuid4(), item_key="risk", item_type="number"),
                    SimpleNamespace(id=uuid4(), item_key="new_item", item_type="text"),
                ]
            ),
        ]
    )
    service = EvaluationSchemaPromotionService(db=db, trace_id=str(uuid4()))
    result = await service.promote(
        schema_id=schema_id,
        from_version_id=from_version_id,
        to_version_id=to_version_id,
    )
    assert result.initialized_pending_count == 2
