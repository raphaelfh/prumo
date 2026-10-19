"""What the model answered → what lands: values, markers, evidence, verdicts.

Driven through ``AiExtraction.run_from_request`` with the recorded model
fake; the article text is seeded as parsed blocks, so evidence anchors
resolve for real. The seeded section is ``participants`` with one field,
``sample_size`` (number, ``allows_no_information``).
"""

from __future__ import annotations

import json
from typing import Any
from uuid import UUID

import pytest
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession
from structlog.testing import capture_logs

from app.core.config import settings
from app.llm import entailment, verify
from app.models.extraction import ExtractionEvidence, ExtractionRun, ExtractionRunStage
from app.models.extraction_workflow import ExtractionProposalRecord
from app.schemas.llm_target import LlmTarget
from app.services.ai_extraction._candidates import build_candidates
from app.services.ai_extraction.landing import ProposalCandidate
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


def _cite(*quotes: str, block_ref: str = "p1·b0") -> list[dict[str, Any]]:
    return [{"block_ref": block_ref, "quote": q} for q in quotes]


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


async def test_unanchored_quote_never_persists_a_page(db_session: AsyncSession) -> None:
    """A quote the article lacks (e.g. a value only a figure states) cannot be
    grounded: no page — the model never supplies one — no position, the
    model's words kept, flagged for a human and never judged."""
    await seed_article_text(db_session, QUOTE_A)
    absent = "a quote absent from the text"
    fake = RecordedLlm(
        fields={"sample_size": {"value": 999, "evidence": _cite(absent, block_ref="p2·b0")}}
    )

    run, _ = await _extract(db_session, fake)

    (row,) = await _evidence(db_session, run.id)
    assert row.page_number is None
    assert row.position == {}
    assert row.attribution_label == "ungroundable"
    assert row.text_content == absent
    assert fake.prompts(entailment.NAME) == []


async def test_grounded_quote_stores_source_slice_and_derived_page(
    db_session: AsyncSession,
) -> None:
    """The model's words differ from the source in case and whitespace and
    cite a page the article does not have: the row stores the exact source
    slice and the anchor's page; the anchor keeps the model's words."""
    await seed_article_text(db_session, "Opening paragraph.", QUOTE_A)
    model_words = "the mean  sample size was 142 participants across all studies."
    fake = RecordedLlm(
        fields={"sample_size": {"value": 142, "evidence": _cite(model_words, block_ref="p4·b1")}}
    )

    run, _ = await _extract(db_session, fake)

    (row,) = await _evidence(db_session, run.id)
    assert row.page_number == 1
    assert row.text_content == QUOTE_A
    assert row.position["anchor"]["quote"] == model_words
    assert row.attribution_label == "entailed"
    # The judge read the source, not the model's words.
    (judge_prompt,) = fake.prompts(entailment.NAME)
    assert QUOTE_A in judge_prompt
    assert model_words not in judge_prompt


async def test_ungroundable_flag_for_ambiguous_quote(db_session: AsyncSession) -> None:
    await seed_article_text(db_session, QUOTE_A)
    fake = RecordedLlm(
        fields={
            "sample_size": {
                "status": "ambiguous",
                "value": 142,
                "evidence": _cite("a quote absent from the text"),
            }
        }
    )

    run, _ = await _extract(db_session, fake)

    (row,) = await _evidence(db_session, run.id)
    assert row.attribution_label == "ungroundable"
    assert (row.page_number, row.position) == (None, {})


