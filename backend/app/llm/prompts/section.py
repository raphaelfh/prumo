"""The section prompt pair a field-extraction call sends, chosen by run kind.

One renderer for both kinds: ``quality_assessment`` runs ask an
assessment-style prompt naming the instrument (``framework``), every other
run the "extract from a scientific article" prompt. The user prompt is
rendered twice — once with the article, once with the article replaced by a
marker — so the persisted ``section_instruction`` is byte-faithful to what
was sent without duplicating the (multi-thousand-token) article per section.
"""

from __future__ import annotations

from dataclasses import dataclass

from app.llm.prompts import Scope, quality_assessment, section_extraction


@dataclass(frozen=True)
class SectionPrompt:
    """What one field-extraction call sends, and how it is recorded."""

    name: str
    version: str
    system_prompt: str
    user_prompt: str
    #: ``user_prompt`` with the article replaced by the marker.
    section_instruction: str


def render_section_prompt(
    *,
    kind: str,
    framework: str | None,
    entity_name: str,
    entity_description: str,
    article_text: str,
    article_marker: str,
    memory_context: list[dict[str, str]] | None,
    general_instructions: str | None,
    review_context: str | None,
    entry_scope: Scope | None,
) -> SectionPrompt:
    """The prompt for ``kind``; ``entry_scope`` names the entry, or the
    enclosing entries, the call is about (``None`` for a root singleton)."""
    if kind == "quality_assessment":
        user_prompt, section_instruction = (
            quality_assessment.render(
                entity_name=entity_name,
                entity_description=entity_description,
                article_text=text,
                framework=framework,
                memory_context=memory_context,
                general_instructions=general_instructions,
                review_context=review_context,
                entry_scope=entry_scope,
            )
            for text in (article_text, article_marker)
        )
        return SectionPrompt(
            quality_assessment.NAME,
            quality_assessment.VERSION,
            quality_assessment.system_prompt(framework),
            user_prompt,
            section_instruction,
        )
    user_prompt, section_instruction = (
        section_extraction.render(
            entity_name=entity_name,
            entity_description=entity_description,
            article_text=text,
            memory_context=memory_context,
            general_instructions=general_instructions,
            review_context=review_context,
            entry_scope=entry_scope,
        )
        for text in (article_text, article_marker)
    )
    return SectionPrompt(
        section_extraction.NAME,
        section_extraction.VERSION,
        section_extraction.SYSTEM_PROMPT,
        user_prompt,
        section_instruction,
    )
