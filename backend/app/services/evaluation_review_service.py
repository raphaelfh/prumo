"""Service for review queue reads and reviewer decision writes."""

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.evaluation_decision import ReviewerDecisionRecord
from app.models.evaluation_run import ProposalRecord
from app.repositories.evaluation_reviewer_decision_repository import (
    EvaluationReviewerDecisionRepository,
)
from app.repositories.evaluation_reviewer_state_repository import (
    EvaluationReviewerStateRepository,
)
from app.schemas.evaluation_review import CreateReviewerDecisionRequest, ReviewQueueItem
from app.services.evaluation_observability_service import log_evaluation_event


class EvaluationReviewService:
    """Business logic for reviewer queue and decision lifecycle."""

    def __init__(self, db: AsyncSession, user_id: UUID, trace_id: str):
        self.db = db
        self.user_id = user_id
        self.trace_id = trace_id
        self._decisions = EvaluationReviewerDecisionRepository(db)
        self._states = EvaluationReviewerStateRepository(db)

    async def list_review_queue(
        self,
        *,
        run_id: UUID | None = None,
        status: str | None = None,
    ) -> list[ReviewQueueItem]:
        query = select(ProposalRecord)
        if run_id:
            query = query.where(ProposalRecord.run_id == run_id)
        proposals_result = await self.db.execute(query.order_by(ProposalRecord.created_at.desc()).limit(200))
        proposals = list(proposals_result.scalars().all())

        items: list[ReviewQueueItem] = []
        for proposal in proposals:
            reviewer_state = await self._states.get_by_identity(
                reviewer_id=self.user_id,
                target_id=proposal.target_id,
                item_id=proposal.item_id,
                schema_version_id=proposal.schema_version_id,
            )
            state_value = reviewer_state.latest_decision if reviewer_state else "pending"
            if status == "pending" and state_value != "pending":
                continue
            if status == "decided" and state_value == "pending":
                continue
            items.append(
                ReviewQueueItem(
                    run_id=proposal.run_id,
                    target_id=proposal.target_id,
                    item_id=proposal.item_id,
                    latest_proposal_id=proposal.id,
                    reviewer_state=state_value,
                )
            )
        return items

    async def submit_decision(self, payload: CreateReviewerDecisionRequest) -> ReviewerDecisionRecord:
        decision = ReviewerDecisionRecord(
            project_id=payload.project_id,
            run_id=payload.run_id,
            target_id=payload.target_id,
            item_id=payload.item_id,
            schema_version_id=payload.schema_version_id,
            reviewer_id=self.user_id,
            proposal_id=payload.proposal_id,
            decision=payload.decision,
            edited_value_json=payload.edited_value,
            rationale=payload.rationale,
        )
        decision = await self._decisions.append(decision)
        await self._states.upsert(
            project_id=payload.project_id,
            reviewer_id=self.user_id,
            target_id=payload.target_id,
            item_id=payload.item_id,
            schema_version_id=payload.schema_version_id,
            latest_decision_id=decision.id,
            latest_decision=decision.decision,
        )
        await self.db.commit()
        log_evaluation_event(
            "evaluation_reviewer_decision_submitted",
            trace_id=self.trace_id,
            run_id=payload.run_id,
            project_id=payload.project_id,
            extra={"decision": payload.decision},
        )
        return decision
