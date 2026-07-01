"""Service: validate + record proposals append-only."""

from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.extraction import ExtractionField, ExtractionRunStage
from app.models.extraction_workflow import (
    ExtractionProposalRecord,
    ExtractionProposalSource,
)
from app.repositories.extraction_proposal_repository import (
    ExtractionProposalRepository,
)
from app.services._extraction_run_lock import load_run_for_update
from app.services.coordinate_coherence import assert_coords_coherent
from app.services.value_semantics import disposition_to_marker, is_disposition_candidate


class InvalidProposalError(Exception):
    """Raised when a proposal violates business rules (stage / source / coords)."""


class ExtractionProposalService:
    """Append-only proposal writes with rule validation."""

    def __init__(self, db: AsyncSession):
        self.db = db
        self._repo = ExtractionProposalRepository(db)

    async def record_proposal(
        self,
        *,
        run_id: UUID,
        instance_id: UUID,
        field_id: UUID,
        source: ExtractionProposalSource | str,
        proposed_value: dict[str, Any],
        source_user_id: UUID | None = None,
        confidence_score: float | None = None,
        rationale: str | None = None,
    ) -> ExtractionProposalRecord:
        run = await load_run_for_update(self.db, run_id)
        if run is None:
            raise InvalidProposalError(f"Run {run_id} not found")

        source_value = source.value if isinstance(source, ExtractionProposalSource) else source
        # Stage gate is source-specific AND kind-aware in the collapsed
        # ``extract`` lifecycle (pending -> extract -> consensus -> finalized):
        #
        # * ``ai`` / ``system`` proposals are produced during ``extract`` —
        #   the AI phase and any system seeding both live in that single
        #   stage now that ``proposal``/``review`` are unified.
        # * ``human`` proposals are kind-gated (Layer 1b of the
        #   multi-reviewer blind fix):
        #     - kind='extraction': REJECTED outright. A reviewer's
        #       extraction values must land as per-user ``ReviewerDecision``
        #       rows so the blind-review contract holds (``loadValuesForUser``
        #       filters by reviewer_id). A shared ``human`` proposal here
        #       opens the leak Layer 1 patched on the read side; this gate
        #       closes it on the write side so a frontend bypass (curl,
        #       agent client) cannot resurrect the bug — humans write via
        #       /decisions.
        #     - kind='quality_assessment': allowed in ``extract``. QA has no
        #       per-reviewer blind contract, so its human writes stay on the
        #       shared proposal track.
        if source_value in ("ai", "system"):
            allowed_stages = {ExtractionRunStage.EXTRACT.value}
        elif run.kind == "extraction":
            raise InvalidProposalError(
                "For kind='extraction', human writes must go through "
                "/decisions (ReviewerDecision), not /proposals."
            )
        else:
            allowed_stages = {ExtractionRunStage.EXTRACT.value}
        if run.stage not in allowed_stages:
            raise InvalidProposalError(
                f"Cannot record proposal: kind={run.kind} run stage is "
                f"{run.stage}, not in {sorted(allowed_stages)}."
            )

        await assert_coords_coherent(
            self.db,
            run_id=run_id,
            instance_id=instance_id,
            field_id=field_id,
        )

        if source_value == "human" and source_user_id is None:
            raise InvalidProposalError("source='human' requires source_user_id")

        # ADR-0016: normalize a legacy in-band disposition string — a picked
        # dropdown option or an AI ``found``-disposition on an existing run whose
        # frozen domain still carries it — into the coded ``absent_reason`` marker.
        # Scoped by the field's live domain so a coincidental value is untouched;
        # the candidacy pre-check skips the lookup for real values / markers.
        if is_disposition_candidate(proposed_value):
            allowed = (
                await self.db.execute(
                    select(ExtractionField.allowed_values).where(ExtractionField.id == field_id)
                )
            ).scalar_one_or_none()
            proposed_value = disposition_to_marker(proposed_value, allowed)

        # Idempotent re-record: a client replaying an unchanged value (form
        # remount, debounce double-fire, retry) must not append a duplicate
        # row. The audit trail captures value *changes*, not redundant
        # replays. A genuinely changed value still appends.
        latest = await self._repo.get_latest_for_coord(
            run_id, instance_id, field_id, source_value, source_user_id
        )
        if latest is not None and latest.proposed_value == proposed_value:
            return latest

        record = ExtractionProposalRecord(
            run_id=run_id,
            instance_id=instance_id,
            field_id=field_id,
            source=source_value,
            source_user_id=source_user_id,
            proposed_value=proposed_value,
            confidence_score=confidence_score,
            rationale=rationale,
        )
        return await self._repo.add(record)

    async def list_by_item(
        self,
        run_id: UUID,
        instance_id: UUID,
        field_id: UUID,
    ) -> list[ExtractionProposalRecord]:
        return await self._repo.list_by_item(run_id, instance_id, field_id)

    async def list_by_run(self, run_id: UUID) -> list[ExtractionProposalRecord]:
        return await self._repo.list_by_run(run_id)
