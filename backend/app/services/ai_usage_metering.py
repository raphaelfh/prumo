"""Metering: every model call writes one ``ai_usage_ledger`` row.

:func:`metered` wraps a :class:`~app.llm.extractor.StructuredCall`. Each call
is classified by its prompt name through the one map
(``app.llm.pass_kinds.PASS_KIND_BY_PROMPT``) and recorded once — ``ok`` with
the usage it returned, or ``failed`` with the usage the adapter attached to
the exception (zero when none) before the exception propagates. The context
(project, owner, run, attempt, engine, key scope) is read per call, never
captured at wrap time: the run and the frozen engine settle after the wrap.

A ledger write failure is surfaced, never swallowed: on an answered call it
is raised as :class:`~app.llm.extractor.UsageLedgerWriteError` (the output is
not landed without its row); on a call that already failed the model's
exception stays primary, and the sink error is logged at error level and
attached to it as a note.

:class:`LedgerSink` writes each row in its own short transaction from an
injected session factory (``app.core.factories.create_ledger_session_factory``),
so a run rollback never erases usage. The worker is its only production
builder; tests inject a recording fake.
"""

from __future__ import annotations

from collections.abc import Callable, Sequence
from dataclasses import dataclass
from typing import Any, Literal, Protocol
from uuid import UUID

from pydantic_ai import UsageLimits
from pydantic_ai.models import Model
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.core.logging import get_logger
from app.llm.extractor import (
    OUTPUT_RETRIES_DEFAULT,
    LlmUsage,
    OutputT,
    StructuredCall,
    UsageLedgerWriteError,
    failed_usage,
)
from app.llm.pass_kinds import PASS_KIND_BY_PROMPT, PassKind
from app.models.extraction_batch import ExtractionBatchItem
from app.repositories.ai_usage_ledger_repository import AiUsageLedgerRepository

logger = get_logger(__name__)

Outcome = Literal["ok", "failed"]


@dataclass(frozen=True)
class UsageContext:
    """Who and what a model call is billed to, read at call time."""

    project_id: UUID | None
    owner_id: UUID | None
    run_id: UUID | None
    attempt_id: UUID | None
    provider: str
    model: str
    key_scope: str | None


class UsageSink(Protocol):
    async def record(
        self,
        ctx: UsageContext,
        *,
        pass_kind: PassKind,
        prompt_version: str,
        usage: LlmUsage,
        outcome: Outcome,
    ) -> None: ...


def _id(value: UUID | None) -> str | None:
    return str(value) if value is not None else None


class LedgerSink:
    """Writes one ledger row per call, each in its own short transaction.

    Catches nothing: a write error propagates to :func:`metered`. The batch a
    call belongs to is resolved once per attempt and cached.
    """

    def __init__(self, session_factory: async_sessionmaker[AsyncSession]) -> None:
        self.session_factory = session_factory
        self._batch_ids: dict[UUID, UUID | None] = {}

    async def record(
        self,
        ctx: UsageContext,
        *,
        pass_kind: PassKind,
        prompt_version: str,
        usage: LlmUsage,
        outcome: Outcome,
    ) -> None:
        if ctx.project_id is None:
            # No run is open yet, and the ledger's project is NOT NULL.
            logger.warning(
                "usage_ledger_skipped", pass_kind=pass_kind, attempt_id=_id(ctx.attempt_id)
            )
            return
        async with self.session_factory() as session, session.begin():
            await AiUsageLedgerRepository(session).append(
                project_id=ctx.project_id,
                owner_id=ctx.owner_id,
                run_id=ctx.run_id,
                attempt_id=ctx.attempt_id,
                batch_id=await self._batch_id(session, ctx.attempt_id),
                provider=ctx.provider,
                model=ctx.model,
                key_scope=ctx.key_scope,
                pass_kind=pass_kind,
                prompt_version=prompt_version,
                prompt_tokens=usage.prompt_tokens,
                completion_tokens=usage.completion_tokens,
                outcome=outcome,
                request_id=usage.request_ids[-1] if usage.request_ids else None,
            )

    async def _batch_id(self, session: AsyncSession, attempt_id: UUID | None) -> UUID | None:
        if attempt_id is None:
            return None
        if attempt_id not in self._batch_ids:
            self._batch_ids[attempt_id] = await session.scalar(
                select(ExtractionBatchItem.batch_id).where(
                    ExtractionBatchItem.attempt_id == attempt_id
                )
            )
        return self._batch_ids[attempt_id]


def metered(
    llm: StructuredCall, sink: UsageSink, context: Callable[[], UsageContext]
) -> StructuredCall:
    """``llm`` with one sink record per call (see the module docstring)."""

    async def call(
        *,
        output_model: type[OutputT],
        system_prompt: str,
        user_prompt: str,
        model: Model,
        prompt_name: str,
        prompt_version: str,
        validators: Sequence[Callable[..., Any]] = (),
        output_retries: int = OUTPUT_RETRIES_DEFAULT,
        usage_limits: UsageLimits | None = None,
    ) -> tuple[OutputT, LlmUsage]:
        kind = PASS_KIND_BY_PROMPT[prompt_name]
        try:
            output, usage = await llm(
                output_model=output_model,
                system_prompt=system_prompt,
                user_prompt=user_prompt,
                model=model,
                prompt_name=prompt_name,
                prompt_version=prompt_version,
                validators=validators,
                output_retries=output_retries,
                usage_limits=usage_limits,
            )
        except Exception as exc:
            ctx = context()
            try:
                await sink.record(
                    ctx,
                    pass_kind=kind,
                    prompt_version=prompt_version,
                    usage=failed_usage(exc),
                    outcome="failed",
                )
            except Exception as sink_error:
                logger.error(
                    "usage_ledger_write_failed",
                    pass_kind=kind,
                    run_id=_id(ctx.run_id),
                    attempt_id=_id(ctx.attempt_id),
                    error_type=type(sink_error).__name__,
                )
                exc.add_note(
                    f"usage ledger write failed: {type(sink_error).__name__}: {sink_error}"
                )
            raise
        try:
            await sink.record(
                context(), pass_kind=kind, prompt_version=prompt_version, usage=usage, outcome="ok"
            )
        except Exception as sink_error:
            raise UsageLedgerWriteError(
                f"usage ledger write failed for a {kind} call: {type(sink_error).__name__}"
            ) from sink_error
        return output, usage

    return call
