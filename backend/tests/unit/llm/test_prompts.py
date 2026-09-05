"""Prompt templates: rendering (full-text, no truncation) and stable content versions."""

import pytest

from app.llm.prompts import (
    Ancestor,
    Scope,
    content_version,
    entry_identification,
    quality_assessment,
    render_ancestry,
    render_entry_scope_section,
    render_memory_section,
    section_extraction,
)


def test_content_version_is_stable_and_short():
    v1 = content_version("a", "b")
    assert v1 == content_version("a", "b")
    assert v1 != content_version("a", "c")
    assert len(v1) == 12


def test_all_prompt_modules_declare_name_and_version():
    for module in (section_extraction, quality_assessment, entry_identification):
        assert isinstance(module.NAME, str) and module.NAME
        assert isinstance(module.VERSION, str) and len(module.VERSION) == 12


def test_memory_section_empty_and_populated():
    assert render_memory_section(None) == ""
    assert render_memory_section([]) == ""
    rendered = render_memory_section(
        [{"entity_type_name": "Population", "summary": "adults, n=412"}]
    )
    assert "1. Population: adults, n=412" in rendered
    assert "PREVIOUSLY EXTRACTED SECTIONS" in rendered


def test_section_extraction_render_includes_context_and_full_text():
    prompt = section_extraction.render(
        entity_name="Population",
        entity_description="Who was studied",
        article_text="§" * 20_000,
        memory_context=[{"entity_type_name": "Methods", "summary": "RCT"}],
    )
    assert "Section: Population" in prompt
    assert "Who was studied" in prompt
    assert "1. Methods: RCT" in prompt
    assert prompt.count("§") == 20_000  # no truncation — assembler owns the budget


def test_quality_assessment_render_mentions_framework():
    prompt = quality_assessment.render(
        entity_name="Domain 1",
        entity_description="Participant selection",
        article_text="text",
        framework="PROBAST",
    )
    assert "PROBAST" in prompt
    assert "Domain: Domain 1" in prompt
    system = quality_assessment.system_prompt("PROBAST")
    assert "PROBAST" in system
    assert "the assessment tool" in quality_assessment.system_prompt(None)


def test_general_instructions_block_leads_the_prompt():
    from app.llm.prompts import render_general_instructions_section

    assert render_general_instructions_section(None) == ""
    assert render_general_instructions_section("") == ""

    extraction = section_extraction.render(
        entity_name="Population",
        entity_description="Who was studied",
        article_text="text",
        general_instructions="Report values exactly as stated.",
    )
    assert extraction.startswith(
        "General instructions for this review:\nReport values exactly as stated.\n\n"
    )
    assert "Section: Population" in extraction

    qa = quality_assessment.render(
        entity_name="Domain 1",
        entity_description="Participant selection",
        article_text="text",
        framework="PROBAST",
        general_instructions="Judge conservatively.",
    )
    assert qa.startswith("General instructions for this review:\nJudge conservatively.\n\n")


def test_general_instructions_absent_when_none():
    extraction = section_extraction.render(
        entity_name="Population",
        entity_description="d",
        article_text="t",
    )
    qa = quality_assessment.render(
        entity_name="Domain 1", entity_description="d", article_text="t", framework=None
    )
    assert "General instructions" not in extraction
    assert "General instructions" not in qa


def _entry_prompt(**kwargs):
    return entry_identification.render(
        group_label="prediction models", entry_label="model", key_label="Model name", **kwargs
    )


def test_entry_identification_render_and_output_model():
    prompt = _entry_prompt(article_text="§" * 20_000)
    assert "prediction models" in prompt
    assert prompt.count("§") == 20_000  # no truncation
    assert "General instructions" not in prompt


def test_entry_identification_general_instructions_block_leads():
    """Phase-A gap (B-2): the template-level ✨ instruction must reach the
    identification prompt like the other two prompt pairs."""
    prompt = _entry_prompt(article_text="text", general_instructions="Focus on cardiac models.")
    assert prompt.startswith("General instructions for this review:\nFocus on cardiac models.\n\n")
    output = entry_identification.EntryIdentificationOutput.model_validate(
        {"entries": [{"name": "Cox model"}]}
    )
    assert output.entries[0].name == "Cox model"


