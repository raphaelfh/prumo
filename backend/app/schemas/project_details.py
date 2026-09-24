"""The ONE whitelist of a project's descriptive columns.

``PATCH /api/v1/projects/{id}/details`` writes exactly these 11 columns, and
any other writer of them (the researcher MCP ``update_project_details`` tool)
goes through the same schema and service. PICOT stays on ``PUT /ai-context``;
``settings.managers_see_reviewers`` on ``PUT /manager-review-visibility``.
"""

from __future__ import annotations

from datetime import datetime
from enum import StrEnum
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, ValidationInfo, field_validator, model_validator

ReviewTypeValue = Literal[
    "interventional", "predictive_model", "diagnostic", "prognostic", "qualitative", "other"
]
_NOT_NULL_COLUMNS = ("name", "eligibility_criteria", "study_design", "review_keywords")


class ProjectDetailsFields(BaseModel):
    """A partial set of editable project columns: omitted keys are untouched, an unknown key is refused."""

    model_config = ConfigDict(extra="forbid")

    name: str | None = Field(default=None, min_length=1)
    description: str | None = None
    review_type: ReviewTypeValue | None = None
    review_title: str | None = None
    condition_studied: str | None = None
    review_rationale: str | None = None
    search_strategy: str | None = None
    eligibility_criteria: dict[str, Any] | None = None
    study_design: dict[str, Any] | None = None
    review_keywords: list[str] | None = None
    review_context: str | None = None

    @field_validator(*_NOT_NULL_COLUMNS)
    @classmethod
    def _refuse_null(cls, value: Any, info: ValidationInfo) -> Any:
        # A field validator (not a model one) so errors()[0]["loc"] names the column.
        if value is None:
            raise ValueError(f"{info.field_name} cannot be null")
        return value


class ProjectDetailsUpdate(BaseModel):
    """The changed columns and the values the caller last read for each of them.

    ``expected`` must name every key of ``fields``: the write applies only if
    each of those columns still holds its ``expected`` value, else 409.
    """

    model_config = ConfigDict(extra="forbid")

    fields: ProjectDetailsFields
    expected: ProjectDetailsFields

    @model_validator(mode="after")
    def _expected_covers_fields(self) -> ProjectDetailsUpdate:
        changed = self.fields.model_fields_set
        if not changed:
            raise ValueError("fields must name at least one column")
        missing = changed - self.expected.model_fields_set
        if missing:
            raise ValueError(f"expected is missing: {', '.join(sorted(missing))}")
        return self


class ProjectDetailsValues(BaseModel):
    """The current values of the 11 columns — exactly what ``expected`` must echo."""

    name: str
    description: str | None
    review_type: ReviewTypeValue | None
    review_title: str | None
    condition_studied: str | None
    review_rationale: str | None
    search_strategy: str | None
    eligibility_criteria: dict[str, Any]
    study_design: dict[str, Any]
    review_keywords: list[str]
    review_context: str | None


class ProjectDetailsRead(ProjectDetailsValues):
    """The 11 columns as stored after a write."""

    updated_at: datetime


class ProjectDetailsRefusalCode(StrEnum):
    """Why ``PATCH .../details`` returned 409.

    Slice-local, like ``TemplateDraftLockRefusalCode``: one surface's outcome,
    not part of the cross-cutting ``ApiErrorCode`` vocabulary."""

    STALE_VALUE = "STALE_VALUE"


class ProjectDetailsStaleDetails(BaseModel):
    """The server's current values of the contested keys only."""

    current: dict[str, Any]


class ProjectDetailsRefusalError(BaseModel):
    code: ProjectDetailsRefusalCode
    message: str
    details: ProjectDetailsStaleDetails


class ProjectDetailsRefusalResponse(BaseModel):
    """The 409 body, declared so the generated client types ``details.current``."""

    ok: bool = False
    error: ProjectDetailsRefusalError
    trace_id: str | None = None
