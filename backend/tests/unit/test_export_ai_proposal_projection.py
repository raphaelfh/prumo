"""Per-proposal facts projected onto one ``AI metadata`` export row."""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import pytest

from app.models.extraction_workflow import ExtractionProposalRecord
from app.services.exports.ai_proposal_projection import (
    load_evidence_summaries,
    proposal_model_used,
)


def _proposal(*, snapshot: object = None, provenance: object = None) -> ExtractionProposalRecord:
    return ExtractionProposalRecord(
        run_id=uuid4(),
        extraction_attempt_id=uuid4() if snapshot is not None else None,
        generation_snapshot=snapshot,
        provenance=provenance,
    )


def test_model_comes_from_the_calls_own_snapshot_before_row_provenance() -> None:
    proposal = _proposal(snapshot={"model": "call-model"}, provenance={"model": "row-model"})
    assert proposal_model_used(proposal) == "call-model"


def test_legacy_row_without_snapshot_uses_its_own_provenance() -> None:
    assert proposal_model_used(_proposal(provenance={"model": "legacy-model"})) == "legacy-model"


def test_snapshot_without_a_model_never_borrows_provenance() -> None:
    proposal = _proposal(snapshot={"prompt_version": "v2"}, provenance={"model": "row-model"})
    assert proposal_model_used(proposal) == ""


def test_non_scalar_model_and_absent_facts_are_unavailable() -> None:
    assert proposal_model_used(_proposal(snapshot={"model": {"forged": "x"}})) == ""
    assert proposal_model_used(_proposal()) == ""


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
