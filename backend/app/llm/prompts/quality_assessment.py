"""Prompt for grading a study against a bias-assessment framework
(PROBAST / QUADAS-2). Same response shape as section extraction so the
downstream proposal writes are identical."""

from app.llm.prompts import (
    Ancestor,
    Scope,
    content_version,
    render_entry_scope_section,
    render_general_instructions_section,
    render_memory_section,
    render_review_context_section,
)

NAME = "quality_assessment"

_SYSTEM_TEMPLATE = (
    "You are a clinical-evidence methodologist assessing a study using "
    "{framework_label}. For each signaling question or judgment field, "
    "choose strictly from the field's allowed values, justify your "
    "choice with a one or two-sentence reasoning, and include a short "
    "verbatim quote from the article as evidence whenever possible. "
    "Be conservative: when the article gives only a weak or indirect "
    "signal, prefer the allowed value that captures uncertainty "
    "(e.g., 'PN' or 'Unclear') over guessing. "
    'If the article does not contain the value, set status="not_found", value=null, and evidence=null'
    ' — do NOT invent a value or a quote. Use status="ambiguous" when the value is present but'
    ' unclear or conflicting. Only set status="found" when you can quote a passage that supports'
    " the value."
)

_USER_TEMPLATE = """{review_context_section}{general_instructions_section}Assess the following domain of {framework_label} for the study below.

Domain: {entity_name}
Description: {entity_description}
{entry_scope_section}{memory_section}
Article text:
{article_text}

For EACH field in the response schema, return an object with:
- "value": one of the field's allowed values
- "confidence": number between 0 and 1 (1 = very confident in the judgment, 0 = no signal in the article)
- "reasoning": 1-2 sentences justifying the judgment against the {framework_label} criterion
- "evidence": an object with "text" (short quoted passage supporting the judgment) and "page_number" (integer, if known), or null
"""

# Canary: hashes the shared block renderer's literal prefix (see
# section_extraction.py) so helper edits bump VERSION.
VERSION = content_version(
    _SYSTEM_TEMPLATE,
    _USER_TEMPLATE,
    render_review_context_section("x"),
    render_general_instructions_section("x"),
    render_entry_scope_section(Scope("x", "x", "x", (Ancestor("x", "x"),))),
    render_entry_scope_section(Scope("x", ancestors=(Ancestor("x", "x"),))),
)

_DEFAULT_FRAMEWORK_LABEL = "the assessment tool"


def system_prompt(framework: str | None) -> str:
    return _SYSTEM_TEMPLATE.format(framework_label=framework or _DEFAULT_FRAMEWORK_LABEL)


def render(
    *,
    entity_name: str,
    entity_description: str,
    article_text: str,
    framework: str | None,
    memory_context: list[dict[str, str]] | None = None,
    general_instructions: str | None = None,
    review_context: str | None = None,
    entry_scope: Scope | None = None,
) -> str:
    return _USER_TEMPLATE.format(
        framework_label=framework or _DEFAULT_FRAMEWORK_LABEL,
        entity_name=entity_name,
        entity_description=entity_description,
        entry_scope_section=render_entry_scope_section(entry_scope),
        memory_section=render_memory_section(memory_context),
        article_text=article_text,
        general_instructions_section=render_general_instructions_section(general_instructions),
        review_context_section=render_review_context_section(review_context),
    )
