"""Service for publishing consensus decisions and authoritative state."""

from fastapi import HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from uuid import UUID

from app.models.evaluation_decision import ConsensusDecisionRecord
from app.repositories.evaluation_consensus_repository import EvaluationConsensusRepository
from app.repositories.evaluation_published_state_repository import (
    EvaluationPublishedStateRepository,
)
from app.schemas.evaluation_consensus import CreateConsensusDecisionRequest
from app.services.evaluation_observability_service import (
    log_evaluation_event,
    log_publish_conflict,
)


class EvaluationConsensusService:
    """Coordinates consensus writes and published state updates."""

    def __init__(self, db: AsyncSession, user_id: UUID, trace_id: str):
        self.db = db
        self.user_id = user_id
        self.trace_id = trace_id
        self._consensus = EvaluationConsensusRepository(db)
        self._published = EvaluationPublishedStateRepository(db)

    async def publish(self, payload: CreateConsensusDecisionRequest):
        existing = await self._published.get_by_key(
            project_id=payload.project_id,
            target_id=payload.target_id,
            item_id=payload.item_id,
            schema_version_id=payload.schema_version_id,
        )
        if existing and payload.expected_updated_at:
            lock_ok = await self._published.assert_optimistic_lock(
                table_name="published_states",
                row_id=existing.id,
                expected_updated_at=payload.expected_updated_at,
            )
            if not lock_ok:
                log_publish_conflict(
                    target_id=payload.target_id,
                    item_id=payload.item_id,
                    schema_version_id=payload.schema_version_id,
                    trace_id=self.trace_id,
                )
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="Consensus publication conflict",
                )

        if payload.mode == "select_existing":
            published_value = {"source": "reviewer_decision", "id": str(payload.selected_reviewer_decision_id)}
        else:
            published_value = payload.override_value or {}

        consensus = ConsensusDecisionRecord(
            project_id=payload.project_id,
            target_id=payload.target_id,
            item_id=payload.item_id,
            schema_version_id=payload.schema_version_id,
            run_id=payload.run_id,
            decision_maker_id=self.user_id,
            mode=payload.mode,
            selected_reviewer_decision_id=payload.selected_reviewer_decision_id,
            override_value_json=payload.override_value,
            override_justification=payload.override_justification,
        )
        consensus = await self._consensus.append(consensus)
        published = await self._published.upsert(
            project_id=payload.project_id,
            target_id=payload.target_id,
            item_id=payload.item_id,
            schema_version_id=payload.schema_version_id,
            latest_consensus_decision_id=consensus.id,
            published_value_json=published_value,
        )
        await self.db.commit()
        log_evaluation_event(
            "evaluation_consensus_published",
            trace_id=self.trace_id,
            run_id=payload.run_id,
            project_id=payload.project_id,
            extra={"mode": payload.mode},
        )
        return published
