"""Advance one AI batch (spec 2026-09-15 §8): claim, guard, dispatch, stop.

Called by the ``advance_extraction_batch`` task after a kickoff, after every
attempt's success or final failure (Celery ``link`` / ``link_error``), and on
Resume. A per-batch advisory lock serializes calls: a second call waits, then
recounts, so a freed slot is never lost. Every write commits before the queue
is touched.

Why the lock lives on a connection of its own
---------------------------------------------
``pg_advisory_lock`` is scoped to the Postgres *backend session*, and a
SQLAlchemy ``Session`` releases its connection at the end of every
transaction. Under ``worker_session()`` (NullPool) releasing CLOSES the
connection, so taking the lock on ``self.db`` would drop it at the FIRST
commit — and ``_advance`` commits repeatedly, because ``prepare_request``
commits mid-loop. That left the claim/dispatch loop unserialized (two
completion callbacks could claim and dispatch the same item), made the unlock
run against a backend that never held the lock, and — on the pooled API
engine — returned a connection to the pool still holding a lock nothing could
release.

Restructuring ``advance`` to contain no commit is not available: committing
before queue IO is the design. So the lock is taken on a DEDICATED connection
held for the whole call, which decouples its lifetime from the domain
session's transaction churn. Cost: one extra connection for the duration of an
advance.
"""

from __future__ import annotations

from collections.abc import AsyncIterator, Callable
from contextlib import asynccontextmanager
from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4, uuid5

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncConnection, AsyncEngine, AsyncSession

from app.core.error_handler import ConflictError, NotFoundError
from app.core.logging import get_logger
from app.models.extraction_attempt import ExtractionAttempt
from app.models.extraction_batch import ExtractionBatch, ExtractionBatchItem
from app.models.extraction_versioning import TemplateKind
from app.models.extraction_workflow import ExtractionProposalRecord
from app.repositories.extraction_batch_repository import ExtractionBatchRepository
from app.schemas.extraction import SectionExtractionRequest
from app.schemas.extraction_batch import ATTEMPT_LIVE
from app.services.article_read_service import ArticleNotFoundError, owned_articles
from app.services.extraction_attempt_service import ExtractionAttemptService
from app.services.extraction_run_read_service import get_run_or_raise
from app.services.hitl_session_service import HITLSessionInputError, HITLSessionService
from app.services.project_template_active_service import (
    ProjectTemplateNotFoundError,
    owned_template,
)
from app.services.run_lifecycle_service import InvalidStageTransitionError

logger = get_logger(__name__)

EnqueueAttempt = Callable[[ExtractionAttempt, UUID], None]

_REQUEST_NAMESPACE = UUID("6f0d0c1e-7a47-4f5e-9d61-3b1f0f4a9b20")

_LOCK_SQL = "SELECT pg_advisory_lock(hashtextextended(:k, 0))"
_UNLOCK_SQL = "SELECT pg_advisory_unlock(hashtextextended(:k, 0))"


def batch_request_id(item_id: UUID) -> UUID:
    """The attempt request id of a batch item — stable, so Resume is idempotent."""
    return uuid5(_REQUEST_NAMESPACE, str(item_id))


