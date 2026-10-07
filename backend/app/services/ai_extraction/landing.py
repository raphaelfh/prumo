"""ProposalLanding — the one seam every AI candidate lands through.

Model calls happen outside any run lock (the worker commits before each
one); what they produce is written here, in ONE result transaction per
call:

1. ``open_run_for_write`` locks the run and gates its stage — once;
2. authorization (an attempt's owner is still a project member) and the
   template's assessor-owned exclusions are re-read AFTER the external work,
   so a candidate the template stopped handing to the model is dropped;
3. the section's singleton instance is resolved (created when missing);
4. ``assert_on_coordinate`` binds every candidate field to the instance's
   coordinate — once, for all of them;
5. N proposal rows land with their evidence, and the section's provenance
   snapshot is merged into ``run.results``.

The per-row rules that used to live in ``ExtractionProposalService`` live
here and nowhere else: the ``human`` source refusal (ADR-0019 — humans write
through ``/decisions``), the ADR-0016 disposition normalization, attempt
idempotency (a replayed attempt finds its own rows) and, for a write without
an attempt, value deduplication with an in-place verdict heal.

:meth:`ProposalLanding.open_entry` is the same gate for the one write that
precedes a field call: the instance of a repeating-group entry, written
right after identification so the per-entry call can be scoped to it.
"""

from __future__ import annotations

from collections.abc import Sequence
from copy import deepcopy
from dataclasses import dataclass, field
from typing import Any, assert_never
from uuid import UUID

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.error_handler import AuthorizationError
from app.core.logging import get_logger
from app.models.extraction import (
    ExtractionEvidence,
    ExtractionField,
    ExtractionInstance,
    ExtractionRun,
    ExtractionRunStage,
    ProjectExtractionTemplate,
)
from app.models.extraction_workflow import ExtractionProposalRecord, ExtractionProposalSource
from app.repositories import ExtractionInstanceRepository, ExtractionRunRepository
from app.repositories.extraction_proposal_repository import ExtractionProposalRepository
from app.schemas.llm_target import LlmTarget
from app.services.entity_key import resolve_instance
from app.services.extraction_run_write import assert_on_coordinate, open_run_for_write
from app.services.llm_field_filter import LlmFieldFilter, build_llm_field_filter
from app.services.run_engine_freeze import build_proposal_engine
from app.services.value_semantics import (
    disposition_to_marker,
    is_disposition_candidate,
    strip_verification,
)

logger = get_logger(__name__)


class InvalidProposalError(Exception):
    """A proposal violates a business rule (its source). Stage and coordinate
    refusals are ``RunWriteError`` from the run-write oracle."""


#: Server-built generation facts allowed into proposal history; nothing
#: identity-bearing (``ran_by_user_id``) survives the sanitize.
_SNAPSHOT_KEYS = frozenset(
    {
        "provider",
        "model",
        "connection_id",
        "deviation",
        "key_scope",
        "strategy",
        "prompt_version",
        "mode_requested",
        "mode_executed",
        "passes",
        "params",
        "tokens",
        "prompt_composition",
    }
)
_NESTED_SNAPSHOT_KEYS = {
    "params": {"temperature", "output_retries", "timeout_seconds"},
    "tokens": {"prompt", "completion", "total"},
    "prompt_composition": {
        "section_name",
        "system_prompt",
        "section_instruction",
        "article_ref",
        "fields_requested",
        "llm_calls",
    },
}
_ARTICLE_REF_KEYS = {"file_id", "file_name", "truncated", "est_tokens"}

#: The execution facts a verdict heal must carry with it; engine identity
#: (provider/model/connection_id/key_scope/mode_requested) is never rewritten.
_EXECUTION_KEYS = ("mode_executed", "passes")


