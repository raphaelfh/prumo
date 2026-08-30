"""The two run-constant texts every LLM call in a run is prefixed with.

Both are resolved once per run and are identical for every section: the
version-pinned template instruction, and the project's review question. They
travel as ONE object rather than two parallel parameters so a caller cannot
thread one and forget the other — the failure mode that would show a reviewer
a prompt recipe the model never got.
"""

from __future__ import annotations

from pydantic import BaseModel


class ReviewContextPin(BaseModel):
    """What ``results["provenance"]["review_context"]`` holds.

    A fixed-shape JSONB payload that crosses the API boundary verbatim, so it
    gets a model rather than a bare dict — the reasoning
    ``PromptComposition`` records: a key typo at the write site would
    otherwise ship silently.

    ``text=None`` means "resolved, and the review says nothing" — distinct
    from an ABSENT key, which means no LLM call has run on this run yet.
    ``{"text": None}`` is still a truthy dict, which is what keeps
    ``freeze_provenance_key``'s first-writer-wins guard working.
    """

    text: str | None = None


class RunPromptContext(BaseModel):
    """Run-constant prompt inputs, resolved once and reused by every section."""

    review_context: str | None = None
    general_instructions: str | None = None
