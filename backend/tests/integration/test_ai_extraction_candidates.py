"""What the model answered → what lands: values, markers, evidence, verdicts.

Driven through ``AiExtraction.run_from_request`` with the recorded model
fake; the article text is seeded as parsed blocks, so evidence anchors
resolve for real. The seeded section is ``participants`` with one field,
``sample_size`` (number, ``allows_no_information``).
"""

from __future__ import annotations

from typing import Any
from uuid import UUID

import pytest
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.llm import entailment, verify
from app.models.extraction import ExtractionEvidence, ExtractionRun, ExtractionRunStage
from app.models.extraction_workflow import ExtractionProposalRecord
from app.schemas.llm_target import LlmTarget
from tests.fakes.recorded_llm import RecordedLlm
from tests.integration.conftest import SEED
from tests.integration.helpers.ai_extraction import (
    extraction,
    request,
    run_in_extract,
    seed_article_text,
)

pytestmark = pytest.mark.asyncio

QUOTE_A = "The mean sample size was 142 participants across all studies."
QUOTE_B = "Trials enrolled between 100 and 184 subjects on average."
QUOTE_C = "A total of 142 participants were enrolled."
QUOTE_D = "Participant count: one hundred and forty-two."
QUOTE_E = "Sample: 142 subjects total."
QUOTES = (QUOTE_A, QUOTE_B, QUOTE_C, QUOTE_D, QUOTE_E)


def _cite(*quotes: str) -> list[dict[str, Any]]:
    return [{"text": q, "page_number": 1} for q in quotes]


async def _extract(
    db: AsyncSession, fake: RecordedLlm, *, engine: LlmTarget | None = None
) -> tuple[ExtractionRun, Any]:
    """One single-section extraction of ``participants`` on a session run."""
    run = await run_in_extract(db)
    result = await extraction(db, fake).run_from_request(
        request(entity_type_id=SEED.primary_entity_type, run_id=run.id), engine=engine
    )
    return run, result


async def _proposal(db: AsyncSession, run_id: UUID) -> ExtractionProposalRecord:
    (row,) = (
        await db.scalars(
            select(ExtractionProposalRecord).where(ExtractionProposalRecord.run_id == run_id)
        )
    ).all()
    return row


async def _evidence(db: AsyncSession, run_id: UUID) -> list[ExtractionEvidence]:
    return list(
        (
            await db.scalars(
                select(ExtractionEvidence)
                .where(ExtractionEvidence.run_id == run_id)
                .order_by(ExtractionEvidence.rank)
            )
        ).all()
    )


async def test_a_found_value_lands_with_ranked_anchored_gated_evidence(
    db_session: AsyncSession,
) -> None:
    file_id = await seed_article_text(db_session, *QUOTES)
    fake = RecordedLlm(
        fields={
            "sample_size": {
                "value": 142,
                "confidence": 0.95,
                "reasoning": "Stated twice.",
                "evidence": _cite(QUOTE_A, QUOTE_B),
            }
        }
    )

    run, result = await _extract(db_session, fake)

    assert result.suggestions_created == 1
    row = await _proposal(db_session, run.id)
    assert row.proposed_value == {"value": 142.0}
    assert (row.confidence_score, row.rationale) == (0.95, "Stated twice.")
    evidence = await _evidence(db_session, run.id)
    assert [(e.rank, e.text_content) for e in evidence] == [(0, QUOTE_A), (1, QUOTE_B)]
    assert all(e.proposal_record_id == row.id for e in evidence)
    # Anchored to the parsed blocks of the article's file …
    assert all(e.article_file_id == file_id and e.position["anchor"] for e in evidence)
    # … and each anchored quote of a found value went through the judge.
    assert [e.attribution_label for e in evidence] == ["entailed", "entailed"]
    assert len(fake.prompts(entailment.NAME)) == 2


async def test_evidence_is_capped_at_three_rows(db_session: AsyncSession) -> None:
    await seed_article_text(db_session, *QUOTES)
    fake = RecordedLlm(fields={"sample_size": {"value": 142, "evidence": _cite(*QUOTES)}})

    run, _ = await _extract(db_session, fake)

    assert [e.text_content for e in await _evidence(db_session, run.id)] == list(QUOTES[:3])


