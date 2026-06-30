"""Integration test: entailment gate wiring in _create_suggestions (Task 6).

Drives ``_create_suggestions`` directly — bypasses ``_assemble_prompt_text``
and ``_extract_with_llm`` which require real PDF files and real LLM calls.

Two assertions:
  a) A "found" field with evidence gets ``attribution_label == "entailed"``
     on its ExtractionEvidence row.
  b) A "not_found" field produces NO proposal row (abstention).

Patches:
  - ``app.llm.entailment.gate_evidence`` → deterministic async stub
    returning ``"entailed"`` (no real LLM call).
  - ``section_extraction_service.build_model`` → no-op (gate stub bypasses it,
    but it must not raise MissingLLMKeyError on the build call).

Uses ``db_session_real`` because ``_create_suggestions`` calls ``flush()`` and
we need to SELECT the flushed evidence row in the same transaction context.
The session-scoped ``seeded_integration_db`` autouse fixture populates the
entity-type / field / instance / template chain we query.
"""

from __future__ import annotations

from typing import Any
from unittest.mock import MagicMock

import pytest
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

import app.llm.entailment as entailment_mod
from app.core.config import settings
from app.infrastructure.parsing.base import ParsedBlock
from app.llm.extractor import LlmUsage
from app.models.extraction import ExtractionEvidence, ExtractionRun, ExtractionRunStage
from app.services import section_extraction_service as ses
from app.services.run_lifecycle_service import RunLifecycleService
from tests.integration.conftest import SEED

_BBOX = {"x": 0.0, "y": 0.0, "width": 400.0, "height": 12.0}

# The evidence quote seeded into a ParsedBlock so build_anchor() can resolve it.
_EVIDENCE_QUOTE = "The mean sample size was 142 participants across all studies."


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


def _make_service(db: AsyncSession) -> ses.SectionExtractionService:
    """Return a minimally-wired service instance (no real storage needed)."""
    storage = MagicMock()  # _create_suggestions does not touch storage
    return ses.SectionExtractionService(
        db=db,
        user_id=str(SEED.primary_profile),
        storage=storage,
        trace_id="test-gate",
        openai_api_key=None,
    )


def _make_anchor_block() -> ParsedBlock:
    """Return a ParsedBlock containing ``_EVIDENCE_QUOTE`` on page 1."""
    return ParsedBlock(
        page_number=1,
        block_index=0,
        text=_EVIDENCE_QUOTE,
        char_start=0,
        char_end=len(_EVIDENCE_QUOTE),
        bbox=_BBOX,
        block_type="paragraph",
    )


