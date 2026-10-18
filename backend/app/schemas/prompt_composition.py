"""Typed spine for the per-section prompt composition provenance.

The single source of truth for the ``prompt_composition`` snapshot the
extraction service writes into ``extraction_runs.results["provenance"]
["sections"][entity_type_id]``. Built once at the write site and stored via
``.model_dump()``; the read service and frontend consume the resulting dict.
Keeping the shape in one Pydantic model stops a key typo at the write site
from shipping silently (the payload is otherwise an untyped JSONB dict).
``PassDetail`` is the same discipline for each ``passes_detail`` entry of a
proposal's generation snapshot.
"""

from __future__ import annotations

from pydantic import BaseModel

from app.llm.pass_kinds import PassKind


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


class PassTokens(BaseModel):
    """One model pass's token usage."""

    prompt: int
    completion: int
    total: int


class PassDetail(BaseModel):
    """One model pass that produced a section's proposals: which prompt (and
    its content-hash version) ran, what it cost, and the provider's response
    ids. ``kind`` is derived from ``prompt_name`` (``app.llm.pass_kinds``)."""

    kind: PassKind
    prompt_name: str
    prompt_version: str
    tokens: PassTokens
    request_ids: list[str]
