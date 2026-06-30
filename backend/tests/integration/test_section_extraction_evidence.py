"""Integration tests: multi-evidence persistence per field (Task 4).

Drives ``_create_suggestions`` directly — bypasses ``_assemble_prompt_text``
and ``_extract_with_llm`` which require real PDF files and real LLM calls.

Assertions:
  (a) A field with a 2-item evidence list → 2 ExtractionEvidence rows
      with rank 0 and 1.
  (b) A field with a single-dict evidence (legacy P0 shape) → 1 row at rank 0.
  (c) Cap: a field with 5 evidence items → exactly 3 rows (rank 0–2).
  (d) Abstention (status "not_found") → 0 evidence rows, 0 proposals.

Patches:
  - ``app.llm.entailment.gate_evidence`` → deterministic async stub
    returning ``"entailed"`` (no real LLM call).
  - ``section_extraction_service.build_model`` → no-op (gate stub bypasses it
    but it must not raise MissingLLMKeyError on the build call).

Uses ``db_session_real`` because ``_create_suggestions`` calls ``flush()`` and
we need to SELECT the flushed evidence rows in the same transaction context.
"""

from __future__ import annotations

from typing import Any
from unittest.mock import MagicMock

import pytest
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

import app.llm.entailment as entailment_mod
from app.infrastructure.parsing.base import ParsedBlock
from app.models.extraction import ExtractionEvidence, ExtractionRunStage
from app.services import section_extraction_service as ses
from app.services.run_lifecycle_service import RunLifecycleService
from tests.integration.conftest import SEED

_BBOX = {"x": 0.0, "y": 0.0, "width": 400.0, "height": 12.0}

# Evidence quotes seeded into ParsedBlocks so build_anchor() can resolve them.
_QUOTE_A = "The mean sample size was 142 participants across all studies."
_QUOTE_B = "Trials enrolled between 100 and 184 subjects on average."
_QUOTE_C = "A total of 142 participants were enrolled."
_QUOTE_D = "Participant count: one hundred and forty-two."
_QUOTE_E = "Sample: 142 subjects total."


async def _build_run_in_extract(db: AsyncSession) -> Any:
    """Create a run advanced to EXTRACT and return it."""
    lifecycle = RunLifecycleService(db)
    run = await lifecycle.create_run(
        project_id=SEED.primary_project,
        article_id=SEED.primary_article,
        project_template_id=SEED.primary_template,
        user_id=SEED.primary_profile,
    )
    run = await lifecycle.advance_stage(
        run_id=run.id,
        target_stage=ExtractionRunStage.EXTRACT,
        user_id=SEED.primary_profile,
    )
    await db.flush()
    return run


def _make_service(
    db: AsyncSession, trace_id: str = "test-evidence"
) -> ses.SectionExtractionService:
    """Return a minimally-wired service instance (no real storage needed)."""
    storage = MagicMock()
    return ses.SectionExtractionService(
        db=db,
        user_id=str(SEED.primary_profile),
        storage=storage,
        trace_id=trace_id,
        openai_api_key=None,
    )


def _make_parsed_blocks(*quotes: str) -> list[ParsedBlock]:
    """Return ParsedBlocks for each quote so build_anchor resolves them."""
    blocks = []
    offset = 0
    for i, quote in enumerate(quotes):
        blocks.append(
            ParsedBlock(
                page_number=1,
                block_index=i,
                text=quote,
                char_start=offset,
                char_end=offset + len(quote),
                bbox=_BBOX,
                block_type="paragraph",
            )
        )
        offset += len(quote) + 1
    return blocks


async def _cleanup_runs(db: AsyncSession, run_ids: list[str]) -> None:
    """Delete test run data in dependency order."""
    await db.commit()
    await db.execute(
        text("DELETE FROM public.extraction_evidence WHERE run_id = ANY(:ids)"),
        {"ids": run_ids},
    )
    await db.execute(
        text("DELETE FROM public.extraction_proposal_records WHERE run_id = ANY(:ids)"),
        {"ids": run_ids},
    )
    await db.execute(
        text("DELETE FROM public.extraction_runs WHERE id = ANY(:ids)"),
        {"ids": run_ids},
    )
    await db.commit()


