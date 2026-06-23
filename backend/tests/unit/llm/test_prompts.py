"""Prompt templates: rendering, truncation, and stable content versions."""

from app.llm.prompts import (
    content_version,
    model_identification,
    quality_assessment,
    render_memory_section,
    section_extraction,
)


def test_content_version_is_stable_and_short():
    v1 = content_version("a", "b")
    assert v1 == content_version("a", "b")
    assert v1 != content_version("a", "c")
    assert len(v1) == 12


def test_all_prompt_modules_declare_name_and_version():
    for module in (section_extraction, quality_assessment, model_identification):
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


def test_model_identification_render_and_output_model():
    prompt = model_identification.render(
        container_label="prediction models", article_text="§" * 20_000
    )
    assert "prediction models" in prompt
    assert prompt.count("§") == 20_000  # no truncation
    output = model_identification.ModelIdentificationOutput.model_validate(
        {"models": [{"name": "Cox model"}]}
    )
    assert output.models[0].name == "Cox model"
