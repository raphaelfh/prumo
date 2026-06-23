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