async def test_evidence_grounding_log_carries_retries(db_session: AsyncSession) -> None:
    await seed_article_text(db_session, QUOTE_A)
    run = await run_in_extract(db_session)
    extracted = {
        "sample_size": {
            "value": 142,
            "confidence": 0.9,
            "reasoning": None,
            "status": "found",
            "evidence": _cite(QUOTE_A, "a quote absent from the text"),
        }
    }
    with capture_logs() as entries:
        p = extraction(db_session, RecordedLlm())._p
        await p.assemble_prompt_text(SEED.primary_article, settings.LLM_DEFAULT_MODEL)
        await build_candidates(
            p,
            run=run,
            entity_type_id=SEED.primary_entity_type,
            extracted=extracted,
            verdicts=None,
            grounding_retries=2,
        )

    logs = [e for e in entries if e["event"] == "evidence_grounding"]
    assert len(logs) == 1
    assert (logs[0]["grounded"], logs[0]["ungrounded"], logs[0]["retried"]) == (1, 1, 2)
    assert logs[0]["entity_type_id"] == str(SEED.primary_entity_type)


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


async def test_grounded_evidence_stamps_content_version(db_session: AsyncSession) -> None:
    """A grounded row records the file version it anchored against; an
    unanchored row records neither the file nor a version."""
    file_id = await seed_article_text(db_session, QUOTE_A)
    await db_session.execute(
        text("UPDATE public.article_files SET content_version = 7 WHERE id = :id"),
        {"id": file_id},
    )
    fake = RecordedLlm(
        fields={
            "sample_size": {
                "value": 142,
                "evidence": _cite(QUOTE_A, "a quote absent from the text"),
            }
        }
    )

    run, _ = await _extract(db_session, fake)

    grounded, unanchored = await _evidence(db_session, run.id)
    assert (grounded.article_file_id, grounded.content_version) == (file_id, 7)
    assert grounded.position != {}
    assert unanchored.position == {}
    assert (unanchored.article_file_id, unanchored.content_version) == (None, None)


# --------------------------------------------------------------------------
# The write mapping (ADR-0016 Amendment 2026-10): what the model meant
# --------------------------------------------------------------------------

PROBAST_AI_ANSWERS = ["Y", "PY", "PN", "N", "NI"]


async def _shape_field(db: AsyncSession, **columns: Any) -> None:
    """Reshape the seeded ``sample_size`` field (type, options, flags)."""
    if "allowed_values" in columns:
        columns["allowed_values"] = json.dumps(columns["allowed_values"])
    assignments = ", ".join(
        f"{name} = CAST(:{name} AS jsonb)" if name == "allowed_values" else f"{name} = :{name}"
        for name in columns
    )
    await db.execute(
        text(f"UPDATE public.extraction_fields SET {assignments} WHERE id = :id"),
        {"id": SEED.primary_field, **columns},
    )
    db.expire_all()


def _answer(**overrides: Any) -> dict[str, Any]:
    return {
        "value": None,
        "confidence": 0.0,
        "reasoning": "why",
        "status": "not_found",
        "evidence": [],
        **overrides,
    }


async def _build(
    db: AsyncSession, answer: dict[str, Any], fake: RecordedLlm | None = None
) -> ProposalCandidate:
    """``build_candidates`` on a hand-built model answer for ``sample_size``."""
    run = await run_in_extract(db)
    p = extraction(db, fake or RecordedLlm())._p
    await p.assemble_prompt_text(SEED.primary_article, settings.LLM_DEFAULT_MODEL)
    _, (candidate,), _usage = await build_candidates(
        p,
        run=run,
        entity_type_id=SEED.primary_entity_type,
        extracted={"sample_size": answer},
        verdicts=None,
    )
    return candidate


async def test_probast_ai_ni_answer_is_kept_as_value(db_session: AsyncSession) -> None:
    """PROBAST+AI encodes "no information" as the in-domain answer NI with the
    marker switched off: the answer is the value, whatever the status."""
    await seed_article_text(db_session, QUOTE_A)
    await _shape_field(
        db_session,
        field_type="select",
        allowed_values=PROBAST_AI_ANSWERS,
        allows_no_information=False,
    )

    candidate = await _build(db_session, _answer(value="NI", reasoning="Not reported."))

    assert candidate.proposed_value == {"value": "NI"}
    assert candidate.rationale == "Not reported."


