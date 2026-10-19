"""Per-article batch eligibility guards (spec 2026-09-15 §8, G8–G10), shared.

The dispatcher calls them on the locked run it is about to dispatch; the plan
calls them over a read-only run resolution to predict the same outcome. Each
predicate has ONE set-based form, so the two callers cannot drift apart.
Every function here is a pure read.
"""

from __future__ import annotations

from collections.abc import Collection
from datetime import datetime
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.extraction import ExtractionRunStage
from app.models.extraction_attempt import ExtractionAttempt
from app.models.extraction_workflow import ExtractionProposalRecord
from app.schemas.extraction_batch import ATTEMPT_LIVE
from app.services.extraction_run_write import RunWriteError

#: Stages a batch dispatch accepts: ``open_or_resume`` parks a pending run in
#: EXTRACT, and an absent run is created there.
_DISPATCHABLE_STAGES = frozenset(
    {ExtractionRunStage.PENDING.value, ExtractionRunStage.EXTRACT.value}
)


def stage_reason(stage: str | None) -> str | None:
    """G8 predicted over a resolved run (None when the article has no run)."""
    if stage is None or stage in _DISPATCHABLE_STAGES:
        return None
    if stage == ExtractionRunStage.FINALIZED.value:
        return "RUN_FINALIZED"
    return "RUN_NOT_EDITABLE"


def run_write_reason(exc: RunWriteError) -> str:
    """G8 on the dispatcher's refused locking open — never dispatchable."""
    if exc.reason == "missing":
        return "NO_LONGER_AVAILABLE"
    return stage_reason(exc.stage) or "RUN_NOT_EDITABLE"


async def runs_with_owner_live_attempt(
    db: AsyncSession,
    *,
    run_ids: Collection[UUID],
    owner_id: UUID,
    since: datetime,
    exclude_request_id: UUID | None = None,
) -> set[UUID]:
    """G9: the runs on which ``owner_id`` has an attempt live since ``since``."""
    if not run_ids:
        return set()
    stmt = (
        select(ExtractionAttempt.run_id)
        .distinct()
        .where(
            ExtractionAttempt.owner_id == owner_id,
            ExtractionAttempt.run_id.in_(run_ids),
            ExtractionAttempt.status.in_(ATTEMPT_LIVE),
            ExtractionAttempt.updated_at >= since,
        )
    )
    if exclude_request_id is not None:
        stmt = stmt.where(ExtractionAttempt.request_id != exclude_request_id)
    return set((await db.execute(stmt)).scalars())


async def runs_with_ai_suggestions(db: AsyncSession, run_ids: Collection[UUID]) -> set[UUID]:
    """G10: the runs that already hold an AI proposal."""
    if not run_ids:
        return set()
    stmt = (
        select(ExtractionProposalRecord.run_id)
        .distinct()
        .where(
            ExtractionProposalRecord.run_id.in_(run_ids),
            ExtractionProposalRecord.source == "ai",
        )
    )
    return set((await db.execute(stmt)).scalars())
