"""Internal helper: load an ExtractionRun under SELECT … FOR UPDATE.

Closes the TOCTOU race between a service's check-then-mutate sequence
(typically `if run.stage == X: append(record)`) and a concurrent
`run_lifecycle_service.advance_stage` that flips the stage between the
read and the write.

Caller contract:
- MUST be inside an open transaction (every prumo service call is).
- The row lock is released when the transaction commits or rolls back.
- Postgres serializes any UPDATE on the locked row, so a concurrent
  `advance_stage` blocks until this transaction completes.

The underscore prefix marks this as a service-package internal — only
the extraction_{consensus,proposal,review}_service modules import it.
"""

from __future__ import annotations

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.extraction import ExtractionRun


async def load_run_for_update(db: AsyncSession, run_id: UUID) -> ExtractionRun | None:
    stmt = select(ExtractionRun).where(ExtractionRun.id == run_id).with_for_update()
    result = await db.execute(stmt)
    return result.scalar_one_or_none()
