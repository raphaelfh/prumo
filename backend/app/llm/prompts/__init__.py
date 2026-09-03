"""Versioned prompt templates.

Each module exposes ``NAME``, ``VERSION`` (a content hash — editing the
template bumps it automatically) and a ``render(...)`` function. The
extractor stamps ``prompt.name`` / ``prompt.version`` on every span, so
every production trace resolves to an exact git version of the prompt.
"""

import hashlib
from dataclasses import dataclass


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


@dataclass(frozen=True)
class EntryScope:
    """Which entry of a repeating group ONE extraction call is about.

    A ``cardinality='many'`` section is extracted once per entry, and the
    prompt has to say which one or every instance receives the same values.
    ``key_label``/``key_value`` are the group's declared key
    (``is_entity_key``) as identified for this entry; ``entry_label`` is the
    group's noun; ``parent_label`` names the enclosing entry of a nested
    group (the model a validation block belongs to), ``None`` at top level.
    """

    entry_label: str
    key_label: str
    key_value: str
    parent_label: str | None = None


def render_entry_scope_section(scope: EntryScope | None) -> str:
    """The per-entry scoping block; empty when the section does not repeat."""
    if scope is None:
        return ""
    lines = [f'- {scope.key_label}: "{scope.key_value}"']
    if scope.parent_label:
        lines.append(f'- Belongs to: "{scope.parent_label}"')
    listed = "\n".join(lines)
    return (
        f"\nThis section repeats once per {scope.entry_label}. Extract ONLY the values "
        f"that describe the {scope.entry_label} identified below; ignore values that "
        f"describe a different {scope.entry_label}.\n{listed}\n"
    )