def _sanitize(snapshot: dict[str, Any] | None) -> dict[str, Any] | None:
    """Only server-built generation facts may enter proposal history."""
    if snapshot is None:
        return None
    clean = {key: value for key, value in snapshot.items() if key in _SNAPSHOT_KEYS}
    for key, allowed in _NESTED_SNAPSHOT_KEYS.items():
        if isinstance(clean.get(key), dict):
            clean[key] = {k: v for k, v in clean[key].items() if k in allowed}
    composition = clean.get("prompt_composition")
    if isinstance(composition, dict) and isinstance(composition.get("article_ref"), dict):
        composition["article_ref"] = {
            k: v for k, v in composition["article_ref"].items() if k in _ARTICLE_REF_KEYS
        }
    return deepcopy(clean)


@dataclass
class ProposalCandidate:
    """One field's value as the model proposed it, ready to land."""

    field_id: UUID
    field_name: str
    proposed_value: dict[str, Any]
    confidence_score: float | None = None
    rationale: str | None = None
    evidence: list[ExtractionEvidence] = field(default_factory=list)


@dataclass(frozen=True)
class SingletonSlot:
    """The one instance a non-repeating section has under ``parent_instance_id``
    — resolved, and created when missing, inside the landing transaction."""

    parent_instance_id: UUID | None


@dataclass(frozen=True)
class Generation:
    """How a batch of candidates was produced: the engine that ran, the
    section snapshot of the call (sanitized here), and the durable attempt
    that owns it (``None`` for a job queued before attempts existed)."""

    engine: LlmTarget
    snapshot: dict[str, Any] | None
    attempt_id: UUID | None

    def __post_init__(self) -> None:
        object.__setattr__(self, "snapshot", _sanitize(self.snapshot))


@dataclass(frozen=True)
class EntrySlot:
    """An entry's instance and the fields still asked of it."""

    instance: ExtractionInstance
    created: bool
    fields: list[Any]


