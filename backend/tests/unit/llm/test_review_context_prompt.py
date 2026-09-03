"""The review-context block in the three prompts.

The goldens below are LITERALS captured from the tree BEFORE the block existed
(``git show HEAD~:...`` -> render -> paste). Re-rendering them at test time
would make the no-regression assertion self-fulfilling: post-change ``render()``
with no context returns "" from the new renderer and would equal itself no
matter what leaked in.
"""

from __future__ import annotations

import importlib

import pytest

from app.llm import prompts
from app.llm.prompts import (
    entry_identification,
    quality_assessment,
    render_review_context_section,
    section_extraction,
)

# --- goldens: the exact prompts this repo shipped before the block existed ---

GOLDEN_SECTION_EXTRACTION = (
    "Extract the following information from the scientific article:\n"
    "\n"
    "Section: N\n"
    "Description: D\n"
    "\n"
    "Article text:\n"
    "A\n"
    "\n"
    "For EACH field in the response schema, return an object with:\n"
    '- "value": the extracted value (matching the field type and allowed values if specified);'
    " null when the article does not contain it\n"
    '- "confidence": a number between 0 and 1 indicating your confidence in the extraction'
    " (1 = very confident, 0 = not found/uncertain)\n"
    '- "reasoning": a brief explanation (1-2 sentences) of why you extracted this value or'
    " why you're uncertain\n"
    '- "evidence": an object with "text" (short quoted passage from the article supporting'
    ' the value) and "page_number" (integer, if known), or null\n'
)

GOLDEN_QUALITY_ASSESSMENT = (
    "Assess the following domain of F for the study below.\n"
    "\n"
    "Domain: N\n"
    "Description: D\n"
    "\n"
    "Article text:\n"
    "A\n"
    "\n"
    "For EACH field in the response schema, return an object with:\n"
    '- "value": one of the field\'s allowed values\n'
    '- "confidence": number between 0 and 1 (1 = very confident in the judgment, 0 = no'
    " signal in the article)\n"
    '- "reasoning": 1-2 sentences justifying the judgment against the F criterion\n'
    '- "evidence": an object with "text" (short quoted passage supporting the judgment)'
    ' and "page_number" (integer, if known), or null\n'
)

#: ``entry_identification`` post-dates the review-context block, so its golden
#: is the prompt as it first shipped (captured from ``render`` with no
#: context on 2026-09-03) rather than a pre-block literal — the assertion
#: still proves the renderer is inert on empty input.
GOLDEN_ENTRY_IDENTIFICATION = 'Analyze the following scientific article and identify every model it describes for the section "prediction models".\n\nFor each model, return its Model name exactly as the article states it — this is what tells one model apart from another.\n\nArticle text:\nA\n'

#: Content hashes of the three prompts before the block existed. The block
#: changes production prompts, so §IX requires new runs to record a new
#: version — these must all move. ``entry_identification`` replaced
#: ``model_identification`` (the hash is that module's last version): a
#: parameterized prompt is a different prompt, and new runs must say so.
PRE_CHANGE_VERSIONS = {
    "section_extraction": "d1d4d2483a3b",
    "quality_assessment": "6f04461c6f23",
    "entry_identification": "046fd17ca366",
}


def _render_section(**kwargs: object) -> str:
    return section_extraction.render(
        entity_name="N", entity_description="D", article_text="A", **kwargs
    )


def _render_qa(**kwargs: object) -> str:
    return quality_assessment.render(
        entity_name="N", entity_description="D", article_text="A", framework="F", **kwargs
    )


def _render_entry_id(**kwargs: object) -> str:
    return entry_identification.render(
        group_label="prediction models",
        entry_label="model",
        key_label="Model name",
        article_text="A",
        **kwargs,  # type: ignore[arg-type]
    )


def test_the_renderer_is_inert_on_nothing() -> None:
    assert render_review_context_section(None) == ""
    assert render_review_context_section("") == ""


def test_an_empty_context_reproduces_the_pre_change_prompt_byte_for_byte() -> None:
    """The no-regression proof for shipping the block ON by default.

    Note what this does and does not prove: the RENDERER is inert on empty
    input. It says nothing about the corpus — that claim is
    ``test_project_ai_context``'s parametrized "every untouched shape renders
    None", and the two together are what make the default safe.
    """
    assert _render_section() == GOLDEN_SECTION_EXTRACTION
    assert _render_qa() == GOLDEN_QUALITY_ASSESSMENT
    assert _render_entry_id() == GOLDEN_ENTRY_IDENTIFICATION


def test_the_review_question_frames_the_task_before_the_template_instruction() -> None:
    """Order is the contract: the review question frames the task, the
    template instruction is the more specific guidance and stays closest to it.
    """
    body = "- Population: Adults"
    for render in (_render_section, _render_qa, _render_entry_id):
        prompt = render(review_context=body, general_instructions="Judge conservatively.")
        assert prompt.startswith(
            "Review question and scope:\n"
            "- Population: Adults\n"
            "\n"
            "General instructions for this review:\n"
            "Judge conservatively.\n"
            "\n"
        ), render.__name__


def test_the_block_stands_alone_without_a_template_instruction() -> None:
    prompt = _render_section(review_context="- Population: Adults")
    assert prompt.startswith("Review question and scope:\n- Population: Adults\n\n")
    assert "General instructions" not in prompt


@pytest.mark.parametrize(
    "module",
    [section_extraction, quality_assessment, entry_identification],
    ids=lambda m: m.NAME,
)
def test_version_moved_from_the_pre_change_hash(module) -> None:
    assert PRE_CHANGE_VERSIONS[module.NAME] != module.VERSION


@pytest.mark.parametrize(
    "module",
    [section_extraction, quality_assessment, entry_identification],
    ids=lambda m: m.NAME,
)
def test_the_canary_actually_hashes_the_shared_renderer(module, monkeypatch) -> None:
    """Mutating the renderer must move VERSION.

    Asserting ``VERSION != "<old hash>"`` would pass trivially forever and
    cannot tell "the template gained a placeholder" from "the canary argument
    was added" — and the canary is the thing under test. Only a mutation
    proves it: editing ``render_review_context_section`` changes production
    prompts, so §IX requires it to bump the version too.
    """
    before = module.VERSION
    monkeypatch.setattr(prompts, "render_review_context_section", lambda _body: "MUTATED")
    try:
        importlib.reload(module)
        assert before != module.VERSION
    finally:
        monkeypatch.undo()
        importlib.reload(module)
    assert before == module.VERSION


@pytest.mark.parametrize(
    "module",
    [section_extraction, quality_assessment],
    ids=lambda m: m.NAME,
)
def test_the_entry_scope_canary_is_live_too(module, monkeypatch) -> None:
    """Same proof for the entry-scope renderer: a repeating group's per-entry
    prompt is production output, so editing its wording must move VERSION."""
    before = module.VERSION
    monkeypatch.setattr(prompts, "render_entry_scope_section", lambda _scope: "MUTATED")
    try:
        importlib.reload(module)
        assert before != module.VERSION
    finally:
        monkeypatch.undo()
        importlib.reload(module)
    assert before == module.VERSION
