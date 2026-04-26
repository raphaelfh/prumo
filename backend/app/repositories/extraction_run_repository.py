"""
Extraction Run Repository.

Manages persistence for execucoes de IA for extraction.
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
    Repository for execucoes de extraction de IA.

    Manages o ciclo de vida of the extraction_runs.
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
        Create uma nova execucao de extraction.

        Args:
            project_id: project.
            article_id: article.
            template_id: template.
            stage: Estagio da execucao (data_suggest, parsing, etc.).
            created_by: user que criou.
            parameters: Parametros da execucao (modelo, etc.).

        Returns:
            ExtractionRun criado.
        """
        # Converter Enum for string for garantir compatibilidade
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
        Marca uma execucao como iniciada.

        Args:
            run_id: execucao.

        Returns:
            ExtractionRun atualizado or None.
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
        """
        Marca uma execucao como concluida.

        Args:
            run_id: execucao.
            results: Resultados da execucao.

        Returns:
            ExtractionRun atualizado or None.
        """
        query_start = perf_counter()
        await self.db.execute(
            update(ExtractionRun)
            .where(ExtractionRun.id == run_id)
            .values(
                status=ExtractionRunStatus.COMPLETED.value,
                completed_at=datetime.now(UTC),
                results=results,
            )
        )
        await self.db.flush()
        query_duration_ms = (perf_counter() - query_start) * 1000
        logger.info(
            "extraction_run_complete_db_latency",
            run_id=str(run_id),
            db_duration_ms=query_duration_ms,
        )
        return await self.get_by_id(run_id)

    async def fail_run(
        self,
        run_id: UUID,
        error_message: str,
    ) -> ExtractionRun | None:
        """
        Marca uma execucao como falha.

        Args:
            run_id: execucao.
            error_message: Error message.

        Returns:
            ExtractionRun atualizado or None.
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

    async def get_by_article(
        self,
        article_id: UUID,
        stage: ExtractionRunStage | None = None,
        status: ExtractionRunStatus | None = None,
    ) -> list[ExtractionRun]:
        """
        List execucoes de um article.

        Args:
            article_id: article.
            stage: Filtro por estagio (optional).
            status: Filtro por status (optional).

        Returns:
            List de execucoes.
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
        Fetch a execucao mais recente de um article for um estagio.

        Args:
            article_id: article.
            stage: Estagio da execucao.

        Returns:
            ExtractionRun mais recente or None.
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
        List execucoes de um project.

        Args:
            project_id: project.
            status: Filtro por status (optional).
            limit: Limite de resultados.

        Returns:
            List de execucoes.
        """
        query = select(ExtractionRun).where(ExtractionRun.project_id == project_id)

        if status:
            query = query.where(ExtractionRun.status == status.value)

        query = query.order_by(ExtractionRun.created_at.desc()).limit(limit)

        result = await self.db.execute(query)
        return list(result.scalars().all())
