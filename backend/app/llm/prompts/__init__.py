"""Versioned prompt templates.

Each module exposes ``NAME``, ``VERSION`` (a content hash — editing the
template bumps it automatically) and a ``render(...)`` function. The
extractor stamps ``prompt.name`` / ``prompt.version`` on every span, so
every production trace resolves to an exact git version of the prompt.
"""

import hashlib


def content_version(*parts: str) -> str:
    digest = hashlib.sha256("\n---\n".join(parts).encode("utf-8")).hexdigest()
    return digest[:12]


def render_review_context_section(review_context: str | None) -> str:
    """Project-level review question (from the run-pinned review context).

    Emitted BEFORE the template instruction in every prompt: the review
    question frames the task, and the template instruction is the more
    specific guidance, so it belongs closest to it.
    """
    if not review_context:
        return ""
    return f"Review question and scope:\n{review_context}\n\n"


def render_general_instructions_section(general_instructions: str | None) -> str:
    """Template-level general instruction (from the run-pinned snapshot)."""
    if not general_instructions:
        return ""
    return f"General instructions for this review:\n{general_instructions}\n\n"


def render_memory_section(memory_context: list[dict[str, str]] | None) -> str:
    """Summarized history of previously extracted sections (batch mode)."""
    if not memory_context:
        return ""
    memory_lines = [
        f"{idx + 1}. {mem['entity_type_name']}: {mem['summary']}"
        for idx, mem in enumerate(memory_context)
    ]
    joined = "\n".join(memory_lines)
    return f"""
--- CONTEXT FROM PREVIOUSLY EXTRACTED SECTIONS ---
{joined}

Use this context to maintain consistency and avoid contradictions with previously extracted data.
"""
