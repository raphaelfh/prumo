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


@dataclass(frozen=True)
class Ancestor:
    """One enclosing entry of the instance a prompt is about: the noun of its
    group and the entry's label, e.g. ``model "XGBoost"``. Chains read
    outermost first (see ``app.services.entry_ancestry``)."""

    noun: str
    label: str


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
class Scope:
    """Which instance ONE extraction call is about, and where it sits.

    A repeating group is extracted once per entry, and the prompt has to say
    which one or every instance receives the same values: ``entry_label`` is
    the group's noun and ``key_label``/``key_value`` its declared key
    (``is_entity_key``) as identified for this entry. A singleton under an
    entry carries no key of its own: ``entry_label`` is then the noun of the
    entry it belongs to, and the pair stays ``None``. ``ancestors`` is the
    chain of enclosing entries, outermost first, empty at the root.
    """

    entry_label: str
    key_label: str | None = None
    key_value: str | None = None
    ancestors: tuple[Ancestor, ...] = ()

    def __post_init__(self) -> None:
        if (self.key_label is None) != (self.key_value is None):
            raise ValueError("a scope's key needs both its label and its value")
        if self.key_value is None and not self.ancestors:
            raise ValueError("a scope names a key, a chain of entries, or both")


def _one_line(text: str) -> str:
    """Reviewer-edited or model-returned text, folded so it cannot forge a
    line of the block it is interpolated into."""
    return " ".join(text.split())


def render_ancestry(ancestors: tuple[Ancestor, ...]) -> str:
    """``model "XGBoost" › validation "external"`` — outermost first."""
    return " › ".join(f'{a.noun} "{_one_line(a.label)}"' for a in ancestors)


def render_entry_scope_section(scope: Scope | None) -> str:
    """The scoping block; empty when the call is about a root singleton."""
    if scope is None:
        return ""
    if scope.key_value is not None:
        header = (
            f"This section repeats once per {scope.entry_label}. Extract ONLY the values "
            f"that describe the {scope.entry_label} identified below; ignore values that "
            f"describe a different {scope.entry_label}."
        )
        lines = [f'- {_one_line(scope.key_label or "")}: "{_one_line(scope.key_value)}"']
    else:
        header = (
            f"This section belongs to the {scope.entry_label} identified below. Extract "
            f"ONLY the values that describe that {scope.entry_label}; ignore values that "
            f"describe a different {scope.entry_label}."
        )
        lines = []
    if scope.ancestors:
        lines.append(f"- Within: {render_ancestry(scope.ancestors)}")
    listed = "\n".join(lines)
    return f"\n{header}\n{listed}\n"
