"""G5b (``active_batch_id``) bounds "in flight" by the attempt live window.

An abandoned attempt stays ``pending`` forever (its worker died, or the Redis
message was lost), so a liveness test with no freshness cutoff kept its batch
"active" for good — and ``ExtractionBatchService.create`` answered 409
``AI_BATCH_ALREADY_ACTIVE`` for that tool on every later attempt, cancel
included. The cutoff lives in ``_live_dispatched``, the one predicate
``count_in_flight`` shares.
"""

from datetime import UTC, datetime
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import pytest
from sqlalchemy.dialects import postgresql
from sqlalchemy.ext.asyncio import AsyncSession

from app.repositories.extraction_batch_repository import ExtractionBatchRepository


@pytest.mark.asyncio
async def test_active_batch_id_bounds_in_flight_attempts_by_the_live_window() -> None:
    db = AsyncMock(spec=AsyncSession)
    db.execute.return_value = MagicMock(scalar_one_or_none=MagicMock(return_value=None))
    since = datetime(2026, 1, 1, 12, 0, tzinfo=UTC)

    await ExtractionBatchRepository(db).active_batch_id(uuid4(), uuid4(), since=since)

    compiled = db.execute.await_args.args[0].compile(dialect=postgresql.dialect())
    assert "extraction_attempts.updated_at >=" in str(compiled)
    assert since in compiled.params.values()
