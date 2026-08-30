"""Prompt + typed output for prediction-model identification.

The contract stays intentionally narrow: the LLM returns a list of model
names. Anything richer is captured later by section extraction against
the container's children."""

from pydantic import BaseModel, ConfigDict, Field

from app.llm.prompts import (
    content_version,
    render_general_instructions_section,
    render_review_context_section,
)

NAME = "model_identification"

SYSTEM_PROMPT = "You are an expert at identifying prediction models in scientific articles."


class IdentifiedModel(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(
        description=(
            "A clear, descriptive name for this prediction model as it "
            'appears in the article (e.g. "Multivariable Cox proportional hazards model").'
        )
    )


class ModelIdentificationOutput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    models: list[IdentifiedModel] = Field(
        description="All prediction models described in the article; empty when none are found."
    )


_USER_TEMPLATE = """{review_context_section}{general_instructions_section}Analyze the following scientific article and identify all {container_label} described in it. For each one, return a clear and descriptive name as it appears in the article.
{existing_section}
Article text:
{article_text}
"""

# Re-run grounding. Without this block the model is free to name the same
# entity differently on a second pass — "XGBoost" then "Gradient Boosting" —
# and the identity key, which is free text, drifts with it. Matching then
# misses and the duplicate it exists to prevent is recreated one layer
# down. No string metric could link that pair; the model that produced both
# names can, once it sees what already exists.
_EXISTING_TEMPLATE = """
Some {container_label} in this article have already been identified:
{existing_list}

If one of the entries you find is any of those, return its EXACT existing name, character for character, instead of a new wording for it. Only give a new name to an entry that is genuinely not in that list.
"""


def _render_existing_section(container_label: str, existing_keys: list[str] | None) -> str:
    """The already-identified block, or nothing on a first run."""
    if not existing_keys:
        return ""
    listed = "\n".join(f"- {name}" for name in existing_keys)
    return _EXISTING_TEMPLATE.format(container_label=container_label, existing_list=listed)


# Canary: hashes the shared block renderer's literal prefix (see
# section_extraction.py) so helper edits bump VERSION.
VERSION = content_version(
    SYSTEM_PROMPT,
    _USER_TEMPLATE,
    _EXISTING_TEMPLATE,
    render_review_context_section("x"),
    render_general_instructions_section("x"),
)


def render(
    *,
    container_label: str,
    article_text: str,
    general_instructions: str | None = None,
    review_context: str | None = None,
    existing_keys: list[str] | None = None,
) -> str:
    """``existing_keys`` are the identities already extracted for this
    article — the entries a re-run must recognize rather than rename."""
    return _USER_TEMPLATE.format(
        container_label=container_label,
        article_text=article_text,
        general_instructions_section=render_general_instructions_section(general_instructions),
        review_context_section=render_review_context_section(review_context),
        existing_section=_render_existing_section(container_label, existing_keys),
    )