@pytest.mark.parametrize("code", ["Unclear", "unclear"], ids=["title-case", "lowercase"])
async def test_unclear_scale_not_found_stores_unclear_code(
    db_session: AsyncSession, code: str
) -> None:
    """An uncertainty scale answers its own Unclear code, never a marker — even
    from a model or replay that ignored the narrowed status Literal."""
    await seed_article_text(db_session, QUOTE_A)
    await _shape_field(db_session, field_type="select", allowed_values=["Low", "High", code])

    candidate = await _build(db_session, _answer())

    assert candidate.proposed_value == {"value": code}


async def test_conditional_criterion_stores_not_applicable_marker(
    db_session: AsyncSession,
) -> None:
    """An offered ``not_applicable`` lands as its typed marker; the quote that
    shows why is kept as evidence and never sent to the entailment judge."""
    await seed_article_text(db_session, QUOTE_A)
    await _shape_field(db_session, allows_not_applicable=True)
    fake = RecordedLlm()

    candidate = await _build(
        db_session,
        _answer(
            status="found", confidence=0.8, absent_reason="not_applicable", evidence=_cite(QUOTE_A)
        ),
        fake,
    )

    assert candidate.proposed_value == {"value": None, "absent_reason": "not_applicable"}
    assert (candidate.confidence_score, candidate.rationale) == (None, "why")
    (row,) = candidate.evidence
    assert row.text_content == QUOTE_A
    assert row.page_number == 1
    assert row.attribution_label is None
    assert fake.prompts(entailment.NAME) == []


@pytest.mark.parametrize(
    ("allows_no_information", "expected"),
    [
        (True, {"value": None, "absent_reason": "no_information"}),
        (False, {"value": None}),
    ],
    ids=["marker-allowed", "marker-off"],
)
async def test_unoffered_code_is_not_written(
    db_session: AsyncSession, allows_no_information: bool, expected: dict[str, Any]
) -> None:
    await seed_article_text(db_session, QUOTE_A)
    await _shape_field(
        db_session, allows_not_applicable=False, allows_no_information=allows_no_information
    )

    with capture_logs() as entries:
        candidate = await _build(db_session, _answer(absent_reason="not_applicable"))

    assert candidate.proposed_value == expected
    (log,) = [e for e in entries if e["event"] == "absent_reason_not_offered"]
    assert (log["field"], log["code"]) == ("sample_size", "not_applicable")


@pytest.mark.parametrize(
    ("allows_no_information", "expected"),
    [
        (True, {"value": None, "absent_reason": "no_information"}),
        (False, {"value": None}),
    ],
    ids=["marker-allowed", "marker-off"],
)
async def test_numeric_not_found_gives_no_information_marker(
    db_session: AsyncSession, allows_no_information: bool, expected: dict[str, Any]
) -> None:
    await seed_article_text(db_session, QUOTE_A)
    await _shape_field(db_session, allows_no_information=allows_no_information)

    candidate = await _build(db_session, _answer(evidence=_cite(QUOTE_A)))

    assert candidate.proposed_value == expected
    assert candidate.confidence_score is None
    assert candidate.evidence == []


@pytest.mark.parametrize(
    ("value", "allows_no_information", "expected"),
    [
        (["a", "c"], True, {"value": ["a", "c"]}),
        (["a", "zzz"], True, {"value": None, "absent_reason": "no_information"}),
        ([], True, {"value": None, "absent_reason": "no_information"}),
        (["a", "zzz"], False, {"value": None}),
        ([], False, {"value": None}),
    ],
    ids=["in-domain", "out-of-domain-marker", "empty-marker", "out-of-domain-off", "empty-off"],
)
async def test_multiselect_list_value_rule(
    db_session: AsyncSession,
    value: list[str],
    allows_no_information: bool,
    expected: dict[str, Any],
) -> None:
    await seed_article_text(db_session, QUOTE_A)
    await _shape_field(
        db_session,
        field_type="multiselect",
        allowed_values=["a", "b", "c"],
        allows_no_information=allows_no_information,
    )

    candidate = await _build(db_session, _answer(value=value))

    assert candidate.proposed_value == expected
