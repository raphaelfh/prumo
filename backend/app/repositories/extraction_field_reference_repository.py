"""Which fields the review workflow already references (B-9b2a D5).

Promoted here out of ``template_discard_service`` so its destructive-delete
gate and the config-diff read's ``affects_recorded_data`` flag cannot
diverge: they are the same question ("has a human or the AI recorded
anything for this field?") asked by two features, and a second copy of the
UNION is a second chance to answer it differently.

Plain ``self.db`` rather than ``BaseRepository[Model]``: this is a five-model
union with no single owning model (same shape as
``ExtractionProposalRepository``).
"""

from collections.abc import Sequence
from uuid import UUID

from sqlalchemy import select, union
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.extraction_workflow import (
    ExtractionConsensusDecision,
    ExtractionProposalRecord,
    ExtractionPublishedState,
    ExtractionReviewerDecision,
    ExtractionReviewerState,
)

#: Tables whose ``field_id`` means "a human or the AI recorded something for
#: this field". Every one of them is an ON DELETE RESTRICT reference, which
#: is what lets a caller treat "absent from the live tree" as "provably holds
#: no recorded work" — the delete would have been refused otherwise.
_WORKFLOW_TABLES = (
    ExtractionProposalRecord,
    ExtractionReviewerDecision,
    ExtractionReviewerState,
    ExtractionConsensusDecision,
    ExtractionPublishedState,
)


class ExtractionFieldReferenceRepository:
    """Read access across the five ``field_id`` RESTRICT tables."""

    def __init__(self, db: AsyncSession):
        self.db = db

    async def fields_with_recorded_work(self, field_ids: Sequence[UUID]) -> frozenset[UUID]:
        """Which of ``field_ids`` the review workflow already references."""
        if not field_ids:
            return frozenset()
        rows = await self.db.execute(
            union(
                *(
                    select(model.field_id).where(model.field_id.in_(field_ids))
                    for model in _WORKFLOW_TABLES
                )
            )
        )
        return frozenset(rows.scalars().all())
