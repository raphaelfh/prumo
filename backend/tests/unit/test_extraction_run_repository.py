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

from app.models.extraction import ExtractionRunStatus
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


class TestCompleteRunMerge:
    """``complete_run`` MERGES results into the run's existing ``results`` JSONB
    (not REPLACE), so the provenance written at the proposal choke-point
    (``_create_suggestions`` → ``merge_results``) survives completion. A REPLACE
    would clobber it — the bug class this guards against.
    """

    @pytest.mark.asyncio
    async def test_merges_into_existing_results_preserving_prior_keys(self, repo) -> None:
        run_id = uuid4()
        existing = MagicMock()
        existing.results = {"provenance": {"model": "gpt"}}
        repo.get_by_id = AsyncMock(return_value=existing)

        out = await repo.complete_run(run_id, {"suggestions_created": 2})

        assert out is existing
        # Prior provenance preserved; the completion summary merged on top.
        assert existing.results == {"provenance": {"model": "gpt"}, "suggestions_created": 2}
        assert existing.status == ExtractionRunStatus.COMPLETED.value
        assert existing.completed_at is not None
        repo.db.flush.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_treats_empty_results_like_replace(self, repo) -> None:
        # A fresh run (results == {}) merging is equivalent to a replace, so the
        # non-proposal callers (model_extraction, batch primary run) are unaffected.
        existing = MagicMock()
        existing.results = {}
        repo.get_by_id = AsyncMock(return_value=existing)

        await repo.complete_run(uuid4(), {"models_count": 3})

        assert existing.results == {"models_count": 3}

    @pytest.mark.asyncio
    async def test_patch_key_overwrites_on_conflict(self, repo) -> None:
        # Shallow top-level merge: a patch key replaces the same key.
        existing = MagicMock()
        existing.results = {"tokens_total": 1, "provenance": {"a": 1}}
        repo.get_by_id = AsyncMock(return_value=existing)

        await repo.complete_run(uuid4(), {"tokens_total": 5})

        assert existing.results == {"tokens_total": 5, "provenance": {"a": 1}}

    @pytest.mark.asyncio
    async def test_returns_none_when_run_missing(self, repo) -> None:
        repo.get_by_id = AsyncMock(return_value=None)

        out = await repo.complete_run(uuid4(), {"x": 1})

        assert out is None
        repo.db.flush.assert_not_awaited()
