"""Prompt for grading a study against a bias-assessment framework
(PROBAST / QUADAS-2). Same response shape as section extraction so the
downstream proposal writes are identical."""

from app.llm.prompts import MAX_PDF_CHARS, content_version, render_memory_section

NAME = "quality_assessment"

_SYSTEM_TEMPLATE = (
    "You are a clinical-evidence methodologist assessing a study using "
    "{framework_label}. For each signaling question or judgment field, "
    "choose strictly from the field's allowed values, justify your "
    "choice with a one or two-sentence reasoning, and include a short "
    "verbatim quote from the article as evidence whenever possible. "
    "Be conservative: when the article does not provide enough "
    "information to decide, prefer the value that captures uncertainty "
    "(e.g., 'No information' or 'Probably no') over guessing."
)

_USER_TEMPLATE = """Assess the following domain of {framework_label} for the study below.

Domain: {entity_name}
Description: {entity_description}
{memory_section}
Article text:
{article_text}

For EACH field in the response schema, return an object with:
- "value": one of the field's allowed values
- "confidence": number between 0 and 1 (1 = very confident in the judgment, 0 = no signal in the article)
- "reasoning": 1-2 sentences justifying the judgment against the {framework_label} criterion
- "evidence": an object with "text" (short quoted passage supporting the judgment) and "page_number" (integer, if known), or null
"""

VERSION = content_version(_SYSTEM_TEMPLATE, _USER_TEMPLATE)

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
) -> str:
    return _USER_TEMPLATE.format(
        framework_label=framework or _DEFAULT_FRAMEWORK_LABEL,
        entity_name=entity_name,
        entity_description=entity_description,
        memory_section=render_memory_section(memory_context),
        article_text=article_text[:MAX_PDF_CHARS],
    )
