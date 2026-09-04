"""Prompt + typed output for identifying the entries of a repeating group.

Every ``cardinality='many'`` section is an entry group — the model
container, a top-level list of predictors, a per-model table of validation
blocks. This prompt asks which entries the article describes for ONE such
group, and it is parameterized by the group as the run is pinned to it: the
section label, its entry noun (``entry_label``), the field that identifies
an entry (``is_entity_key``) and the section's description as the
instruction. A nested group is also scoped to the entry it hangs under —
the validation table of ONE model — or the prompt would list every
validation in the article under each model. The contract stays
intentionally narrow: the LLM returns the key value of each entry.
Everything richer is captured afterwards by section extraction, once per
entry.
"""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, ConfigDict, Field

from app.llm.prompts import (
    content_version,
    render_general_instructions_section,
    render_review_context_section,
)

NAME = "entry_identification"

_SYSTEM_TEMPLATE = (
    "You are an expert at reading scientific articles and telling apart the "
    "distinct {entry_label} entries they describe."
)


class IdentifiedEntry(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(
        description=(
            "The value of the entry's key field, exactly as the article states it — "
            "the name that tells this entry apart from the others (or one of the "
            "allowed values when the key is a choice)."
        )
    )


class EntryIdentificationOutput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    entries: list[IdentifiedEntry] = Field(
        description="Every distinct entry the article describes for this section; empty when none."
    )


_USER_TEMPLATE = """{review_context_section}{general_instructions_section}Analyze the following scientific article and identify every {entry_label} it describes for the section "{group_label}".{parent_scope_section}{instruction_section}

For each {entry_label}, return its {key_label} exactly as the article states it — this is what tells one {entry_label} apart from another.{allowed_values_section}
{existing_section}
Article text:
{article_text}
"""

# Re-run grounding. Without this block the model is free to name the same
# entity differently on a second pass — "XGBoost" then "Gradient Boosting" —
# and a free-text identity key drifts with it. Matching then misses and the
# duplicate it exists to prevent is recreated one layer down. No string
# metric could link that pair; the model that produced both names can, once
# it sees what already exists.
_EXISTING_TEMPLATE = """
Some {entry_label} entries in this article have already been identified:
{existing_list}

If one of the entries you find is any of those, return its EXACT existing {key_label}, character for character, instead of a new wording for it. Only give a new value to an entry that is genuinely not in that list.
"""

_INSTRUCTION_TEMPLATE = "\nSection instructions: {instruction}"

# Nested-group scope. Extraction per entry is already scoped to its parent
# (the entry-scope block); identification was not, so a validation table
# under model A listed every validation type the article reports — model
# B's included — and each got an instance under A.
_PARENT_SCOPE_TEMPLATE = (
    ' Only the {entry_label} entries that belong to "{parent_label}" count here; '
    "leave out those the article reports for anything else."
)

_ALLOWED_VALUES_TEMPLATE = " The {key_label} must be one of: {allowed_values}."


def system_prompt(entry_label: str) -> str:
    return _SYSTEM_TEMPLATE.format(entry_label=entry_label)


def _render_existing_section(
    entry_label: str, key_label: str, existing_keys: list[str] | None
) -> str:
    """The already-identified block, or nothing on a first run."""
    if not existing_keys:
        return ""
    listed = "\n".join(f"- {name}" for name in existing_keys)
    return _EXISTING_TEMPLATE.format(
        entry_label=entry_label, key_label=key_label, existing_list=listed
    )


def _render_instruction_section(instruction: str | None) -> str:
    text = (instruction or "").strip()
    return _INSTRUCTION_TEMPLATE.format(instruction=text) if text else ""


def _render_parent_scope_section(entry_label: str, parent_label: str | None) -> str:
    """The parent clause of a nested group; nothing at top level."""
    if not parent_label:
        return ""
    return _PARENT_SCOPE_TEMPLATE.format(entry_label=entry_label, parent_label=parent_label)


def _allowed_value_names(allowed_values: Any) -> list[str]:
    """The choices a ``select`` key accepts, in the shape the field stores
    them: a list of strings, or a list of ``{value, label}`` objects (the
    VALUE is what an extracted key must equal)."""
    if not isinstance(allowed_values, list):
        return []
    names: list[str] = []
    for item in allowed_values:
        if isinstance(item, str):
            names.append(item)
        elif isinstance(item, dict):
            value = item.get("value") or item.get("label")
            if isinstance(value, str):
                names.append(value)
    return names


def _render_allowed_values_section(key_label: str, allowed_values: Any) -> str:
    names = _allowed_value_names(allowed_values)
    if not names:
        return ""
    return _ALLOWED_VALUES_TEMPLATE.format(key_label=key_label, allowed_values=", ".join(names))


# Canary: hashes the shared block renderers' literal prefixes (see
# section_extraction.py) so helper edits bump VERSION.
VERSION = content_version(
    _SYSTEM_TEMPLATE,
    _USER_TEMPLATE,
    _EXISTING_TEMPLATE,
    _INSTRUCTION_TEMPLATE,
    _PARENT_SCOPE_TEMPLATE,
    _ALLOWED_VALUES_TEMPLATE,
    render_review_context_section("x"),
    render_general_instructions_section("x"),
)


def render(
    *,
    group_label: str,
    entry_label: str,
    key_label: str,
    article_text: str,
    instruction: str | None = None,
    allowed_values: Any = None,
    general_instructions: str | None = None,
    review_context: str | None = None,
    existing_keys: list[str] | None = None,
    parent_label: str | None = None,
) -> str:
    """``group_label`` / ``entry_label`` / ``key_label`` / ``instruction`` /
    ``allowed_values`` come from the PINNED group and its key field;
    ``existing_keys`` are the identities already extracted at this
    coordinate — the entries a re-run must recognize rather than rename;
    ``parent_label`` is the enclosing entry of a nested group (the model a
    validation table belongs to), ``None`` at top level."""
    return _USER_TEMPLATE.format(
        group_label=group_label,
        entry_label=entry_label,
        key_label=key_label,
        article_text=article_text,
        parent_scope_section=_render_parent_scope_section(entry_label, parent_label),
        instruction_section=_render_instruction_section(instruction),
        allowed_values_section=_render_allowed_values_section(key_label, allowed_values),
        general_instructions_section=render_general_instructions_section(general_instructions),
        review_context_section=render_review_context_section(review_context),
        existing_section=_render_existing_section(entry_label, key_label, existing_keys),
    )
