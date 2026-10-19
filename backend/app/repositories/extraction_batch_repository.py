"""Batch persistence shared by the batch service and the dispatcher."""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

from sqlalchemy import ColumnElement, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.article import Article
from app.models.extraction import ProjectExtractionTemplate
from app.models.extraction_attempt import ExtractionAttempt
from app.models.extraction_batch import ExtractionBatch, ExtractionBatchItem
from app.models.personal_access_token import PersonalAccessToken
from app.models.project import Project
from app.schemas.extraction_batch import ATTEMPT_LIVE, ENGINE_STOP_CODES, ItemRow


def _member(owner_id: UUID) -> ColumnElement[bool]:
    return func.public.is_project_member(ExtractionBatch.project_id, owner_id)


def _live_dispatched() -> tuple[ColumnElement[bool], ...]:
    """One spelling of "in flight": dispatched, with an attempt still live."""
    return (
        ExtractionBatchItem.status == "dispatched",
        ExtractionAttempt.status.in_(ATTEMPT_LIVE),
    )


class ExtractionBatchRepository:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def get_owned(
        self, batch_id: UUID, owner_id: UUID, *, project_id: UUID | None = None
    ) -> ExtractionBatch | None:
        """Owner, membership and (when given) the project, in one WHERE clause."""
        stmt = select(ExtractionBatch).where(
            ExtractionBatch.id == batch_id,
            ExtractionBatch.owner_id == owner_id,
            _member(owner_id),
            *([ExtractionBatch.project_id == project_id] if project_id is not None else []),
        )
        return (await self.db.execute(stmt)).scalar_one_or_none()

    async def owned_by_plan_digest(
        self, owner_id: UUID, plan_digest: str, *, project_id: UUID
    ) -> UUID | None:
        return (
            await self.db.execute(
                select(ExtractionBatch.id).where(
                    ExtractionBatch.owner_id == owner_id,
                    ExtractionBatch.project_id == project_id,
                    ExtractionBatch.agent_plan_digest == plan_digest,
                    _member(owner_id),
                )
            )
        ).scalar_one_or_none()

    async def agent_batch_of_attempt(self, attempt_id: UUID) -> UUID | None:
        """The agent-started batch whose item ran ``attempt_id``, if any."""
        return (
            await self.db.execute(
                select(ExtractionBatch.id)
                .join(ExtractionBatchItem, ExtractionBatchItem.batch_id == ExtractionBatch.id)
                .where(
                    ExtractionBatchItem.attempt_id == attempt_id,
                    ExtractionBatch.agent_plan_digest.is_not(None),
                )
            )
        ).scalar_one_or_none()

    async def agent_articles_since(self, project_id: UUID, *, since: datetime) -> int:
        """Articles in the project's agent batches since ``since``, cancelled included."""
        return (
            await self.db.execute(
                select(func.count(ExtractionBatchItem.id))
                .join(ExtractionBatch, ExtractionBatch.id == ExtractionBatchItem.batch_id)
                .where(
                    ExtractionBatch.project_id == project_id,
                    ExtractionBatch.agent_plan_digest.is_not(None),
                    ExtractionBatch.created_at >= since,
                )
            )
        ).scalar_one()

    async def list_owned(
        self, owner_id: UUID, *, since: datetime, project_id: UUID | None
    ) -> list[ExtractionBatch]:
        stmt = select(ExtractionBatch).where(
            ExtractionBatch.owner_id == owner_id,
            ExtractionBatch.created_at >= since,
            _member(owner_id),
        )
        if project_id is not None:
            stmt = stmt.where(ExtractionBatch.project_id == project_id)
        stmt = stmt.order_by(ExtractionBatch.created_at.desc(), ExtractionBatch.id)
        return list((await self.db.execute(stmt)).scalars())

    async def item_rows(self, batch_ids: list[UUID]) -> dict[UUID, list[ItemRow]]:
        rows: dict[UUID, list[ItemRow]] = {batch_id: [] for batch_id in batch_ids}
        if not batch_ids:
            return rows
        stmt = (
            select(ExtractionBatchItem, Article.title, ExtractionAttempt)
            .join(Article, Article.id == ExtractionBatchItem.article_id)
            .outerjoin(ExtractionAttempt, ExtractionAttempt.id == ExtractionBatchItem.attempt_id)
            .where(ExtractionBatchItem.batch_id.in_(batch_ids))
            .order_by(ExtractionBatchItem.created_at, ExtractionBatchItem.id)
        )
        for item, title, attempt in (await self.db.execute(stmt)).all():
            rows[item.batch_id].append(
                ItemRow(
                    article_id=item.article_id,
                    title=title,
                    status=item.status,
                    reason_code=item.reason_code,
                    updated_at=item.updated_at,
                    attempt_id=item.attempt_id,
                    attempt_status=attempt.status if attempt else None,
                    attempt_result=attempt.result if attempt else None,
                    attempt_error_code=attempt.error_code if attempt else None,
                    attempt_error=attempt.error if attempt else None,
                    attempt_updated_at=attempt.updated_at if attempt else None,
                )
            )
        return rows

    async def labels(self, batch: ExtractionBatch) -> tuple[str, str, str, str | None]:
        """Project name, template name, kind and the starting credential's name
        (``None``: a UI batch, or the token row is gone)."""
        project_name, template_name, kind, token_name = (
            await self.db.execute(
                select(
                    Project.name,
                    ProjectExtractionTemplate.name,
                    ProjectExtractionTemplate.kind,
                    PersonalAccessToken.name,
                )
                .join(ProjectExtractionTemplate, ProjectExtractionTemplate.project_id == Project.id)
                .outerjoin(PersonalAccessToken, PersonalAccessToken.id == batch.agent_token_id)
                .where(
                    Project.id == batch.project_id,
                    ProjectExtractionTemplate.id == batch.template_id,
                )
            )
        ).one()
        return project_name, template_name, str(kind), token_name

    async def add(self, batch: ExtractionBatch, article_ids: list[UUID]) -> None:
        self.db.add(batch)
        await self.db.flush()
        self.db.add_all(
            ExtractionBatchItem(batch_id=batch.id, article_id=article_id)
            for article_id in article_ids
        )
        await self.db.flush()

    async def active_batch_id(self, owner_id: UUID, template_id: UUID) -> UUID | None:
        queued = (
            select(ExtractionBatchItem.id)
            .where(
                ExtractionBatchItem.batch_id == ExtractionBatch.id,
                ExtractionBatchItem.status == "queued",
            )
            .exists()
        )
        running = (
            select(ExtractionBatchItem.id)
            .join(ExtractionAttempt, ExtractionAttempt.id == ExtractionBatchItem.attempt_id)
            .where(
                ExtractionBatchItem.batch_id == ExtractionBatch.id,
                *_live_dispatched(),
            )
            .exists()
        )
        halted = ExtractionBatch.cancelled_at.is_not(None) | ExtractionBatch.stop_code.is_not(None)
        return (
            await self.db.execute(
                select(ExtractionBatch.id)
                .where(
                    ExtractionBatch.owner_id == owner_id,
                    ExtractionBatch.template_id == template_id,
                    running | (queued & ~halted),
                )
                .order_by(ExtractionBatch.created_at.desc())
                .limit(1)
            )
        ).scalar_one_or_none()

    async def stop(self, batch_id: UUID, stop_code: str, stop_message: str | None) -> bool:
        """Stop a batch nobody halted yet; ``False`` when a cancel or stop got there first.

        Conditional in the WHERE clause, so a concurrent cancel is never
        overwritten by a stop read from an older snapshot of the row.
        """
        stopped = await self.db.execute(
            update(ExtractionBatch)
            .where(
                ExtractionBatch.id == batch_id,
                ExtractionBatch.cancelled_at.is_(None),
                ExtractionBatch.stop_code.is_(None),
            )
            .values(stop_code=stop_code, stop_message=stop_message)
            .returning(ExtractionBatch.id)
        )
        return stopped.first() is not None

    async def stop_active_agent_batches(
        self, token_id: UUID, stop_code: str, stop_message: str
    ) -> list[UUID]:
        """Stop every un-halted batch ``token_id`` started that still has queued items.

        id-only on the token: every caller proved ownership of the credential
        or holds it. Conditional like :meth:`stop`, so a cancel is never overwritten.
        """
        queued = (
            select(ExtractionBatchItem.id)
            .where(
                ExtractionBatchItem.batch_id == ExtractionBatch.id,
                ExtractionBatchItem.status == "queued",
            )
            .exists()
        )
        stopped = await self.db.execute(
            update(ExtractionBatch)
            .where(
                ExtractionBatch.agent_token_id == token_id,
                ExtractionBatch.cancelled_at.is_(None),
                ExtractionBatch.stop_code.is_(None),
                queued,
            )
            .values(stop_code=stop_code, stop_message=stop_message)
            .returning(ExtractionBatch.id)
        )
        return list(stopped.scalars())

    async def cancel_if_active(self, batch_id: UUID, *, now: datetime) -> bool:
        """Cancel a batch nobody halted yet; ``False`` when a cancel or stop got there first.

        id-only: the caller already passed ``owned_batch``. Conditional like
        :meth:`stop`: of two concurrent halts, Postgres re-checks the WHERE on
        the locked row after the first commits, so exactly one gets the row.
        """
        cancelled = await self.db.execute(
            update(ExtractionBatch)
            .where(
                ExtractionBatch.id == batch_id,
                ExtractionBatch.cancelled_at.is_(None),
                ExtractionBatch.stop_code.is_(None),
            )
            .values(cancelled_at=now)
            .returning(ExtractionBatch.id)
        )
        return cancelled.first() is not None

    async def cancel_queued(self, batch_id: UUID, reason_code: str) -> int:
        """Queued items become cancelled; returns how many."""
        result = await self.db.execute(
            update(ExtractionBatchItem)
            .where(ExtractionBatchItem.batch_id == batch_id, ExtractionBatchItem.status == "queued")
            .values(status="cancelled", reason_code=reason_code)
        )
        return int(result.rowcount)  # type: ignore[attr-defined]

    async def count_in_flight(self, batch_id: UUID, *, since: datetime) -> int:
        return (
            await self.db.execute(
                select(func.count())
                .select_from(ExtractionBatchItem)
                .join(ExtractionAttempt, ExtractionAttempt.id == ExtractionBatchItem.attempt_id)
                .where(
                    ExtractionBatchItem.batch_id == batch_id,
                    *_live_dispatched(),
                    ExtractionAttempt.updated_at >= since,
                )
            )
        ).scalar_one()

    async def claim_queued(self, batch_id: UUID, limit: int) -> list[ExtractionBatchItem]:
        return list(
            (
                await self.db.execute(
                    select(ExtractionBatchItem)
                    .where(
                        ExtractionBatchItem.batch_id == batch_id,
                        ExtractionBatchItem.status == "queued",
                    )
                    .order_by(ExtractionBatchItem.created_at, ExtractionBatchItem.id)
                    .limit(limit)
                    .with_for_update(skip_locked=True)
                )
            ).scalars()
        )

    async def engine_stop_failure(self, batch_id: UUID) -> tuple[str, str | None] | None:
        row = (
            await self.db.execute(
                select(ExtractionAttempt.error_code, ExtractionAttempt.error)
                .join(ExtractionBatchItem, ExtractionBatchItem.attempt_id == ExtractionAttempt.id)
                .where(
                    ExtractionBatchItem.batch_id == batch_id,
                    ExtractionAttempt.status == "failed",
                    ExtractionAttempt.error_code.in_(ENGINE_STOP_CODES),
                )
                .order_by(ExtractionAttempt.updated_at.desc())
                .limit(1)
            )
        ).first()
        return (row[0], row[1]) if row else None

    async def stale_dispatched_attempts(
        self, batch_id: UUID, *, before: datetime
    ) -> list[ExtractionAttempt]:
        return list(
            (
                await self.db.execute(
                    select(ExtractionAttempt)
                    .join(
                        ExtractionBatchItem, ExtractionBatchItem.attempt_id == ExtractionAttempt.id
                    )
                    .where(
                        ExtractionBatchItem.batch_id == batch_id,
                        ExtractionBatchItem.status == "dispatched",
                        ExtractionAttempt.status.in_(ATTEMPT_LIVE),
                        ExtractionAttempt.updated_at < before,
                    )
                )
            ).scalars()
        )
