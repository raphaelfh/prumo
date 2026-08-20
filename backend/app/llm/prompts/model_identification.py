"""Prompt + typed output for prediction-model identification.

The contract stays intentionally narrow: the LLM returns a list of model
names. Anything richer is captured later by section extraction against
the container's children."""

from pydantic import BaseModel, ConfigDict, Field

from app.llm.prompts import content_version, render_general_instructions_section

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


_USER_TEMPLATE = """{general_instructions_section}Analyze the following scientific article and identify all {container_label} described in it. For each one, return a clear and descriptive name as it appears in the article.

Article text:
{article_text}
"""

# Canary: hashes the shared block renderer's literal prefix (see
# section_extraction.py) so helper edits bump VERSION.
VERSION = content_version(SYSTEM_PROMPT, _USER_TEMPLATE, render_general_instructions_section("x"))


def render(
    *,
    container_label: str,
    article_text: str,
    general_instructions: str | None = None,
) -> str:
    return _USER_TEMPLATE.format(
        container_label=container_label,
        article_text=article_text,
        general_instructions_section=render_general_instructions_section(general_instructions),
    )
