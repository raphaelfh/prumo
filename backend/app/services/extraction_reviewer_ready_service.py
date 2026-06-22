"""Service for the per-reviewer "ready" signal (HITL Phase 2).

Owns the write path (mark/un-mark) and the single home of the "N/M reviewers
ready" hint rule. Advisory only: readiness never gates a stage transition.
"""

from typing import Any
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.repositories.extraction_reviewer_ready_repository import (
    ExtractionReviewerReadyRepository,
)


class ExtractionReviewerReadyService:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db
        self._repo = ExtractionReviewerReadyRepository(db)

    async def mark_ready(self, *, run_id: UUID, reviewer_id: UUID, is_ready: bool) -> None:
        await self._repo.upsert(run_id=run_id, reviewer_id=reviewer_id, is_ready=is_ready)

    async def ready_summary_from(
        self, *, run_id: UUID, hitl_config_snapshot: dict[str, Any] | None
    ) -> dict[str, Any]:
        """The "N/M reviewers ready" hint. SINGLE home of the ``M`` rule (D3).

        ``N`` = reviewers with ``is_ready``; ``M`` = ``max(configured reviewer_count,
        N)`` so the hint never reads N > M when more reviewers mark ready than the
        (often inert, default-1) configured count.
        """
        ready = await self._repo.ready_reviewer_ids(run_id)
        reviewer_count = int((hitl_config_snapshot or {}).get("reviewer_count") or 1)
        return {
            "ready_count": len(ready),
            "reviewer_count": max(reviewer_count, len(ready)),
            "reviewers_ready": ready,
        }
