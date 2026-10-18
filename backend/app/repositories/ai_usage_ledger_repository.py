"""The ``ai_usage_ledger`` write path: append only.

Rows are never updated or deleted here; the caller owns the transaction
(the metering sink opens one short transaction per model call).
"""

from __future__ import annotations

from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.ai_usage_ledger import AiUsageLedger


class AiUsageLedgerRepository:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def append(self, **values: Any) -> None:
        """Add one ledger row and flush it; never commits."""
        self.db.add(AiUsageLedger(**values))
        await self.db.flush()
