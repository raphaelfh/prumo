"""Per-proposal facts projected onto one ``AI proposals`` export row."""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import pytest

from app.models.extraction_workflow import ExtractionProposalRecord
from app.services.exports.ai_proposal_projection import (
    EngineFacts,
    load_evidence_summaries,
    proposal_engine,
)


def _proposal(*, snapshot: object = None, provenance: object = None) -> ExtractionProposalRecord:
    return ExtractionProposalRecord(
        run_id=uuid4(),
        extraction_attempt_id=uuid4() if snapshot is not None else None,
        generation_snapshot=snapshot,
        provenance=provenance,
    )


def test_engine_comes_from_the_calls_own_snapshot_before_row_provenance() -> None:
    proposal = _proposal(
        snapshot={"provider": "openai", "model": "call-model", "prompt_version": "v3"},
        provenance={"provider": "anthropic", "model": "row-model"},
    )
    assert proposal_engine(proposal, had_snapshot=True) == EngineFacts("openai", "call-model", "v3")


def test_pre_0075_proposal_names_its_model() -> None:
    proposal = _proposal(provenance={"provider": "openai", "model": "gpt-4o"})
    assert proposal_engine(proposal, had_snapshot=False) == EngineFacts("openai", "gpt-4o", "")


def test_engine_facts_ignore_prompt_payload_and_never_borrow_provenance() -> None:
    """A snapshot the loader stripped to ``{}`` still had a snapshot: no borrowing."""
    stripped = _proposal(snapshot={"strategy": "x"}, provenance={"model": "row"})
    assert proposal_engine(stripped, had_snapshot=True).model == ""
    emptied = _proposal(snapshot={}, provenance={"model": "row"})
    assert proposal_engine(emptied, had_snapshot=True).model == ""


def test_non_scalar_engine_facts_and_absent_facts_are_blank() -> None:
    forged = _proposal(snapshot={"model": {"forged": "x"}, "prompt_version": 3})
    assert proposal_engine(forged, had_snapshot=True) == EngineFacts("", "", "")
    assert proposal_engine(_proposal(), had_snapshot=False) == EngineFacts("", "", "")


@pytest.mark.asyncio
async def test_evidence_is_deduped_page_sorted_and_joined_per_proposal() -> None:
    first, second, silent = uuid4(), uuid4(), uuid4()
    result = MagicMock()
    result.all.return_value = [
        (first, "second finding", 10),
        (first, "first finding", 2),
        (first, "first finding", 2),
        (first, None, None),
        (first, "middle finding", 9),
        (second, "", 3),
    ]
    db = AsyncMock()
    db.execute = AsyncMock(return_value=result)

    summaries = await load_evidence_summaries(db, [first, second, silent])

    db.execute.assert_awaited_once()
    assert summaries[first] == (
        "first finding | middle finding | second finding",
        "2, 9, 10",
    )
    assert summaries[second] == ("", "3")
    assert silent not in summaries
