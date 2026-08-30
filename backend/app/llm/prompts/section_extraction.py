"""Prompt for extracting one template section from an article."""

from app.llm.prompts import (
    content_version,
    render_general_instructions_section,
    render_memory_section,
    render_review_context_section,
)

NAME = "section_extraction"

SYSTEM_PROMPT = (
    "You are an expert at extracting structured data from scientific "
    "articles. For each field, provide the value, your confidence level "
    "(0-1), and brief reasoning. "
    'If the article does not contain the value, set status="not_found", value=null, and evidence=null'
    ' — do NOT invent a value or a quote. Use status="ambiguous" when the value is present but'
    ' unclear or conflicting. Only set status="found" when you can quote a passage that supports'
    " the value."
)

_USER_TEMPLATE = """{review_context_section}{general_instructions_section}Extract the following information from the scientific article:

Section: {entity_name}
Description: {entity_description}
{memory_section}
Article text:
{article_text}

For EACH field in the response schema, return an object with:
- "value": the extracted value (matching the field type and allowed values if specified); null when the article does not contain it
- "confidence": a number between 0 and 1 indicating your confidence in the extraction (1 = very confident, 0 = not found/uncertain)
- "reasoning": a brief explanation (1-2 sentences) of why you extracted this value or why you're uncertain
- "evidence": an object with "text" (short quoted passage from the article supporting the value) and "page_number" (integer, if known), or null
"""

# The canary arguments hash each shared block renderer's literal prefix:
# editing either one changes production prompts, so it must bump VERSION
# too (§IX traceability). tests/unit/llm/test_review_context_prompt.py
# mutates the renderers to prove the canaries are live.
VERSION = content_version(
    SYSTEM_PROMPT,
    _USER_TEMPLATE,
    render_review_context_section("x"),
    render_general_instructions_section("x"),
)


def render(
    *,
    entity_name: str,
    entity_description: str,
    article_text: str,
    memory_context: list[dict[str, str]] | None = None,
    general_instructions: str | None = None,
    review_context: str | None = None,
) -> str:
    return _USER_TEMPLATE.format(
        entity_name=entity_name,
        entity_description=entity_description,
        memory_section=render_memory_section(memory_context),
        article_text=article_text,
        general_instructions_section=render_general_instructions_section(general_instructions),
        review_context_section=render_review_context_section(review_context),
    )