async def test_an_unanchored_quote_is_ungroundable_and_never_judged(
    db_session: AsyncSession,
) -> None:
    """A value that only a figure states cannot be grounded in the text: the
    row is flagged for a human instead of judging a quote the document lacks."""
    await seed_article_text(db_session, QUOTE_A)
    fake = RecordedLlm(
        fields={"sample_size": {"value": 999, "evidence": _cite("a quote absent from the text")}}
    )

    run, _ = await _extract(db_session, fake)

    (row,) = await _evidence(db_session, run.id)
    assert row.attribution_label == "ungroundable"
    assert row.position == {}
    assert fake.prompts(entailment.NAME) == []


async def test_a_failing_judge_degrades_to_an_unlabelled_row(db_session: AsyncSession) -> None:
    await seed_article_text(db_session, QUOTE_A)
    fake = RecordedLlm(
        fields={"sample_size": {"value": 142, "evidence": _cite(QUOTE_A)}},
        fail={entailment.NAME: RuntimeError("judge down")},
    )

    run, result = await _extract(db_session, fake)

    assert result.suggestions_created == 1
    (row,) = await _evidence(db_session, run.id)
    assert row.attribution_label is None


async def test_not_found_lands_the_no_information_marker(db_session: AsyncSession) -> None:
    """ADR-0016: an abstention is a recorded, resolved proposal — never a
    silent drop, never the status dict, no misleading 0% confidence, the
    "why" kept, and no evidence even when the model cited some."""
    await seed_article_text(db_session, QUOTE_A)
    fake = RecordedLlm(
        fields={
            "sample_size": {
                "status": "not_found",
                "value": None,
                "confidence": 0.0,
                "reasoning": "Not mentioned.",
                "evidence": _cite(QUOTE_A),
            }
        }
    )

    run, result = await _extract(db_session, fake)

    assert result.suggestions_created == 1
    row = await _proposal(db_session, run.id)
    assert row.proposed_value == {"value": None, "absent_reason": "no_information"}
    assert row.confidence_score is None
    assert row.rationale == "Not mentioned."
    assert await _evidence(db_session, run.id) == []


async def test_not_found_on_an_opted_out_field_carries_no_marker(
    db_session: AsyncSession,
) -> None:
    """``allows_no_information = false`` (0062): the form renders no marker
    button there, so a marker would be invisible AND unclearable while
    counting as filled. The abstention still lands, value null."""
    await db_session.execute(
        text("UPDATE extraction_fields SET allows_no_information = false WHERE id = :id"),
        {"id": SEED.primary_field},
    )
    await seed_article_text(db_session)
    fake = RecordedLlm(
        fields={"sample_size": {"status": "not_found", "value": None, "reasoning": "silent"}}
    )

    run, _ = await _extract(db_session, fake)

    row = await _proposal(db_session, run.id)
    assert row.proposed_value == {"value": None}
    assert row.rationale == "silent"


async def test_ambiguous_keeps_its_value_and_confidence(db_session: AsyncSession) -> None:
    """ADR-0016 Phase 1: "present but conflicting" is not absent — it stays a
    needs-attention proposal that still blocks the finalize gate; its
    evidence lands unjudged."""
    await seed_article_text(db_session, QUOTE_A, QUOTE_B)
    fake = RecordedLlm(
        fields={
            "sample_size": {
                "status": "ambiguous",
                "value": 142,
                "confidence": 0.3,
                "reasoning": "two conflicting statements",
                "evidence": _cite(QUOTE_A),
            }
        }
    )

    run, _ = await _extract(db_session, fake)

    row = await _proposal(db_session, run.id)
    assert row.proposed_value == {"value": 142.0}
    assert (row.confidence_score, row.rationale) == (0.3, "two conflicting statements")
    (evidence,) = await _evidence(db_session, run.id)
    assert evidence.attribution_label is None
    assert fake.prompts(entailment.NAME) == []


# --------------------------------------------------------------------------
# Verified mode: the verdict is an annotation, the snapshot the execution truth
# --------------------------------------------------------------------------

