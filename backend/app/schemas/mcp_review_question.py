"""``get_review_question`` / ``set_review_question`` output shape."""

from __future__ import annotations

from typing import Literal
from uuid import UUID

from pydantic import BaseModel


class McpReviewSlot(BaseModel):
    """One PICOTS slot with the label the AI sees for it."""

    label: str
    description: str
    inclusion: list[str]
    exclusion: list[str]


class McpEligibility(BaseModel):
    inclusion: list[str]
    exclusion: list[str]
    notes: str


class McpStudyDesign(BaseModel):
    types: list[str]
    notes: str


class McpReviewQuestion(BaseModel):
    """The project's review question: its parts, the exact AI text, and the revision."""

    project_id: UUID
    project_name: str
    revision: int
    review_type: str | None
    picots_enabled: bool
    slots: dict[str, McpReviewSlot]
    eligibility: McpEligibility
    study_design: McpStudyDesign
    preview: str | None
    note: str | None = None
    untrusted_content: Literal[True] = True
    untrusted_fields: list[str] = [
        "project_name",
        "slots{}.description",
        "slots{}.inclusion[]",
        "slots{}.exclusion[]",
        "eligibility.inclusion[]",
        "eligibility.exclusion[]",
        "eligibility.notes",
        "study_design.types[]",
        "study_design.notes",
        "preview",
    ]