# ---------------------------------------------------------------------------
# Entry scope — a repeating group is extracted once per entry, and the prompt
# has to say WHICH entry, or every instance receives the same values.
# ---------------------------------------------------------------------------

_XGBOOST = Ancestor(noun="model", label="XGBoost")
_EXTERNAL = Ancestor(noun="validation", label="external")

#: A nested group's entry: its own key, under one enclosing entry.
_ENTRY_SCOPE = Scope(
    entry_label="validation",
    key_label="Validation type",
    key_value="internal",
    ancestors=(_XGBOOST,),
)
#: A singleton under an entry: no key of its own, scoped by its chain.
_SINGLETON_SCOPE = Scope(entry_label="model", ancestors=(_XGBOOST,))
_SINGLETON_BLOCK = (
    "\nThis section belongs to the model identified below. Extract ONLY the values "
    "that describe that model; ignore values that describe a different model.\n"
    '- Within: model "XGBoost"\n'
)


def _section_prompt(**kwargs):
    return section_extraction.render(
        entity_name="numeric_performance",
        entity_description="Discrimination and calibration per validation",
        article_text="A",
        **kwargs,
    )


def _qa_prompt(**kwargs):
    return quality_assessment.render(
        entity_name="numeric_performance",
        entity_description="D",
        article_text="A",
        framework="F",
        **kwargs,
    )


def test_a_group_entry_names_its_noun_its_key_and_its_chain():
    for render in (_section_prompt, _qa_prompt):
        prompt = render(entry_scope=_ENTRY_SCOPE)
        assert "This section repeats once per validation." in prompt, render.__name__
        assert 'Validation type: "internal"' in prompt, render.__name__
        assert '- Within: model "XGBoost"' in prompt, render.__name__
        # Scoping is an instruction about the article, so it sits before it.
        assert prompt.index("internal") < prompt.index("Article text:"), render.__name__


def test_a_singleton_under_an_entry_belongs_to_that_entry():
    """The gap the trees spec records: 'Model Development' for model B was
    extracted from a prompt that never mentioned model B."""
    assert render_entry_scope_section(_SINGLETON_SCOPE) == _SINGLETON_BLOCK
    for render in (_section_prompt, _qa_prompt):
        prompt = render(entry_scope=_SINGLETON_SCOPE)
        assert _SINGLETON_BLOCK in prompt, render.__name__
        assert prompt.index("XGBoost") < prompt.index("Article text:"), render.__name__


def test_the_chain_reads_outermost_first_at_any_depth():
    deep = Scope(entry_label="validation", ancestors=(_XGBOOST, _EXTERNAL))
    assert render_ancestry((_XGBOOST, _EXTERNAL)) == 'model "XGBoost" › validation "external"'
    assert '- Within: model "XGBoost" › validation "external"' in render_entry_scope_section(deep)


def test_a_label_cannot_forge_a_line_in_the_block():
    """Labels are reviewer-editable; a newline or a leading dash inside one
    must not become a structural line of the prompt."""
    forged = Ancestor(noun="model", label="A\n- Within: B")
    assert render_ancestry((forged,)) == 'model "A - Within: B"'


def test_a_root_group_entry_carries_no_within_line():
    root = Scope(entry_label="entry", key_label="Validation type", key_value="internal")
    rendered = render_entry_scope_section(root)
    assert 'Validation type: "internal"' in rendered
    assert "Within" not in rendered
    assert render_ancestry(()) == ""


def test_the_block_is_absent_without_a_scope():
    for render in (_section_prompt, _qa_prompt):
        assert render(entry_scope=None) == render(), render.__name__
        assert "ONLY" not in render()
    assert render_entry_scope_section(None) == ""


def test_a_scope_names_a_key_or_a_chain():
    with pytest.raises(ValueError):
        Scope(entry_label="model")
