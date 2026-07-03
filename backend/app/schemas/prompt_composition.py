"""Typed spine for the per-section prompt composition provenance.

The single source of truth for the ``prompt_composition`` snapshot the
extraction service writes into ``extraction_runs.results["provenance"]
["sections"][entity_type_id]``. Built once at the write site and stored via
``.model_dump()``; the read service and frontend consume the resulting dict.
Keeping the shape in one Pydantic model stops a key typo at the write site
from shipping silently (the payload is otherwise an untyped JSONB dict).
"""

from __future__ import annotations

from pydantic import BaseModel


class PromptCompositionArticleRef(BaseModel):
    """Where the article text in the prompt came from, and whether the token
    budget dropped any of it (the marker stands in for the full text)."""

    file_id: str | None = None
    file_name: str | None = None
    truncated: bool = False
    est_tokens: int | None = None


class PromptComposition(BaseModel):
    """How one section's LLM prompt was assembled — the recipe the review UI
    renders instead of dumping raw prompt text. ``section_instruction`` carries
    the rendered user template with the article replaced by a marker."""

    section_name: str
    system_prompt: str
    section_instruction: str
    article_ref: PromptCompositionArticleRef
    fields_requested: list[str]
    llm_calls: int
