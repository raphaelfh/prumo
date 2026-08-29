"""Service: validate + record proposals append-only."""

from typing import Any, assert_never
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
from app.services.value_semantics import (
    disposition_to_marker,
    is_disposition_candidate,
    strip_verification,
)


class InvalidProposalError(Exception):
    """Raised when a proposal violates business rules (stage / source / coords)."""


#: The execution facts a verdict heal must carry with it; engine identity
#: (provider/model/endpoint_id/key_scope/mode_requested) is never rewritten.
_EXECUTION_KEYS = ("mode_executed", "passes")


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
        source: ExtractionProposalSource,
        proposed_value: dict[str, Any],
        source_user_id: UUID | None = None,
        confidence_score: float | None = None,
        rationale: str | None = None,
        provenance: dict[str, Any] | None = None,
    ) -> ExtractionProposalRecord:
        run = await load_run_for_update(self.db, run_id)
        if run is None:
            raise InvalidProposalError(f"Run {run_id} not found")

        source_value = source.value
        # ``human`` proposals are REJECTED outright for BOTH kinds — humans
        # write via /decisions. HUMAN is a domain-legal enum value refused for
        # policy reasons, which is why this is a runtime check and not a type:
        #   - kind='extraction' (Layer 1b of the multi-reviewer blind fix): a
        #     reviewer's values must land as per-user ``ReviewerDecision``
        #     rows so the blind-review contract holds (``loadValuesForUser``
        #     filters by reviewer_id). A shared ``human`` proposal here opens
        #     the leak Layer 1 patched on the read side; this gate closes it
        #     on the write side.
        #   - kind='quality_assessment': the QA form writes /decisions since
        #     D8 unified the write path. Without this gate a caller could
        #     still leave bare human proposals that ``materialize_qa_decisions``
        #     would have to reconcile at every extract->consensus advance,
        #     forever; rejecting them bounds that materializer to pre-D8 rows
        #     already stored.
        match source:
            case ExtractionProposalSource.HUMAN:
                raise InvalidProposalError(
                    "Human writes must go through /decisions (ReviewerDecision), not as a proposal."
                )
            case ExtractionProposalSource.AI | ExtractionProposalSource.SYSTEM:
                pass
            case _:  # pragma: no cover - mypy proves this unreachable
                assert_never(source)
        # Stage gate: in the collapsed lifecycle (pending -> extract ->
        # consensus -> finalized) the AI phase and any system seeding both
        # live in ``extract``, now that ``proposal``/``review`` are unified.
        if run.stage != ExtractionRunStage.EXTRACT.value:
            raise InvalidProposalError(
                f"Cannot record proposal: kind={run.kind} run stage is "
                f"{run.stage}, not {ExtractionRunStage.EXTRACT.value}."
            )

        await assert_coords_coherent(
            self.db,
            run_id=run_id,
            instance_id=instance_id,
            field_id=field_id,
        )

        # ADR-0016: normalize a legacy in-band disposition string — a picked
        # dropdown option or an AI ``found``-disposition on an existing run whose
        # frozen domain still carries it — into the coded ``absent_reason`` marker.
        # Scoped by the field's live domain so a coincidental value is untouched;
        # the candidacy pre-check skips the lookup for real values / markers.
        if is_disposition_candidate(proposed_value):
            domain = (
                await self.db.execute(
                    select(
                        ExtractionField.allowed_values,
                        ExtractionField.allows_no_information,
                    ).where(ExtractionField.id == field_id)
                )
            ).one_or_none()
            if domain is not None:
                proposed_value = disposition_to_marker(
                    proposed_value,
                    domain.allowed_values,
                    allows_no_information=domain.allows_no_information,
                )

        # Idempotent re-record: a client replaying an unchanged value (form
        # remount, debounce double-fire, retry) must not append a duplicate
        # row. The audit trail captures value *changes*, not redundant
        # replays. A genuinely changed value still appends. The compare
        # ignores the Verified-mode ``verification`` ANNOTATION sibling
        # (value + absent_reason only): a re-extract whose verify pass
        # flaked — or newly succeeded — is still the same value.
        latest = await self._repo.get_latest_for_coord(
            run_id, instance_id, field_id, source_value, source_user_id
        )
        if latest is not None and strip_verification(latest.proposed_value) == strip_verification(
            proposed_value
        ):
            # Same value, but the verify verdict moved (flip, or a heal after
            # a flaked pass): refresh the server-owned ANNOTATION in place —
            # no new audit row, the value did not change. An incoming bag
            # WITHOUT the sibling (fast re-run / flaked verify) never clears
            # a stored verdict.
            incoming_verdict = proposed_value.get("verification")
            if incoming_verdict is not None and incoming_verdict != latest.proposed_value.get(
                "verification"
            ):
                latest.proposed_value = {
                    **latest.proposed_value,
                    "verification": incoming_verdict,
                }
                # The verdict and the execution record describe the SAME pass, so
                # they move together. Leaving the execution half frozen would let
                # a row heal to "confirmed" while still reporting fast/1 — a row
                # contradicting its own annotation, and less truthful than the
                # pre-0056 fallback, which read the section snapshot and agreed
                # with the chip.
                if provenance:
                    latest.provenance = {
                        **(latest.provenance or {}),
                        **{k: provenance[k] for k in _EXECUTION_KEYS if k in provenance},
                    }
                await self.db.flush()
            # Engine IDENTITY is deliberately NOT refreshed. The model recorded
            # here did produce this value, so the record stays true; a
            # corroborating re-run under a DIFFERENT engine is a separate fact,
            # and recording it belongs in a new row with a link, never in a
            # mutated one (append-only audit trail, constitution §IX).
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
            provenance=provenance,
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
