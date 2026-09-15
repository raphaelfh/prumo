"""Allowlisted historical proposal facts; identity requires per-run reveal first."""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Any
from uuid import UUID

from sqlalchemy import select, tuple_
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.extraction import ExtractionRun
from app.models.extraction_attempt import ExtractionAttempt
from app.models.extraction_workflow import ExtractionProposalRecord
from app.models.user import Profile

_ENGINE_FIELDS = {
    "provider": str,
    "model": str,
    "connection_id": str,
    "deviation": bool,
    "key_scope": str,
    "mode_requested": str,
    "mode_executed": str,
    "passes": int,
}


def _scalars(raw: object, fields: Mapping[str, type | tuple[type, ...]]) -> dict[str, Any]:
    if not isinstance(raw, dict):
        return {}
    # Exact types prevent JSON containers (or bool-as-int) under scalar keys.
    out = {}
    for key, value in raw.items():
        expected = fields.get(key)
        if expected is None:
            continue
        allowed = expected if isinstance(expected, tuple) else (expected,)
        if value is None or type(value) in allowed:
            out[key] = value
    return out


def _snapshot(raw: object) -> dict[str, Any] | None:
    if not isinstance(raw, dict) or not raw:
        return None
    result = _scalars(
        raw, {**_ENGINE_FIELDS, "strategy": str, "prompt_version": str, "prompt_text": str}
    )
    containers: dict[str, dict[str, type | tuple[type, ...]]] = {
        "params": {
            "temperature": (int, float),
            "output_retries": int,
            "timeout_seconds": (int, float),
        },
        "tokens": {"prompt": int, "completion": int, "total": int},
    }
    for key, fields in containers.items():
        if isinstance(raw.get(key), dict):
            result[key] = _scalars(raw[key], fields)
    pc = raw.get("prompt_composition")
    if isinstance(pc, dict):
        composition = _scalars(
            pc,
            {
                "section_name": str,
                "system_prompt": str,
                "section_instruction": str,
                "llm_calls": int,
            },
        )
        fields_requested = pc.get("fields_requested")
        if isinstance(fields_requested, list):
            composition["fields_requested"] = [
                field for field in fields_requested if isinstance(field, str)
            ]
        ref = pc.get("article_ref")
        if isinstance(ref, dict):
            article = _scalars(ref, {"file_name": str, "truncated": bool, "est_tokens": int})
            # A mutable file id proves no retained revision. Never hand it to
            # historical-input consumers as the original document.
            article.update(file_id=None, historical_input_available=False)
            if isinstance(ref.get("file_id"), str):
                article["current_file_id"] = ref["file_id"]
            composition["article_ref"] = article
        result["prompt_composition"] = composition
    return result or None


@dataclass(frozen=True)
class ProposalRevealContext:
    """Already-authorized identities, keyed by BOTH attempt and its run."""

    owners: dict[tuple[UUID, UUID], tuple[UUID, str | None]]


def serialize_proposal_generation(
    proposal: ExtractionProposalRecord,
    context: ProposalRevealContext,
) -> dict[str, Any]:
    snapshot = _snapshot(proposal.generation_snapshot)
    owner = (
        context.owners.get((proposal.run_id, proposal.extraction_attempt_id))
        if proposal.extraction_attempt_id is not None
        else None
    )
    if snapshot is not None and owner is not None:
        snapshot["ran_by_user_id"] = str(owner[0])
        if owner[1]:
            snapshot["ran_by_name"] = owner[1]
    return {
        "extraction_attempt_id": proposal.extraction_attempt_id,
        "generation_snapshot": snapshot,
        "provenance": _scalars(proposal.provenance, _ENGINE_FIELDS) or None,
    }


async def proposal_reveal_context(
    db: AsyncSession,
    proposals: Sequence[ExtractionProposalRecord],
    *,
    revealed_run_ids: set[UUID],
) -> ProposalRevealContext:
    """Lookup attempt owners/names only for proposals whose run already reveals peers."""
    coordinates = {
        (p.run_id, p.extraction_attempt_id)
        for p in proposals
        if p.run_id in revealed_run_ids
        and p.extraction_attempt_id is not None
        and p.generation_snapshot is not None
    }
    if not coordinates:
        return ProposalRevealContext({})
    rows = (
        await db.execute(
            select(
                ExtractionAttempt.run_id,
                ExtractionAttempt.id,
                ExtractionAttempt.owner_id,
                Profile.full_name,
            )
            .outerjoin(Profile, Profile.id == ExtractionAttempt.owner_id)
            .where(tuple_(ExtractionAttempt.run_id, ExtractionAttempt.id).in_(coordinates))
        )
    ).all()
    return ProposalRevealContext(
        {(run_id, attempt_id): (owner_id, name) for run_id, attempt_id, owner_id, name in rows}
    )


async def suggestion_reveal_context(
    db: AsyncSession,
    proposals: Sequence[ExtractionProposalRecord],
    *,
    caller_id: UUID,
) -> ProposalRevealContext:
    """Resolve the existing reveal rule separately for each proposal's run."""
    from app.services.extraction_run_read_service import (
        caller_can_see_peers,
        is_run_arbitrator,
        run_reveals_peers,
    )

    run_ids = {
        p.run_id
        for p in proposals
        if p.extraction_attempt_id is not None and p.generation_snapshot is not None
    }
    if not run_ids:
        return ProposalRevealContext({})
    rows = (
        await db.execute(
            select(
                ExtractionRun.id, ExtractionRun.stage, ExtractionRun.project_id, ExtractionRun.kind
            ).where(ExtractionRun.id.in_(run_ids))
        )
    ).all()
    revealed = set()
    for row in rows:
        can_see = await caller_can_see_peers(
            db, project_id=row.project_id, user_id=caller_id, kind=row.kind
        )
        arbitrator = (
            await is_run_arbitrator(db, row.project_id, caller_id)
            if row.stage == "consensus" and not can_see
            else False
        )
        if run_reveals_peers(row.stage, can_see_peers=can_see, is_arbitrator=arbitrator):
            revealed.add(row.id)
    return await proposal_reveal_context(db, proposals, revealed_run_ids=revealed)