class ExtractionBatchDispatcher:
    MAX_IN_FLIGHT = 2
    #: An in-flight attempt untouched this long no longer holds a slot or blocks
    #: G9, and Resume re-enqueues it (Redis visibility timeout is 1h too).
    LIVE_WINDOW = timedelta(hours=1)

    def __init__(
        self,
        db: AsyncSession,
        *,
        enqueue: EnqueueAttempt,
        now: Callable[[], datetime] = lambda: datetime.now(UTC),
    ) -> None:
        self.db = db
        self.enqueue = enqueue
        self.now = now
        self.batches = ExtractionBatchRepository(db)

    async def advance(self, batch_id: UUID, *, reenqueue_stale: bool = False) -> None:
        async with self._batch_lock(batch_id):
            try:
                await self._advance(batch_id, reenqueue_stale=reenqueue_stale)
                await self.db.commit()
            except Exception:
                await self.db.rollback()
                raise

    def _engine(self) -> AsyncEngine:
        """The engine behind ``self.db`` — a session may be bound to either."""
        bind = self.db.bind
        if isinstance(bind, AsyncConnection):
            return bind.engine
        return bind

    @asynccontextmanager
    async def _batch_lock(self, batch_id: UUID) -> AsyncIterator[None]:
        """Hold this batch's advisory lock for the whole call, on one pinned backend.

        The connection is never committed, so its backend session — and the
        lock with it — survives every commit ``self.db`` makes. Closing the
        connection would release the lock on its own; the explicit unlock keeps
        a POOLED connection from going back to the pool still holding it.
        """
        key = {"k": f"extraction_batch:{batch_id}"}
        async with self._engine().connect() as lock_conn:
            await lock_conn.execute(text(_LOCK_SQL), key)
            try:
                yield
            finally:
                await lock_conn.execute(text(_UNLOCK_SQL), key)

    async def _advance(self, batch_id: UUID, *, reenqueue_stale: bool) -> None:
        batch = await self.db.get(ExtractionBatch, batch_id)
        if batch is None:
            return  # cascaded away with its project, tool or owner

        if batch.cancelled_at is not None or batch.stop_code is not None:
            reason = "CANCELLED" if batch.cancelled_at is not None else "STOPPED_ENGINE_ERROR"
            await self.batches.cancel_queued(batch.id, reason)
            await self.db.commit()
            return

        failure = await self.batches.engine_stop_failure(batch.id)
        if failure is not None:
            batch.stop_code, batch.stop_message = failure
            await self.batches.cancel_queued(batch.id, "STOPPED_ENGINE_ERROR")
            await self.db.commit()
            logger.warning("extraction_batch.stopped", batch_id=str(batch.id), stop_code=failure[0])
            return

        if reenqueue_stale:
            stale = await self.batches.stale_dispatched_attempts(
                batch.id, before=self.now() - self.LIVE_WINDOW
            )
            await self.db.commit()
            for attempt in stale:
                self.enqueue(attempt, batch.id)

        # G6/G7 are constant for the whole advance: same owner, same project,
        # same tool. Resolve once rather than per item.
        kind = await self._template_kind(batch)
        is_reviewer = await self._is_reviewer(batch)
        while True:
            live_since = self.now() - self.LIVE_WINDOW
            capacity = self.MAX_IN_FLIGHT - await self.batches.count_in_flight(
                batch.id, since=live_since
            )
            if capacity <= 0:
                return
            claimed = await self.batches.claim_queued(batch.id, capacity)
            if not claimed:
                await self.db.commit()
                return
            for item in claimed:
                await self._dispatch_one(batch, item, kind, is_reviewer=is_reviewer)

    async def _template_kind(self, batch: ExtractionBatch) -> str | None:
        try:
            template = await owned_template(
                self.db, project_id=batch.project_id, template_id=batch.template_id
            )
        except ProjectTemplateNotFoundError:
            return None
        return str(template.kind) if template.is_active else None

    async def _is_reviewer(self, batch: ExtractionBatch) -> bool:
        """G6 — the SQL helper the RLS policies call, never a hand-rolled copy."""
        return bool(
            (
                await self.db.execute(
                    text("SELECT public.is_project_reviewer(:pid, :uid)"),
                    {"pid": str(batch.project_id), "uid": str(batch.owner_id)},
                )
            ).scalar_one()
        )

    async def _dispatch_one(
        self,
        batch: ExtractionBatch,
        item: ExtractionBatchItem,
        kind: str | None,
        *,
        is_reviewer: bool,
    ) -> None:
        reason = await self._preflight(batch, item, kind, is_reviewer=is_reviewer)
        if reason is not None:
            await self._skip(item, reason)
            return
        assert kind is not None

        try:
            session = await HITLSessionService(self.db).open_or_resume(
                kind=TemplateKind(kind),
                project_id=batch.project_id,
                article_id=item.article_id,
                user_id=batch.owner_id,
                project_template_id=batch.template_id,
            )
            run = await get_run_or_raise(self.db, session.run_id)
            reason = await self._run_reason(batch, item, run.id, run.stage)
            if reason is not None:
                await self._skip(item, reason)
                return
            attempt = await ExtractionAttemptService(self.db).prepare_request(
                # Built from a dict, not kwargs: every field carries a camelCase
                # alias, so keyword construction is a mypy `call-arg` error the
                # ratchet would have to grandfather (see .mypy_baseline's
                # section_extraction.py entry). ``populate_by_name`` accepts the
                # field names here, and validation is identical.
                SectionExtractionRequest.model_validate(
                    {
                        "request_id": batch_request_id(item.id),
                        "project_id": batch.project_id,
                        "article_id": item.article_id,
                        "template_id": batch.template_id,
                        "run_id": run.id,
                        "extract_all_sections": kind == TemplateKind.EXTRACTION.value,
                        "skip_fields_with_human_proposals": True,
                    }
                ),
                batch.owner_id,
                job_id=str(uuid4()),
            )
        except (HITLSessionInputError, NotFoundError, ConflictError):
            await self._skip(item, "NO_LONGER_AVAILABLE", discard_writes=True)
            return
        except InvalidStageTransitionError:
            await self._skip(item, "RUN_NOT_EDITABLE", discard_writes=True)
            return

        item = await self.db.merge(item)
        item.attempt_id, item.status = attempt.id, "dispatched"
        await self.db.commit()
        if attempt.status in ATTEMPT_LIVE:
            self.enqueue(attempt, batch.id)

    async def _preflight(
        self,
        batch: ExtractionBatch,
        item: ExtractionBatchItem,
        kind: str | None,
        *,
        is_reviewer: bool,
    ) -> str | None:
        """G6 reviewer role, G7 article and tool still there."""
        if not is_reviewer or kind is None:
            return "NO_LONGER_AVAILABLE"
        try:
            await owned_articles(
                self.db, project_id=batch.project_id, article_ids=[item.article_id]
            )
        except ArticleNotFoundError:
            return "NO_LONGER_AVAILABLE"
        return None

    async def _run_reason(
        self, batch: ExtractionBatch, item: ExtractionBatchItem, run_id: UUID, stage: str
    ) -> str | None:
        """G8 run stage, G9 owner already running AI, G10 existing AI suggestions."""
        if stage == "finalized":
            return "RUN_FINALIZED"
        if stage != "extract":
            return "RUN_NOT_EDITABLE"
        running = (
            await self.db.execute(
                select(ExtractionAttempt.id)
                .where(
                    ExtractionAttempt.owner_id == batch.owner_id,
                    ExtractionAttempt.run_id == run_id,
                    ExtractionAttempt.status.in_(ATTEMPT_LIVE),
                    ExtractionAttempt.updated_at >= self.now() - self.LIVE_WINDOW,
                    ExtractionAttempt.request_id != batch_request_id(item.id),
                )
                .limit(1)
            )
        ).first()
        if running is not None:
            return "AI_ALREADY_RUNNING"
        if batch.skip_articles_with_ai_suggestions and await self._run_has_ai_suggestions(run_id):
            return "ALREADY_HAS_AI_SUGGESTIONS"
        return None

    async def _run_has_ai_suggestions(self, run_id: UUID) -> bool:
        return (
            await self.db.execute(
                select(ExtractionProposalRecord.id)
                .where(
                    ExtractionProposalRecord.run_id == run_id,
                    ExtractionProposalRecord.source == "ai",
                )
                .limit(1)
            )
        ).first() is not None

    async def _skip(
        self, item: ExtractionBatchItem, reason: str, *, discard_writes: bool = False
    ) -> None:
        # Only a half-done session open has writes to discard; a guard skip has none.
        if discard_writes:
            await self.db.rollback()
        item = await self.db.merge(item)
        item.status, item.reason_code = "skipped", reason
        await self.db.commit()
