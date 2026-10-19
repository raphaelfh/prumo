"""A questionnaire lint finding: a problem that blocks or weakens AI extraction."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

LintCode = Literal[
    "SELECT_WITHOUT_OPTIONS",
    "REPEATING_SECTION_WITHOUT_ENTITY_KEY",
    "REPEATING_SECTION_WITHOUT_ENTRY_LABEL",
    "EMPTY_SECTION",
    "QUESTION_WITHOUT_AI_GUIDANCE",
    "UNRESOLVED_CUSTOMIZE_SLOT",
]
LintStatus = Literal["block", "warn"]


class LintFinding(BaseModel):
    """One rule that fired, aggregated over every node it fired on."""

    code: LintCode
    status: LintStatus
    section_label: str | None = None
    question_labels: list[str] = Field(default_factory=list, max_length=5)
    count: int