@pytest.mark.asyncio
async def test_two_ranked_rows(
    db_session_real: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A field with a 2-item evidence list writes 2 ExtractionEvidence rows, rank 0 and 1."""

    async def _stub_gate(**_kwargs: Any) -> str:
        return "entailed"

    monkeypatch.setattr(entailment_mod, "gate_evidence", _stub_gate)
    monkeypatch.setattr(ses, "build_model", lambda *_a, **_kw: MagicMock())

    run = await _build_run_in_extract(db_session_real)

    service = _make_service(db_session_real)
    service._run_anchor_blocks = _make_parsed_blocks(_QUOTE_A, _QUOTE_B)
    service._run_anchor_file_id = None

    extracted_data: dict[str, Any] = {
        "sample_size": {
            "value": 142,
            "confidence": 0.95,
            "reasoning": "Stated in two places.",
            "evidence": [
                {"text": _QUOTE_A, "page_number": 1},
                {"text": _QUOTE_B, "page_number": 1},
            ],
            "status": "found",
        },
    }

    count = await service._create_suggestions(
        project_id=SEED.primary_project,
        article_id=SEED.primary_article,
        entity_type_id=SEED.primary_entity_type,
        parent_instance_id=None,
        extracted_data=extracted_data,
        run=run,
        model="gpt-4o-mini",
    )
    await db_session_real.flush()

    rows = (
        (
            await db_session_real.execute(
                select(ExtractionEvidence)
                .where(ExtractionEvidence.run_id == run.id)
                .order_by(ExtractionEvidence.rank)
            )
        )
        .scalars()
        .all()
    )

    assert count == 1, f"Expected 1 proposal written, got {count}"
    assert len(rows) == 2, f"Expected 2 evidence rows, got {len(rows)}"
    assert rows[0].rank == 0, f"Expected rank 0, got {rows[0].rank}"
    assert rows[1].rank == 1, f"Expected rank 1, got {rows[1].rank}"
    assert rows[0].text_content == _QUOTE_A
    assert rows[1].text_content == _QUOTE_B

    await _cleanup_runs(db_session_real, [str(run.id)])


@pytest.mark.asyncio
async def test_legacy_single_dict(
    db_session_real: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Legacy single-dict evidence shape (P0) writes exactly 1 row at rank 0."""

    async def _stub_gate(**_kwargs: Any) -> str:
        return "entailed"

    monkeypatch.setattr(entailment_mod, "gate_evidence", _stub_gate)
    monkeypatch.setattr(ses, "build_model", lambda *_a, **_kw: MagicMock())

    run = await _build_run_in_extract(db_session_real)

    service = _make_service(db_session_real, trace_id="test-legacy")
    service._run_anchor_blocks = _make_parsed_blocks(_QUOTE_A)
    service._run_anchor_file_id = None

    # Legacy P0 shape: evidence is a plain dict, NOT a list.
    extracted_data: dict[str, Any] = {
        "sample_size": {
            "value": 142,
            "confidence": 0.9,
            "reasoning": "Stated in abstract.",
            "evidence": {"text": _QUOTE_A, "page_number": 1},  # single dict (P0 shape)
            "status": "found",
        },
    }

    count = await service._create_suggestions(
        project_id=SEED.primary_project,
        article_id=SEED.primary_article,
        entity_type_id=SEED.primary_entity_type,
        parent_instance_id=None,
        extracted_data=extracted_data,
        run=run,
        model="gpt-4o-mini",
    )
    await db_session_real.flush()

    rows = (
        (
            await db_session_real.execute(
                select(ExtractionEvidence).where(ExtractionEvidence.run_id == run.id)
            )
        )
        .scalars()
        .all()
    )

    assert count == 1, f"Expected 1 proposal, got {count}"
    assert len(rows) == 1, f"Expected 1 evidence row for legacy dict, got {len(rows)}"
    assert rows[0].rank == 0, f"Expected rank 0, got {rows[0].rank}"
    assert rows[0].text_content == _QUOTE_A

    await _cleanup_runs(db_session_real, [str(run.id)])


@pytest.mark.asyncio
async def test_abstention_records_no_info_proposal(
    db_session_real: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A not_found field records ONE no-info proposal (value=None, no
    confidence) with 0 evidence rows — the abstention is now a first-class,
    traceable outcome instead of a silent drop."""

    async def _stub_gate(**_kwargs: Any) -> str:
        return "entailed"

    monkeypatch.setattr(entailment_mod, "gate_evidence", _stub_gate)
    monkeypatch.setattr(ses, "build_model", lambda *_a, **_kw: MagicMock())

    run = await _build_run_in_extract(db_session_real)

    service = _make_service(db_session_real, trace_id="test-abstention")
    service._run_anchor_blocks = []
    service._run_anchor_file_id = None

    extracted_data: dict[str, Any] = {
        "sample_size": {
            "value": None,
            "confidence": None,
            "reasoning": "Not mentioned.",
            "evidence": None,
            "status": "not_found",
        },
    }

    count = await service._create_suggestions(
        project_id=SEED.primary_project,
        article_id=SEED.primary_article,
        entity_type_id=SEED.primary_entity_type,
        parent_instance_id=None,
        extracted_data=extracted_data,
        run=run,
        model="gpt-4o-mini",
    )
    await db_session_real.flush()

    evidence_count = (
        await db_session_real.execute(
            text("SELECT COUNT(*) FROM public.extraction_evidence WHERE run_id = :rid"),
            {"rid": str(run.id)},
        )
    ).scalar()

    proposal_count = (
        await db_session_real.execute(
            text("SELECT COUNT(*) FROM public.extraction_proposal_records WHERE run_id = :rid"),
            {"rid": str(run.id)},
        )
    ).scalar()

    assert count == 1, f"Expected 1 no-info proposal for not_found, got {count}"
    assert evidence_count == 0, f"Expected 0 evidence rows, got {evidence_count}"
    assert proposal_count == 1, f"Expected 1 no-info proposal record, got {proposal_count}"

    proposed = (
        await db_session_real.execute(
            text(
                "SELECT proposed_value, confidence_score, rationale "
                "FROM public.extraction_proposal_records WHERE run_id = :rid"
            ),
            {"rid": str(run.id)},
        )
    ).first()
    assert proposed is not None
    # The inner value is null (never the status dict); confidence dropped (a
    # not_found 0.0 reads as a misleading 0%); the "why not found" reasoning kept.
    assert proposed.proposed_value == {"value": None}
    assert proposed.confidence_score is None
    assert proposed.rationale == "Not mentioned."

    await _cleanup_runs(db_session_real, [str(run.id)])


@pytest.mark.asyncio
async def test_caps_at_three(
    db_session_real: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A field with 5 evidence items writes exactly 3 rows (rank 0–2), cap enforced."""

    async def _stub_gate(**_kwargs: Any) -> str:
        return "entailed"

    monkeypatch.setattr(entailment_mod, "gate_evidence", _stub_gate)
    monkeypatch.setattr(ses, "build_model", lambda *_a, **_kw: MagicMock())

    run = await _build_run_in_extract(db_session_real)

    service = _make_service(db_session_real, trace_id="test-cap")
    service._run_anchor_blocks = _make_parsed_blocks(
        _QUOTE_A, _QUOTE_B, _QUOTE_C, _QUOTE_D, _QUOTE_E
    )
    service._run_anchor_file_id = None

    extracted_data: dict[str, Any] = {
        "sample_size": {
            "value": 142,
            "confidence": 0.9,
            "reasoning": "Multiple sources.",
            "evidence": [
                {"text": _QUOTE_A, "page_number": 1},
                {"text": _QUOTE_B, "page_number": 1},
                {"text": _QUOTE_C, "page_number": 2},
                {"text": _QUOTE_D, "page_number": 2},
                {"text": _QUOTE_E, "page_number": 3},
            ],
            "status": "found",
        },
    }

    count = await service._create_suggestions(
        project_id=SEED.primary_project,
        article_id=SEED.primary_article,
        entity_type_id=SEED.primary_entity_type,
        parent_instance_id=None,
        extracted_data=extracted_data,
        run=run,
        model="gpt-4o-mini",
    )
    await db_session_real.flush()

    rows = (
        (
            await db_session_real.execute(
                select(ExtractionEvidence)
                .where(ExtractionEvidence.run_id == run.id)
                .order_by(ExtractionEvidence.rank)
            )
        )
        .scalars()
        .all()
    )

    assert count == 1, f"Expected 1 proposal, got {count}"
    assert len(rows) == 3, f"Expected 3 evidence rows (cap=3), got {len(rows)}"
    assert [r.rank for r in rows] == [0, 1, 2], (
        f"Expected ranks [0,1,2], got {[r.rank for r in rows]}"
    )
    assert rows[0].text_content == _QUOTE_A
    assert rows[1].text_content == _QUOTE_B
    assert rows[2].text_content == _QUOTE_C

    await _cleanup_runs(db_session_real, [str(run.id)])


@pytest.mark.asyncio
async def test_unanchored_evidence_is_ungroundable(
    db_session_real: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Evidence whose quote does not anchor to any block gets label 'ungroundable'.

    The gate must NOT be called for an unanchored row — if it were, the label
    would be 'entailed' (or None), not 'ungroundable'.
    """

    async def _gate_must_not_be_called(_specs: Any, *_a: Any, **_kw: Any) -> list[Any]:
        raise AssertionError("run_entailment_gate must not be called for unanchored evidence")

    monkeypatch.setattr(ses, "run_entailment_gate", _gate_must_not_be_called)
    monkeypatch.setattr(ses, "build_model", lambda *_a, **_kw: MagicMock())

    run = await _build_run_in_extract(db_session_real)

    service = _make_service(db_session_real, trace_id="test-ungroundable")
    # Parsed blocks contain text that does NOT include the evidence quote below.
    service._run_anchor_blocks = _make_parsed_blocks(_QUOTE_A)
    service._run_anchor_file_id = None

    extracted_data: dict[str, Any] = {
        "sample_size": {
            "value": 999,
            "confidence": 0.9,
            "reasoning": "from a figure",
            "evidence": [{"text": "a quote absent from the document text", "page_number": 1}],
            "status": "found",
        },
    }

    count = await service._create_suggestions(
        project_id=SEED.primary_project,
        article_id=SEED.primary_article,
        entity_type_id=SEED.primary_entity_type,
        parent_instance_id=None,
        extracted_data=extracted_data,
        run=run,
        model="gpt-4o-mini",
    )
    await db_session_real.flush()

    rows = (
        (
            await db_session_real.execute(
                select(ExtractionEvidence).where(ExtractionEvidence.run_id == run.id)
            )
        )
        .scalars()
        .all()
    )

    assert count == 1, f"Expected 1 proposal, got {count}"
    assert len(rows) == 1, f"Expected 1 evidence row, got {len(rows)}"
    assert rows[0].attribution_label == "ungroundable", (
        f"Expected 'ungroundable', got {rows[0].attribution_label!r}"
    )

    await _cleanup_runs(db_session_real, [str(run.id)])