class ProposalLanding:
    """Lands AI candidates on a run: one lock, one stage gate, one coordinate bind."""

    def __init__(
        self,
        db: AsyncSession,
        *,
        user_id: str,
        trace_id: str | None = None,
        owns_transactions: bool = False,
    ) -> None:
        self._db = db
        self._user_id = user_id
        self._trace_id = trace_id
        self._owns_transactions = owns_transactions
        self._proposals = ExtractionProposalRepository(db)
        self._instances = ExtractionInstanceRepository(db)

    async def land(
        self,
        run: ExtractionRun,
        section: Any,
        instance: ExtractionInstance | SingletonSlot,
        candidates: Sequence[ProposalCandidate],
        generation: Generation,
        *,
        source: ExtractionProposalSource = ExtractionProposalSource.AI,
    ) -> int:
        """Write ``candidates`` for ``section`` on ``instance``; the count written.

        ``section`` is the entity type the candidates belong to (its ``id``
        keys the provenance merge, its ``name`` the exclusion coordinates).
        A savepoint keeps rows and evidence atomic even when the caller
        catches an error; a worker-owned session commits the result here,
        releasing the run lock before the next model call.
        """
        count = 0
        async with self._db.begin_nested():
            locked, field_filter = await self._gate(run.id, generation.attempt_id)
            kept = [
                c
                for c in candidates
                if (section.name, c.field_name) not in field_filter.excluded_coordinates
            ]
            if not kept:
                return 0
            if isinstance(instance, SingletonSlot):
                instance = await self._singleton(locked, section, instance.parent_instance_id)
            await assert_on_coordinate(
                self._db,
                run_id=locked.id,
                instance_id=instance.id,
                field_ids=[c.field_id for c in kept],
            )
            _refuse_human(source)
            provenance = build_proposal_engine(generation.snapshot, generation.engine)
            for candidate in kept:
                record, counted = await self._write(
                    locked.id, instance.id, candidate, source, provenance, generation
                )
                if counted:
                    for evidence in candidate.evidence:
                        evidence.proposal_record_id = record.id
                        self._db.add(evidence)
                    count += 1
            await self._db.flush()
            if count and generation.snapshot is not None:
                await ExtractionRunRepository(self._db).merge_provenance_section(
                    locked.id, section.id, {**generation.snapshot, "ran_by_user_id": self._user_id}
                )
        if self._owns_transactions:
            await self._db.commit()
        return count

    async def open_entry(
        self,
        run: ExtractionRun,
        section: Any,
        *,
        parent_instance_id: UUID | None,
        key_value: str,
        sort_order: int,
        fields: list[Any],
        attempt_id: UUID | None,
    ) -> EntrySlot | None:
        """The instance of one identified entry, under the same gate as a landing.

        ``None`` when the template excludes every field still asked of the
        entry — nothing is written then. The worker commits this transaction
        before the entry's field call (``before_external_work``).
        """
        async with self._db.begin_nested():
            locked, field_filter = await self._gate(run.id, attempt_id)
            kept = [
                f for f in fields if (section.name, f.name) not in field_filter.excluded_coordinates
            ]
            if not kept:
                return None
            instance, created = await resolve_instance(
                self._db,
                project_id=locked.project_id,
                article_id=locked.article_id,
                template_id=locked.template_id,
                entity_type_id=section.id,
                parent_instance_id=parent_instance_id,
                key_value=key_value,
                sort_order=sort_order,
                created_by=UUID(self._user_id),
                metadata={"ai_extracted": True, "ai_run_id": str(locked.id)},
            )
        return EntrySlot(instance, created, kept)

    async def _gate(
        self, run_id: UUID, attempt_id: UUID | None
    ) -> tuple[ExtractionRun, LlmFieldFilter]:
        """Lock + stage gate, then the post-external-work authorization and
        exclusion re-read."""
        run = await open_run_for_write(self._db, run_id, expect=ExtractionRunStage.EXTRACT.only())
        if attempt_id is not None:
            member = await self._db.scalar(
                text("SELECT public.is_project_member(:pid, :uid)"),
                {"pid": str(run.project_id), "uid": self._user_id},
            )
            if not member:
                raise AuthorizationError("Project membership is required for extraction")
        template = await self._db.get(ProjectExtractionTemplate, run.template_id)
        if template is not None:
            await self._db.refresh(template)
        return run, await build_llm_field_filter(self._db, run)

    async def _singleton(
        self, run: ExtractionRun, section: Any, parent_instance_id: UUID | None
    ) -> ExtractionInstance:
        """The one instance a non-repeating section has at its coordinate,
        auto-created when missing. Repeating groups never reach this — they
        resolve one instance per entry (:meth:`open_entry`)."""
        instances = await self._instances.get_by_article(run.article_id, section.id)
        if parent_instance_id:
            instances = [i for i in instances if i.parent_instance_id == parent_instance_id]
        if instances:
            return instances[0]
        # Re-verified here too: last line before a foreign FK.
        if parent_instance_id and not await self._instances.get_on_run(parent_instance_id, run):
            raise ValueError(f"Parent instance not found: {parent_instance_id}")
        instance = await self._instances.create(
            ExtractionInstance(
                project_id=run.project_id,
                article_id=run.article_id,
                template_id=run.template_id,
                entity_type_id=section.id,
                parent_instance_id=parent_instance_id,
                label=getattr(section, "label", None) or section.name,
                sort_order=getattr(section, "sort_order", None) or 0,
                metadata_={"ai_created": True, "ai_run_id": str(run.id)},
                created_by=UUID(self._user_id),
            )
        )
        logger.info(
            "instance_auto_created",
            trace_id=self._trace_id,
            instance_id=str(instance.id),
            entity_type_id=str(section.id),
        )
        return instance

    async def _write(
        self,
        run_id: UUID,
        instance_id: UUID,
        candidate: ProposalCandidate,
        source: ExtractionProposalSource,
        provenance: dict[str, Any] | None,
        generation: Generation,
    ) -> tuple[ExtractionProposalRecord, bool]:
        """One append-only proposal row; ``(row, counted)``.

        An attempt's replay finds its own row (not counted, evidence not
        re-attached). Without an attempt, an unchanged value re-uses the
        latest row — the audit trail records value CHANGES — and still counts,
        the contract jobs queued before attempts were written against.
        """
        proposed_value = await self._normalized(candidate)
        if generation.attempt_id is not None:
            existing = await self._proposals.get_for_attempt(
                generation.attempt_id, instance_id, candidate.field_id, source.value
            )
            if existing is not None:
                return existing, False
            record = await self._proposals.add(
                ExtractionProposalRecord(
                    run_id=run_id,
                    instance_id=instance_id,
                    field_id=candidate.field_id,
                    source=source.value,
                    proposed_value=proposed_value,
                    confidence_score=candidate.confidence_score,
                    rationale=candidate.rationale,
                    provenance=provenance,
                    extraction_attempt_id=generation.attempt_id,
                    generation_snapshot=generation.snapshot,
                )
            )
            return record, True
        latest = await self._proposals.get_latest_for_coord(
            run_id, instance_id, candidate.field_id, source.value, None
        )
        if latest is not None and strip_verification(latest.proposed_value) == strip_verification(
            proposed_value
        ):
            await self._heal_verdict(latest, proposed_value, provenance)
            return latest, True
        record = await self._proposals.add(
            ExtractionProposalRecord(
                run_id=run_id,
                instance_id=instance_id,
                field_id=candidate.field_id,
                source=source.value,
                proposed_value=proposed_value,
                confidence_score=candidate.confidence_score,
                rationale=candidate.rationale,
                provenance=provenance,
            )
        )
        return record, True

    async def _normalized(self, candidate: ProposalCandidate) -> dict[str, Any]:
        """ADR-0016: a legacy in-band disposition string — a picked dropdown
        option or an AI ``found``-disposition on a run whose frozen domain still
        carries it — becomes the coded ``absent_reason`` marker. Scoped by the
        field's live domain so a coincidental value is untouched; the candidacy
        pre-check skips the lookup for real values and markers."""
        proposed_value = candidate.proposed_value
        if not is_disposition_candidate(proposed_value):
            return proposed_value
        domain = (
            await self._db.execute(
                select(ExtractionField.allowed_values, ExtractionField.allows_no_information).where(
                    ExtractionField.id == candidate.field_id
                )
            )
        ).one_or_none()
        if domain is None:
            return proposed_value
        normalized: dict[str, Any] = disposition_to_marker(
            proposed_value,
            domain.allowed_values,
            allows_no_information=domain.allows_no_information,
        )
        return normalized

    async def _heal_verdict(
        self,
        latest: ExtractionProposalRecord,
        proposed_value: dict[str, Any],
        provenance: dict[str, Any] | None,
    ) -> None:
        """Same value, but the verify verdict moved (a flip, or a heal after a
        flaked pass): refresh the server-owned ANNOTATION in place — no new
        audit row, the value did not change. An incoming value WITHOUT the
        sibling (fast re-run / flaked verify) never clears a stored verdict.

        The verdict and the execution record describe the SAME pass, so they
        move together. Engine IDENTITY is deliberately not refreshed: the model
        recorded here did produce this value, and a corroborating re-run under
        a different engine is a separate fact (append-only, constitution §IX).
        """
        incoming = proposed_value.get("verification")
        if incoming is None or incoming == latest.proposed_value.get("verification"):
            return
        latest.proposed_value = {**latest.proposed_value, "verification": incoming}
        if provenance:
            latest.provenance = {
                **(latest.provenance or {}),
                **{k: provenance[k] for k in _EXECUTION_KEYS if k in provenance},
            }
        await self._db.flush()


def _refuse_human(source: ExtractionProposalSource) -> None:
    """ADR-0019: ``human`` is a domain-legal source refused for policy reasons.

    A reviewer's extraction value must land as a per-user ``ReviewerDecision``
    (``/decisions``) or the blind-review contract breaks (``loadValuesForUser``
    filters by ``reviewer_id``; a shared human proposal is visible to peers);
    the QA form writes ``/decisions`` too since D8. No production caller passes
    ``human`` — the refusal is exhaustiveness over the source domain, so a
    future one is refused loudly.
    """
    match source:
        case ExtractionProposalSource.HUMAN:
            raise InvalidProposalError(
                "Human writes must go through /decisions (ReviewerDecision), not as a proposal."
            )
        case ExtractionProposalSource.AI | ExtractionProposalSource.SYSTEM:
            return
        case _:  # pragma: no cover - mypy proves this unreachable
            assert_never(source)