@pytest.mark.asyncio
async def test_evidence_gets_attribution_label_and_not_found_recorded(
    db_session_real: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Gate labels found-field evidence; not_found field records a no-info proposal.

    Assertions:
      (a) The "found" field's ExtractionEvidence row has
          ``attribution_label == "entailed"``.
      (b) The "not_found" field records ONE no-info ExtractionProposalRecord
          (value=None) with no evidence — the abstention is traceable, not dropped.
    """

    # --- stub gate_evidence to return "entailed" without any LLM call ---
    async def _stub_gate(**_kwargs: Any) -> str:
        return "entailed"

    monkeypatch.setattr(entailment_mod, "gate_evidence", _stub_gate)

    # --- stub build_model to avoid MissingLLMKeyError ---
    fake_model = MagicMock()
    monkeypatch.setattr(ses, "build_model", lambda *_a, **_kw: fake_model)

    run = await _build_run_in_extract(db_session_real)

    service = _make_service(db_session_real)
    # Pre-load a real block so build_anchor can resolve the evidence quote.
    service._run_anchor_blocks = [_make_anchor_block()]
    service._run_anchor_file_id = None  # article_file_id optional for this test

    # "sample_size" maps to PRIMARY_FIELD_ID in the seed entity type.
    extracted_data: dict[str, Any] = {
        "sample_size": {
            "value": 142,
            "confidence": 0.95,
            "reasoning": "Stated in the abstract.",
            "evidence": {
                "text": _EVIDENCE_QUOTE,
                "page_number": 1,
            },
            "status": "found",
        },
        # The not_found case is verified below in a second _create_suggestions call.
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

    # --- assertion (a): found field evidence has attribution_label == "entailed" ---
    evidence_rows = (
        (
            await db_session_real.execute(
                select(ExtractionEvidence).where(ExtractionEvidence.run_id == run.id)
            )
        )
        .scalars()
        .all()
    )

    assert len(evidence_rows) == 1, (
        f"Expected 1 evidence row (for the found field), got {len(evidence_rows)}"
    )
    assert evidence_rows[0].attribution_label == "entailed", (
        f"Expected attribution_label='entailed', got {evidence_rows[0].attribution_label!r}"
    )
    assert count == 1

    # --- Run a second call with a not_found field; assert 0 proposals written ---
    run2 = await _build_run_in_extract(db_session_real)
    service2 = _make_service(db_session_real)
    service2._run_anchor_blocks = []
    service2._run_anchor_file_id = None

    not_found_data: dict[str, Any] = {
        "sample_size": {
            "value": None,
            "confidence": None,
            "reasoning": "Not mentioned in the article.",
            "evidence": None,
            "status": "not_found",
        },
    }

    count2 = await service2._create_suggestions(
        project_id=SEED.primary_project,
        article_id=SEED.primary_article,
        entity_type_id=SEED.primary_entity_type,
        parent_instance_id=None,
        extracted_data=not_found_data,
        run=run2,
        model="gpt-4o-mini",
    )
    await db_session_real.flush()

    # assertion (b): exactly one no-info proposal written for not_found, no evidence
    proposal_count = (
        await db_session_real.execute(
            text("SELECT COUNT(*) FROM public.extraction_proposal_records WHERE run_id = :rid"),
            {"rid": str(run2.id)},
        )
    ).scalar()

    assert proposal_count == 1, (
        f"Expected 1 no-info proposal for not_found field, got {proposal_count}"
    )
    assert count2 == 1

    evidence_count2 = (
        await db_session_real.execute(
            text("SELECT COUNT(*) FROM public.extraction_evidence WHERE run_id = :rid"),
            {"rid": str(run2.id)},
        )
    ).scalar()
    assert evidence_count2 == 0, f"Expected 0 evidence rows for no-info, got {evidence_count2}"

    # --- cleanup (db_session_real commits persist) ---
    # Commit test data first so the deferred article-coherence trigger fires
    # while the runs still exist in the DB.  Then delete in a second commit.
    await db_session_real.commit()

    run_ids = [str(run.id), str(run2.id)]
    # Cascade order: evidence → proposal_records → runs (FK CASCADE handles
    # child tables under runs; explicit DELETE for evidence which references
    # proposal_records via proposal_record_id).
    await db_session_real.execute(
        text("DELETE FROM public.extraction_evidence WHERE run_id = ANY(:ids)"),
        {"ids": run_ids},
    )
    await db_session_real.execute(
        text("DELETE FROM public.extraction_proposal_records WHERE run_id = ANY(:ids)"),
        {"ids": run_ids},
    )
    await db_session_real.execute(
        text("DELETE FROM public.extraction_runs WHERE id = ANY(:ids)"),
        {"ids": run_ids},
    )
    await db_session_real.commit()


@pytest.mark.asyncio
async def test_session_run_extraction_persists_provenance(
    db_session_real: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A session-run extraction (run_id passed) persists results['provenance'].

    Regression: ``extract_section`` only wrote provenance in the
    ``manage_lifecycle`` (standalone) branch, so SESSION runs — the extraction
    and QA screens always pass an existing ``run_id`` — had no provenance and the
    review popover's "How this was generated" metadata never rendered. The run
    must stay alive (EXTRACT) — the HITL session owns its lifecycle — so the
    provenance is merged into ``results`` without completing the run.
    """

    async def _stub_gate(**_kwargs: Any) -> str:
        return "entailed"

    monkeypatch.setattr(entailment_mod, "gate_evidence", _stub_gate)
    fake_model = MagicMock()
    monkeypatch.setattr(ses, "build_model", lambda *_a, **_kw: fake_model)

    run = await _build_run_in_extract(db_session_real)
    service = _make_service(db_session_real)

    # Stub the two IO methods extract_section calls before _create_suggestions:
    # _assemble_prompt_text (needs a real PDF) and _extract_with_llm (real LLM).
    async def _fake_assemble(_article_id: Any, _model: str) -> str:
        service._run_anchor_blocks = [_make_anchor_block()]
        service._run_anchor_file_id = None
        return "fake prompt"

    monkeypatch.setattr(service, "_assemble_prompt_text", _fake_assemble)

    async def _fake_extract(**_kwargs: Any) -> tuple[dict[str, Any], LlmUsage]:
        # Mirror the real _extract_with_llm, which builds the run provenance snapshot.
        service._run_provenance = service._build_run_provenance(
            model="gpt-4o-mini",
            prompt_name="section_extraction",
            prompt_version="1",
            prompt_text="PROMPT TEXT",
        )
        data = {
            "sample_size": {
                "value": 142,
                "confidence": 0.95,
                "reasoning": "Stated in the abstract.",
                "evidence": {"text": _EVIDENCE_QUOTE, "page_number": 1},
                "status": "found",
            }
        }
        return data, LlmUsage(prompt_tokens=100, completion_tokens=20)

    monkeypatch.setattr(service, "_extract_with_llm", _fake_extract)

    await service.extract_section(
        project_id=SEED.primary_project,
        article_id=SEED.primary_article,
        template_id=SEED.primary_template,
        entity_type_id=SEED.primary_entity_type,
        run_id=run.id,  # SESSION PATH — manage_lifecycle is False
    )
    await db_session_real.flush()

    refreshed = await db_session_real.get(ExtractionRun, run.id)
    assert refreshed is not None and refreshed.results is not None
    assert "provenance" in refreshed.results, (
        "session-run extraction did not persist results['provenance'] — the "
        "review popover's 'How this was generated' metadata would be empty."
    )
    prov = refreshed.results["provenance"]
    assert prov["model"] == "gpt-4o-mini"
    assert prov["provider"] == settings.LLM_PROVIDER
    assert prov["tokens"]["total"] == 120
    # The session run must stay editable (NOT completed by this call).
    assert refreshed.stage == ExtractionRunStage.EXTRACT.value

    # --- cleanup ---
    await db_session_real.commit()
    run_ids = [str(run.id)]
    await db_session_real.execute(
        text("DELETE FROM public.extraction_evidence WHERE run_id = ANY(:ids)"),
        {"ids": run_ids},
    )
    await db_session_real.execute(
        text("DELETE FROM public.extraction_proposal_records WHERE run_id = ANY(:ids)"),
        {"ids": run_ids},
    )
    await db_session_real.execute(
        text("DELETE FROM public.extraction_runs WHERE id = ANY(:ids)"),
        {"ids": run_ids},
    )
    await db_session_real.commit()


@pytest.mark.asyncio
async def test_gate_exception_degrades_not_aborts(
    db_session_real: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Judge failure must degrade (attribution_label NULL) not abort extraction.

    Assertions:
      (a) _create_suggestions returns successfully (no exception raised).
      (b) The ExtractionEvidence row for the found field persists with
          attribution_label IS None (degrade path).
      (c) Proposal count is unchanged — the proposal was still written.
    """

    async def _raising_gate(**_kwargs: Any) -> str:
        raise RuntimeError("judge down")

    monkeypatch.setattr(entailment_mod, "gate_evidence", _raising_gate)

    fake_model = MagicMock()
    monkeypatch.setattr(ses, "build_model", lambda *_a, **_kw: fake_model)

    run = await _build_run_in_extract(db_session_real)

    service = _make_service(db_session_real)
    service._run_anchor_blocks = [_make_anchor_block()]
    service._run_anchor_file_id = None

    extracted_data: dict[str, Any] = {
        "sample_size": {
            "value": 142,
            "confidence": 0.95,
            "reasoning": "Stated in the abstract.",
            "evidence": {
                "text": _EVIDENCE_QUOTE,
                "page_number": 1,
            },
            "status": "found",
        },
    }

    # (a) no exception — extraction succeeds despite judge failure
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

    # (c) proposal was still written
    assert count == 1, f"Expected 1 proposal, got {count}"

    # (b) evidence row persists with attribution_label IS NULL
    evidence_rows = (
        (
            await db_session_real.execute(
                select(ExtractionEvidence).where(ExtractionEvidence.run_id == run.id)
            )
        )
        .scalars()
        .all()
    )

    assert len(evidence_rows) == 1, f"Expected 1 evidence row, got {len(evidence_rows)}"
    assert evidence_rows[0].attribution_label is None, (
        f"Expected attribution_label=None (degrade), got {evidence_rows[0].attribution_label!r}"
    )

    # --- cleanup ---
    await db_session_real.commit()

    run_ids = [str(run.id)]
    await db_session_real.execute(
        text("DELETE FROM public.extraction_evidence WHERE run_id = ANY(:ids)"),
        {"ids": run_ids},
    )
    await db_session_real.execute(
        text("DELETE FROM public.extraction_proposal_records WHERE run_id = ANY(:ids)"),
        {"ids": run_ids},
    )
    await db_session_real.execute(
        text("DELETE FROM public.extraction_runs WHERE id = ANY(:ids)"),
        {"ids": run_ids},
    )
    await db_session_real.commit()