VERIFIED = LlmTarget(provider="openai", model="gpt-5.6-luna", mode_requested="verified")


async def test_verified_mode_annotates_the_found_value(db_session: AsyncSession) -> None:
    await seed_article_text(db_session, QUOTE_A)
    fake = RecordedLlm(
        fields={"sample_size": {"value": 142, "confidence": 0.9}},
        verdicts={"sample_size": "unsupported"},
    )

    run, _ = await _extract(db_session, fake, engine=VERIFIED)

    row = await _proposal(db_session, run.id)
    # ANNOTATION, never a mutation of value or confidence (§IX).
    assert row.proposed_value == {"value": 142.0, "verification": {"verdict": "unsupported"}}
    assert row.confidence_score == 0.9
    assert (row.provenance["mode_executed"], row.provenance["passes"]) == ("verified", 2)
    await db_session.refresh(run)
    section = run.results["provenance"]["sections"][str(SEED.primary_entity_type)]
    assert (section["mode_requested"], section["mode_executed"], section["passes"]) == (
        "verified",
        "verified",
        2,
    )
    # The section's tokens are what it cost: extract + verify.
    assert section["tokens"]["total"] == 30


async def test_verified_mode_never_asks_about_a_no_information_answer(
    db_session: AsyncSession,
) -> None:
    await seed_article_text(db_session)
    fake = RecordedLlm(fields={"sample_size": {"status": "not_found", "value": None}})

    run, _ = await _extract(db_session, fake, engine=VERIFIED)

    assert fake.prompts(verify.NAME) == []
    row = await _proposal(db_session, run.id)
    assert "verification" not in row.proposed_value
    assert (row.provenance["mode_executed"], row.provenance["passes"]) == ("verified", 1)


async def test_a_failing_verify_pass_degrades_to_fast(db_session: AsyncSession) -> None:
    await seed_article_text(db_session)
    fake = RecordedLlm(
        fields={"sample_size": {"value": 142}}, fail={verify.NAME: RuntimeError("verify down")}
    )

    run, result = await _extract(db_session, fake, engine=VERIFIED)

    assert result.suggestions_created == 1
    row = await _proposal(db_session, run.id)
    assert row.proposed_value == {"value": 142.0}
    assert (row.provenance["mode_requested"], row.provenance["mode_executed"]) == (
        "verified",
        "fast",
    )


# --------------------------------------------------------------------------
# The section snapshot
# --------------------------------------------------------------------------


async def test_the_section_snapshot_records_the_call_without_the_article(
    db_session: AsyncSession,
) -> None:
    await seed_article_text(db_session, "ARTICLE BODY " + QUOTE_A)
    fake = RecordedLlm(fields={"sample_size": {"value": 142}})

    run, _ = await _extract(db_session, fake)

    await db_session.refresh(run)
    section = run.results["provenance"]["sections"][str(SEED.primary_entity_type)]
    assert section["ran_by_user_id"] == str(SEED.primary_profile)
    assert (section["provider"], section["model"]) == (
        settings.LLM_PROVIDER,
        settings.LLM_DEFAULT_MODEL,
    )
    assert (section["mode_requested"], section["mode_executed"], section["passes"]) == (
        "fast",
        "fast",
        1,
    )
    assert section["tokens"] == {"prompt": 10, "completion": 5, "total": 15}
    # A session run stays in EXTRACT: reviewers advance it explicitly.
    assert run.stage == ExtractionRunStage.EXTRACT.value
    composition = section["prompt_composition"]
    # The article is a marker in the persisted instruction, never its body.
    assert "[[ARTICLE_MARKDOWN]]" in composition["section_instruction"]
    assert "ARTICLE BODY" not in composition["section_instruction"]
    assert "ARTICLE BODY" in fake.field_calls()[0].user_prompt
    assert composition["section_name"] == "participants"
    assert composition["fields_requested"] == ["sample_size"]
    assert composition["llm_calls"] == 1
    assert composition["article_ref"]["file_name"] == "article.pdf"
    assert composition["article_ref"]["truncated"] is False
