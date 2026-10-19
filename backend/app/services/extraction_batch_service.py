"""AI batch runs: the ownership guard, reads, the one start path, create and cancel.

Writes only flush: the caller commits, then kicks the dispatcher.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.error_handler import AppError
from app.models.extraction_batch import ExtractionBatch
from app.repositories.extraction_batch_repository import ExtractionBatchRepository
from app.schemas.common import ApiErrorCode
from app.schemas.extraction_batch import (
    CreateExtractionBatchRequest,
    ExtractionBatchDetail,
    ExtractionBatchSummary,
    ItemRow,
)
from app.schemas.llm_target import EngineIdentity
from app.services import engine_credentials
from app.services.advisory_locks import take_advisory_xact_lock
from app.services.article_read_service import ArticleNotFoundError, owned_articles
from app.services.extraction_batch_view import derive_batch
from app.services.project_template_active_service import (
    ProjectTemplateNotFoundError,
    owned_template,
)
from app.worker import queue_health

LIST_WINDOW = timedelta(days=7)
AGENT_CAP_WINDOW = timedelta(hours=24)
# Second half of the project's agent-start advisory lock key (fixed, random).
AGENT_CAP_LOCK = UUID("6f1d3c52-8a47-4e0b-9b6e-2c5d7a91f3e4")


@dataclass(frozen=True, slots=True)
class AgentRunOrigin:
    """Who started an agent batch, on which approved engine, for which plan."""

    token_id: UUID
    engine: EngineIdentity
    plan_digest: str
    daily_cap: int  # the policy's daily_agent_article_cap at start


@dataclass(frozen=True, slots=True)
class StartResult:
    batch_id: UUID
    replayed: bool  # True: this plan already started; nothing was written


class BatchNotFoundError(Exception):
    """Missing, foreign, or no longer visible to its owner — one error for all."""


class BatchScopeError(Exception):
    """The template or an article is missing or outside the project (one error, G2/G3)."""


class QueueUnavailableError(Exception):
    """The extraction queue did not answer the probe; nothing was written."""


class DailyAgentCapError(Exception):
    """The start would pass the project's daily agent article cap; ``args[0]``
    is what is left today. Nothing was written."""

    def __init__(self, remaining: int) -> None:
        super().__init__(remaining)


class BatchAlreadyActiveError(AppError):
    """The caller already runs a batch for this tool (G5b)."""

    def __init__(self, batch_id: UUID) -> None:
        super().__init__(
            code=ApiErrorCode.AI_BATCH_ALREADY_ACTIVE.value,
            message="An AI batch is already running for this tool",
            status_code=409,
            details={"batch_id": str(batch_id)},
        )


async def owned_batch(db: AsyncSession, *, owner_id: UUID, batch_id: UUID) -> ExtractionBatch:
    """THE batch guard: owned by ``owner_id``, who is still a project member.

    Owner and membership live in the WHERE clause, so a foreign batch and a
    missing one raise the same error with the same message.
    """
    batch = await ExtractionBatchRepository(db).get_owned(batch_id, owner_id)
    if batch is None:
        raise BatchNotFoundError("Batch not found")
    return batch


async def agent_batch_for_attempt(db: AsyncSession, attempt_id: UUID) -> UUID | None:
    """The agent-started batch ``attempt_id`` runs for, else ``None``.

    Worker-side, behind the attempt the worker already owns: an agent batch's
    attempt never runs on the deployment key.
    """
    return await ExtractionBatchRepository(db).agent_batch_of_attempt(attempt_id)


class ExtractionBatchService:
    def __init__(self, db: AsyncSession):
        self.db = db
        self.batches = ExtractionBatchRepository(db)

    async def detail(
        self, owner_id: UUID, batch_id: UUID, *, now: datetime
    ) -> ExtractionBatchDetail:
        batch = await owned_batch(self.db, owner_id=owner_id, batch_id=batch_id)
        rows = (await self.batches.item_rows([batch.id]))[batch.id]
        summary = await self._summary(batch, rows, now)
        items = derive_batch(
            cancelled_at=batch.cancelled_at,
            stop_code=batch.stop_code,
            created_at=batch.created_at,
            rows=rows,
            now=now,
        ).items
        return ExtractionBatchDetail(**summary.model_dump(), items=items)

    async def list_for_owner(
        self, owner_id: UUID, *, project_id: UUID | None, active_only: bool, now: datetime
    ) -> list[ExtractionBatchSummary]:
        batches = await self.batches.list_owned(
            owner_id, since=now - LIST_WINDOW, project_id=project_id
        )
        rows = await self.batches.item_rows([b.id for b in batches])
        summaries = [await self._summary(b, rows[b.id], now) for b in batches]
        return [s for s in summaries if s.state == "active"] if active_only else summaries

    async def _summary(
        self, batch: ExtractionBatch, rows: list[ItemRow], now: datetime
    ) -> ExtractionBatchSummary:
        view = derive_batch(
            cancelled_at=batch.cancelled_at,
            stop_code=batch.stop_code,
            created_at=batch.created_at,
            rows=rows,
            now=now,
        )
        project_name, template_name, kind = await self.batches.labels(batch)
        return ExtractionBatchSummary(
            id=batch.id,
            project_id=batch.project_id,
            project_name=project_name,
            template_id=batch.template_id,
            template_name=template_name,
            kind=kind,
            created_at=batch.created_at,
            finished_at=view.finished_at,
            state=view.state,
            stalled=view.stalled,
            stop_code=batch.stop_code,
            stop_message=batch.stop_message,
            counts=view.counts,
        )

    async def lock_agent_starts(self, project_id: UUID) -> None:
        """Serialize every agent start in the project until commit or rollback.

        Re-entrant within one transaction (``pg_advisory_xact_lock`` stacks).
        Taken before ``create``'s (owner, template) lock, never after.
        """
        await take_advisory_xact_lock(self.db, project_id, AGENT_CAP_LOCK)

    async def batch_for_plan(
        self, owner_id: UUID, plan_digest: str, *, project_id: UUID
    ) -> UUID | None:
        """The owner's batch started from ``plan_digest`` in the project, if any."""
        return await self.batches.owned_by_plan_digest(owner_id, plan_digest, project_id=project_id)

    async def agent_origin(
        self, owner_id: UUID, batch_id: UUID
    ) -> tuple[UUID | None, EngineIdentity | None]:
        """The token and engine an owned agent batch was started with."""
        batch = await owned_batch(self.db, owner_id=owner_id, batch_id=batch_id)
        engine = EngineIdentity.model_validate(batch.agent_engine) if batch.agent_engine else None
        return batch.agent_token_id, engine

    async def start(
        self,
        owner_id: UUID,
        request: CreateExtractionBatchRequest,
        *,
        agent: AgentRunOrigin | None = None,
    ) -> StartResult:
        """THE batch start path: engine check -> queue probe -> flush-only create.

        The caller checked the role (G1), commits, then calls ``kick_batch``.
        The engine errors (409) and :class:`QueueUnavailableError` are raised
        before any row is written.

        An agent start runs under the project's agent-start lock: an already
        started plan replays (no write, no checks), the deployment key is
        refused, and :class:`DailyAgentCapError` keeps the project's agent
        articles of the last 24 h within ``agent.daily_cap``. A second batch
        for one digest is impossible (unique index); no code path expects it.
        """
        if agent is not None:
            await self.lock_agent_starts(request.project_id)
            found = await self.batch_for_plan(
                owner_id, agent.plan_digest, project_id=request.project_id
            )
            if found is not None:
                return StartResult(batch_id=found, replayed=True)
        await engine_credentials.assert_engine_ready(
            self.db, project_id=request.project_id, user_id=owner_id, allow_global=agent is None
        )
        if not queue_health.is_queue_available():
            raise QueueUnavailableError
        if agent is not None:
            used = await self.batches.agent_articles_since(
                request.project_id, since=datetime.now(UTC) - AGENT_CAP_WINDOW
            )
            if len(request.article_ids) > agent.daily_cap - used:
                raise DailyAgentCapError(max(0, agent.daily_cap - used))
        batch_id = await self.create(owner_id, request, agent=agent)
        return StartResult(batch_id=batch_id, replayed=False)

    async def create(
        self,
        owner_id: UUID,
        request: CreateExtractionBatchRequest,
        *,
        agent: AgentRunOrigin | None = None,
    ) -> UUID:
        """G2, G3, G5b, then the rows (flushed, not committed)."""
        try:
            await owned_template(
                self.db, project_id=request.project_id, template_id=request.template_id
            )
            article_ids = await owned_articles(
                self.db, project_id=request.project_id, article_ids=request.article_ids
            )
        except (ProjectTemplateNotFoundError, ArticleNotFoundError) as exc:
            raise BatchScopeError("template_id or article_ids do not belong to project_id") from exc

        await take_advisory_xact_lock(self.db, owner_id, request.template_id)
        active = await self.batches.active_batch_id(owner_id, request.template_id)
        if active is not None:
            raise BatchAlreadyActiveError(active)

        batch = ExtractionBatch(
            owner_id=owner_id,
            project_id=request.project_id,
            template_id=request.template_id,
            skip_articles_with_ai_suggestions=request.skip_articles_with_ai_suggestions,
            agent_token_id=agent.token_id if agent else None,
            agent_engine=agent.engine.model_dump(mode="json") if agent else None,
            agent_plan_digest=agent.plan_digest if agent else None,
        )
        await self.batches.add(batch, article_ids)
        return batch.id

    async def cancel(self, owner_id: UUID, batch_id: UUID, *, now: datetime) -> None:
        """Queued articles become not-run; in-flight ones finish (spec §7.1)."""
        batch = await owned_batch(self.db, owner_id=owner_id, batch_id=batch_id)
        if batch.cancelled_at is None:
            batch.cancelled_at = now
        await self.batches.cancel_queued(batch.id, "CANCELLED")
        await self.db.flush()
