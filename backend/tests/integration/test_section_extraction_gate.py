"""Integration test: entailment gate wiring in _create_suggestions (Task 6).

Drives ``_create_suggestions`` directly — bypasses ``_assemble_prompt_text``
and ``_extract_with_llm`` which require real PDF files and real LLM calls.

Two assertions:
  a) A "found" field with evidence gets ``attribution_label == "entailed"``
     on its ExtractionEvidence row.
  b) A "not_found" field produces NO proposal row (abstention).

Patches:
  - ``section_extraction_service.gate_evidence`` → deterministic async stub
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

from app.infrastructure.parsing.base import ParsedBlock
from app.models.extraction import ExtractionEvidence, ExtractionRunStage
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
async def test_evidence_gets_attribution_label_and_not_found_skipped(
    db_session_real: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Gate labels found-field evidence; not_found field produces no proposal.

    Assertions:
      (a) The "found" field's ExtractionEvidence row has
          ``attribution_label == "entailed"``.
      (b) The "not_found" field produced NO ExtractionProposalRecord row.
    """

    # --- stub gate_evidence to return "entailed" without any LLM call ---
    async def _stub_gate(*, field_label: str, value: str, premise: str, model: Any) -> str:
        return "entailed"

    monkeypatch.setattr(ses, "gate_evidence", _stub_gate)

    # --- stub build_model to avoid MissingLLMKeyError ---
    fake_model = MagicMock()
    monkeypatch.setattr(ses, "build_model", lambda *a, **kw: fake_model)

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
        # This field is NOT in the seed entity type's field list, but we use a
        # second entry with a known-bad name so the not_found skip fires before
        # the field_map lookup fails. We need a recognizable name to verify no
        # proposal was written.  We'll check by run_id + field_id via SQL.
        # Actually: to prove abstention we add a SECOND field under a name that
        # IS in the field map with not_found status — but the seed only has one
        # field ("sample_size"). So: we add "sample_size" again under a
        # different key name that isn't in the field map to avoid collision.
        # Better: add a second "sample_size" dict variant with not_found under a
        # synthetic key not in field_map — it will be skipped before any DB write
        # AND will never match field_map. But that conflates "no proposal because
        # not_found" with "no proposal because field_not_found".
        #
        # The CLEAN way: we only have one seed field. We verify abstention by
        # checking proposal count: if not_found abstention works, the count stays
        # at exactly 1 (only the found field) even though two entries are in
        # extracted_data.  We add a same-named key under "status": "not_found"
        # but Python dicts can't have duplicate keys. So use a fresh dict with
        # only "not_found" fields and check proposal count is 0 for that case.
        #
        # Instead: run a SECOND call with only the not_found field and assert 0.
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

    # assertion (b): no proposals written for not_found
    proposal_count = (
        await db_session_real.execute(
            text("SELECT COUNT(*) FROM public.extraction_proposal_records WHERE run_id = :rid"),
            {"rid": str(run2.id)},
        )
    ).scalar()

    assert proposal_count == 0, f"Expected 0 proposals for not_found field, got {proposal_count}"
    assert count2 == 0

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
