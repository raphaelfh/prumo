"""Unit tests for ExtractionRunRepository.rollback_and_fail.

The rollback-then-fail recovery (#21/#88) lives on the repository so both
SectionExtractionService and ModelExtractionService share one implementation.
A DB-level error leaves the asyncpg session in a failed-transaction state, so
the repo rolls back before calling fail_run (which would otherwise raise
InFailedSQLTransactionError and leave the run stuck at status='running'). Both
calls are defensively guarded so neither masks the caller's original error.
"""

from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.repositories.extraction_run_repository import ExtractionRunRepository


@pytest.fixture
def repo():
    db = AsyncMock(spec=AsyncSession)
    r = ExtractionRunRepository(db=db)
    # fail_run is exercised by its own tests; here it's a collaborator we stub.
    r.fail_run = AsyncMock()
    return r


class TestRollbackAndFail:
    @pytest.mark.asyncio
    async def test_rolls_back_before_marking_failed(self, repo) -> None:
        order: list[str] = []
        repo.db.rollback = AsyncMock(side_effect=lambda: order.append("rollback"))
        repo.fail_run = AsyncMock(side_effect=lambda *_a, **_k: order.append("fail_run"))

        await repo.rollback_and_fail(
            uuid4(),
            "boom",
            logger=MagicMock(),
            trace_id="trace-123",
            log_prefix="section_extraction",
        )

        assert order == ["rollback", "fail_run"]

    @pytest.mark.asyncio
    async def test_swallows_fail_run_error(self, repo) -> None:
        # Even if marking the run failed itself errors, rollback_and_fail must
        # not raise — the caller's original error has already been surfaced.
        logger = MagicMock()
        repo.db.rollback = AsyncMock()
        repo.fail_run = AsyncMock(side_effect=RuntimeError("still broken"))

        await repo.rollback_and_fail(
            uuid4(),
            "boom",
            logger=logger,
            trace_id="trace-123",
            log_prefix="model_extraction",
        )

        repo.db.rollback.assert_awaited_once()
        repo.fail_run.assert_awaited_once()
        # The guard-failure event keeps the caller-supplied prefix.
        logger.error.assert_called_once()
        assert logger.error.call_args.args[0] == "model_extraction_mark_failed_error"

    @pytest.mark.asyncio
    async def test_swallows_rollback_error_and_still_marks_failed(self, repo) -> None:
        logger = MagicMock()
        repo.db.rollback = AsyncMock(side_effect=RuntimeError("rollback failed"))
        repo.fail_run = AsyncMock()

        await repo.rollback_and_fail(
            uuid4(),
            "boom",
            logger=logger,
            trace_id="trace-123",
            log_prefix="section_extraction",
        )

        logger.warning.assert_called_once()
        assert logger.warning.call_args.args[0] == "section_extraction_rollback_failed"
        # fail_run is still attempted after a failed rollback.
        repo.fail_run.assert_awaited_once()
