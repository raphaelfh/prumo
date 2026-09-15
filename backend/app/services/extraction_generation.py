"""Immutable, identity-free facts belonging to one model call."""

from __future__ import annotations

from copy import deepcopy
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.llm.verify import VerifyVerdict
from app.models.extraction import ExtractionEvidence, ExtractionRun
from app.services.llm_field_filter import LlmFieldFilter

if TYPE_CHECKING:
    from app.services.extraction_proposal_service import (
        ExtractionProposalService,
        ProposalWriteResult,
    )

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


def sanitize_generation_snapshot(snapshot: dict[str, Any] | None) -> dict[str, Any] | None:
    """Only server-built generation facts may enter proposal history."""
    if snapshot is None:
        return None
    clean = {key: value for key, value in snapshot.items() if key in _SNAPSHOT_KEYS}
    nested_keys = {
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
    for key, allowed in nested_keys.items():
        if isinstance(clean.get(key), dict):
            clean[key] = {k: v for k, v in clean[key].items() if k in allowed}
    composition = clean.get("prompt_composition")
    if isinstance(composition, dict) and isinstance(composition.get("article_ref"), dict):
        composition["article_ref"] = {
            key: value
            for key, value in composition["article_ref"].items()
            if key in {"file_id", "file_name", "truncated", "est_tokens"}
        }
    return deepcopy(clean)


@dataclass(frozen=True)
class GenerationCallResult:
    extracted_data: dict[str, Any]
    verdicts: dict[str, VerifyVerdict] | None
    generation_snapshot: dict[str, Any] | None

    def __post_init__(self) -> None:
        object.__setattr__(self, "extracted_data", deepcopy(self.extracted_data))
        object.__setattr__(self, "verdicts", deepcopy(self.verdicts))
        object.__setattr__(
            self, "generation_snapshot", sanitize_generation_snapshot(self.generation_snapshot)
        )


@dataclass
class ProposalCandidate:
    field_id: UUID
    proposed_value: dict[str, Any]
    confidence_score: float | None
    rationale: str | None
    evidence: list[ExtractionEvidence]


async def current_result_filter(
    db: AsyncSession, run: ExtractionRun, user_id: str, attempt_id: UUID | None
) -> LlmFieldFilter:
    """Re-read authorization and template exclusions after external work."""
    from sqlalchemy import text

    from app.core.error_handler import AuthorizationError
    from app.models.extraction import ProjectExtractionTemplate
    from app.services.llm_field_filter import build_llm_field_filter

    if attempt_id is not None:
        member = await db.scalar(
            text("SELECT public.is_project_member(:pid, :uid)"),
            {
                "pid": str(run.project_id),
                "uid": user_id,
            },
        )
        if not member:
            raise AuthorizationError("Project membership is required for extraction")
    template = await db.get(ProjectExtractionTemplate, run.template_id)
    if template is not None:
        await db.refresh(template)
    return await build_llm_field_filter(db, run)


async def write_candidate(
    proposals: ExtractionProposalService,
    candidate: ProposalCandidate,
    *,
    run_id: UUID,
    instance_id: UUID,
    attempt_id: UUID | None,
    snapshot: dict[str, Any] | None,
    provenance: dict[str, Any] | None,
) -> ProposalWriteResult:
    """Attempt writes count inserted rows; legacy calls preserve their old contract."""
    from app.models.extraction_workflow import ExtractionProposalSource
    from app.services.extraction_proposal_service import ProposalWriteResult

    if attempt_id is None:
        record = await proposals.record_proposal(
            run_id=run_id,
            instance_id=instance_id,
            field_id=candidate.field_id,
            source=ExtractionProposalSource.AI,
            proposed_value=candidate.proposed_value,
            confidence_score=candidate.confidence_score,
            rationale=candidate.rationale,
            provenance=provenance,
        )
        # Legacy service callers historically count the returned proposal and
        # append evidence; only durable attempts provide replay-safe evidence.
        return ProposalWriteResult(record, True)
    return await proposals.record_proposal_result(
        run_id=run_id,
        instance_id=instance_id,
        field_id=candidate.field_id,
        source=ExtractionProposalSource.AI,
        proposed_value=candidate.proposed_value,
        confidence_score=candidate.confidence_score,
        rationale=candidate.rationale,
        provenance=provenance,
        extraction_attempt_id=attempt_id,
        generation_snapshot=snapshot,
    )


async def locked_result_filter(
    db: AsyncSession, run_id: UUID, user_id: str, attempt_id: UUID | None
) -> LlmFieldFilter:
    """Guard every post-model write; caller holds this lock only through its result transaction."""
    from app.services._extraction_run_lock import load_run_for_update
    from app.services.extraction_proposal_service import InvalidProposalError

    run = await load_run_for_update(db, run_id)
    if run is None:
        raise InvalidProposalError(f"Run {run_id} not found")
    await db.refresh(run)
    if run.stage != "extract":
        raise InvalidProposalError("AI extraction requires the extract stage")
    return await current_result_filter(db, run, user_id, attempt_id)
