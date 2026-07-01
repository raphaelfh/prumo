"""Service: validate reviewer decisions, write append-only, upsert ReviewerState."""

from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.extraction import ExtractionField, ExtractionRunStage
from app.models.extraction_workflow import (
    ExtractionReviewerDecision,
    ExtractionReviewerDecisionType,
    ExtractionReviewerState,
)
from app.repositories.extraction_proposal_repository import (
    ExtractionProposalRepository,
)
from app.repositories.extraction_reviewer_decision_repository import (
    ExtractionReviewerDecisionRepository,
)
from app.repositories.extraction_reviewer_state_repository import (
    ExtractionReviewerStateRepository,
)
from app.services._extraction_run_lock import load_run_for_update
from app.services.coordinate_coherence import assert_coords_coherent
from app.services.value_semantics import disposition_to_marker, is_disposition_candidate


class InvalidDecisionError(Exception):
    """Raised when a reviewer decision violates business rules."""


class ExtractionReviewService:
    """Append-only reviewer decisions + materialized ReviewerState upsert."""

    def __init__(self, db: AsyncSession):
        self.db = db
        self._decisions = ExtractionReviewerDecisionRepository(db)
        self._states = ExtractionReviewerStateRepository(db)

    async def record_decision(
        self,
        *,
        run_id: UUID,
        instance_id: UUID,
        field_id: UUID,
        reviewer_id: UUID,
        decision: ExtractionReviewerDecisionType | str,
        proposal_record_id: UUID | None = None,
        value: dict[str, Any] | None = None,
        rationale: str | None = None,
    ) -> ExtractionReviewerDecision:
        run = await load_run_for_update(self.db, run_id)
        if run is None:
            raise InvalidDecisionError(f"Run {run_id} not found")
        if run.stage != ExtractionRunStage.EXTRACT.value:
            raise InvalidDecisionError(
                f"Cannot record decision: run stage is {run.stage}, not 'extract'"
            )

        await assert_coords_coherent(
            self.db,
            run_id=run_id,
            instance_id=instance_id,
            field_id=field_id,
        )

        decision_value = (
            decision.value if isinstance(decision, ExtractionReviewerDecisionType) else decision
        )
        if decision_value == "accept_proposal":
            if proposal_record_id is None:
                raise InvalidDecisionError("decision='accept_proposal' requires proposal_record_id")
            # The referenced proposal must target the same (run, instance, field)
            # coordinate; otherwise consensus would publish a foreign field's value.
            proposal = await ExtractionProposalRepository(self.db).get(proposal_record_id)
            if (
                proposal is None
                or proposal.run_id != run_id
                or proposal.instance_id != instance_id
                or proposal.field_id != field_id
            ):
                raise InvalidDecisionError(
                    f"proposal_record_id {proposal_record_id} does not belong to "
                    f"(run={run_id}, instance={instance_id}, field={field_id})"
                )
        if decision_value == "edit" and value is None:
            raise InvalidDecisionError("decision='edit' requires value")

        # ADR-0016: normalize a picked legacy disposition string into the coded
        # marker before it is persisted (the consensus agreement key hashes this
        # value verbatim, so two different codes must stay distinct). An
        # ``accept_proposal`` carries value=None and is left as-is — its proposal
        # was already normalized at record_proposal time. Scoped by the field's
        # live domain so a coincidental value is untouched.
        if is_disposition_candidate(value):
            allowed = (
                await self.db.execute(
                    select(ExtractionField.allowed_values).where(ExtractionField.id == field_id)
                )
            ).scalar_one_or_none()
            value = disposition_to_marker(value, allowed)

        # Idempotent re-record: an unchanged decision replay (form remount,
        # retry) must not append a duplicate row. Compare the decision kind,
        # its value, and the referenced proposal (which carries the meaning
        # for ``accept_proposal``, whose ``value`` is null). A changed
        # decision still appends and re-points the ReviewerState.
        latest = await self._decisions.get_latest_for_coord(
            run_id, reviewer_id, instance_id, field_id
        )
        if (
            latest is not None
            and latest.decision == decision_value
            and latest.value == value
            and latest.proposal_record_id == proposal_record_id
        ):
            return latest

        record = ExtractionReviewerDecision(
            run_id=run_id,
            instance_id=instance_id,
            field_id=field_id,
            reviewer_id=reviewer_id,
            decision=decision_value,
            proposal_record_id=proposal_record_id,
            value=value,
            rationale=rationale,
        )
        await self._decisions.add(record)
        await self._states.upsert(
            run_id=run_id,
            reviewer_id=reviewer_id,
            instance_id=instance_id,
            field_id=field_id,
            current_decision_id=record.id,
        )
        return record

    async def get_reviewer_state(
        self,
        *,
        run_id: UUID,
        reviewer_id: UUID,
        instance_id: UUID,
        field_id: UUID,
    ) -> ExtractionReviewerState | None:
        return await self._states.get(
            run_id=run_id,
            reviewer_id=reviewer_id,
            instance_id=instance_id,
            field_id=field_id,
        )
