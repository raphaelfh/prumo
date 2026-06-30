"""
Extraction Run Repository.

Manages persistence for AI extraction runs.
"""

from datetime import UTC, datetime
from time import perf_counter
from typing import Any
from uuid import UUID

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.logging import get_logger
from app.models.extraction import ExtractionRun, ExtractionRunStage, ExtractionRunStatus
from app.repositories.base import BaseRepository

logger = get_logger(__name__)


class ExtractionRunRepository(BaseRepository[ExtractionRun]):
    """
    Repository for AI extraction runs.

    Manages the lifecycle of the extraction_runs.
    """

    def __init__(self, db: AsyncSession):
        super().__init__(db, ExtractionRun)

    async def create_run(
        self,
        project_id: UUID,
        article_id: UUID,
        template_id: UUID,
        stage: ExtractionRunStage,
        created_by: UUID,
        parameters: dict[str, Any] | None = None,
    ) -> ExtractionRun:
        """
        Create a new extraction run.

        Args:
            project_id: project.
            article_id: article.
            template_id: template.
            stage: run stage (pending, proposal, review, consensus, finalized, cancelled).
            created_by: user who created it.
            parameters: run parameters (model, etc.).

        Returns:
            The created ExtractionRun.
        """
        # Convert Enum to string for compatibility
        stage_value = stage.value if isinstance(stage, ExtractionRunStage) else str(stage)
        status_value = ExtractionRunStatus.PENDING.value

        run = ExtractionRun(
            project_id=project_id,
            article_id=article_id,
            template_id=template_id,
            stage=stage_value,
            status=status_value,
            parameters=parameters or {},
            results={},
            created_by=created_by,
        )

        return await self.create(run)

    async def start_run(self, run_id: UUID) -> ExtractionRun | None:
        """
        Mark a run as started.

        Args:
            run_id: run.

        Returns:
            The updated ExtractionRun, or None.
        """
        query_start = perf_counter()
        await self.db.execute(
            update(ExtractionRun)
            .where(ExtractionRun.id == run_id)
            .values(
                status=ExtractionRunStatus.RUNNING.value,
                started_at=datetime.now(UTC),
            )
        )
        await self.db.flush()
        query_duration_ms = (perf_counter() - query_start) * 1000
        logger.info(
            "extraction_run_start_db_latency",
            run_id=str(run_id),
            db_duration_ms=query_duration_ms,
        )
        return await self.get_by_id(run_id)

    async def complete_run(
        self,
        run_id: UUID,
        results: dict[str, Any],
    ) -> ExtractionRun | None:
        """Mark a run COMPLETED, shallow-merging *results* into its ``results`` JSONB.

        MERGE (not REPLACE) so run-level data already recorded — notably the
        ``provenance`` snapshot the proposal choke-point (``_create_suggestions``
        → ``merge_results``) writes — survives completion. A REPLACE would clobber
        it. Callers whose run still has empty ``results`` (model extraction, the
        batch primary run) are unaffected: merging into ``{}`` equals a replace.

        Args:
            run_id: the run to complete.
            results: top-level keys to merge into ``results``.

        Returns:
            The updated ExtractionRun, or None if the run does not exist.
        """
        query_start = perf_counter()
        run = await self.get_by_id(run_id)
        if run is None:
            return None
        run.status = ExtractionRunStatus.COMPLETED.value
        run.completed_at = datetime.now(UTC)
        # Reassign (not in-place mutate) so SQLAlchemy tracks the JSONB change.
        run.results = {**(run.results or {}), **results}
        await self.db.flush()
        query_duration_ms = (perf_counter() - query_start) * 1000
        logger.info(
            "extraction_run_complete_db_latency",
            run_id=str(run_id),
            db_duration_ms=query_duration_ms,
        )
        return run

    async def merge_results(
        self,
        run_id: UUID,
        patch: dict[str, Any],
    ) -> ExtractionRun | None:
        """Shallow-merge *patch* into the run's ``results`` JSONB; keep status.

        The session-run extraction path (``extract_section`` / ``extract_for_run``
        on a run the HITL session owns) must keep the run alive in EXTRACT, so it
        cannot call ``complete_run`` (which marks the run COMPLETED). This lets it
        still persist run-level data — notably ``provenance`` (how the suggestions
        were generated) — so the review UI's "How this was generated" disclosure
        has data to show.

        Args:
            run_id: the run to update.
            patch: top-level keys to merge into ``results``.

        Returns:
            The updated ExtractionRun, or None if the run does not exist.
        """
        run = await self.get_by_id(run_id)
        if run is None:
            return None
        # Reassign (not in-place mutate) so SQLAlchemy tracks the JSONB change.
        run.results = {**(run.results or {}), **patch}
        await self.db.flush()
        return run

    async def fail_run(
        self,
        run_id: UUID,
        error_message: str,
    ) -> ExtractionRun | None:
        """
        Mark a run as failed.

        Args:
            run_id: run.
            error_message: Error message.

        Returns:
            The updated ExtractionRun, or None.
        """
        query_start = perf_counter()
        await self.db.execute(
            update(ExtractionRun)
            .where(ExtractionRun.id == run_id)
            .values(
                status=ExtractionRunStatus.FAILED.value,
                completed_at=datetime.now(UTC),
                error_message=error_message,
            )
        )
        await self.db.flush()
        query_duration_ms = (perf_counter() - query_start) * 1000
        logger.info(
            "extraction_run_fail_db_latency",
            run_id=str(run_id),
            db_duration_ms=query_duration_ms,
        )
        return await self.get_by_id(run_id)

    async def rollback_and_fail(
        self,
        run_id: UUID,
        error_message: str,
        *,
        logger: Any,
        trace_id: str | None,
        log_prefix: str,
    ) -> None:
        """Roll back a failed transaction, then mark the run failed.

        A DB-level error leaves the asyncpg session in a failed-transaction
        state, so every subsequent statement raises
        ``InFailedSQLTransactionError`` — including ``fail_run`` itself, which
        would then leave the run stuck at ``status='running'``. Roll back first
        so ``fail_run`` runs on a clean session. Both calls are defensively
        guarded so neither masks the original error.

        ``logger``/``trace_id``/``log_prefix`` are supplied by the calling
        service so the guard-failure events keep their service-specific names
        and bound context (e.g. ``log_prefix='section_extraction'`` →
        ``section_extraction_rollback_failed``).
        """
        try:
            await self.db.rollback()
        except Exception:
            logger.warning(
                f"{log_prefix}_rollback_failed",
                trace_id=trace_id,
                run_id=str(run_id),
            )
        try:
            await self.fail_run(run_id, error_message)
        except Exception:
            logger.error(
                f"{log_prefix}_mark_failed_error",
                trace_id=trace_id,
                run_id=str(run_id),
            )

    async def get_by_article(
        self,
        article_id: UUID,
        stage: ExtractionRunStage | None = None,
        status: ExtractionRunStatus | None = None,
    ) -> list[ExtractionRun]:
        """
        List runs of an article.

        Args:
            article_id: article.
            stage: filter by stage (optional).
            status: filter by status (optional).

        Returns:
            List of runs.
        """
        query = select(ExtractionRun).where(ExtractionRun.article_id == article_id)

        if stage:
            query = query.where(ExtractionRun.stage == stage.value)

        if status:
            query = query.where(ExtractionRun.status == status.value)

        query = query.order_by(ExtractionRun.created_at.desc())

        result = await self.db.execute(query)
        return list(result.scalars().all())

    async def get_latest_by_article(
        self,
        article_id: UUID,
        stage: ExtractionRunStage,
    ) -> ExtractionRun | None:
        """
        Fetch the most recent run of an article for a stage.

        Args:
            article_id: article.
            stage: run stage.

        Returns:
            The most recent ExtractionRun, or None.
        """
        result = await self.db.execute(
            select(ExtractionRun)
            .where(ExtractionRun.article_id == article_id)
            .where(ExtractionRun.stage == stage.value)
            .order_by(ExtractionRun.created_at.desc())
            .limit(1)
        )
        return result.scalar_one_or_none()

    async def get_by_project(
        self,
        project_id: UUID,
        status: ExtractionRunStatus | None = None,
        limit: int = 50,
    ) -> list[ExtractionRun]:
        """
        List runs of a project.

        Args:
            project_id: project.
            status: filter by status (optional).
            limit: result limit.

        Returns:
            List of runs.
        """
        query = select(ExtractionRun).where(ExtractionRun.project_id == project_id)

        if status:
            query = query.where(ExtractionRun.status == status.value)

        query = query.order_by(ExtractionRun.created_at.desc()).limit(limit)

        result = await self.db.execute(query)
        return list(result.scalars().all())
