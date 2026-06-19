"""Schemas for the per-kind manager-review-visibility setting."""

from typing import Literal

from pydantic import BaseModel

# Mirror TemplateKind values WITHOUT importing app.models into the schema/endpoint
# layer (layering rule). These two literals are the JSONB keys.
ManagerReviewKind = Literal["extraction", "quality_assessment"]


class ManagerReviewVisibilityPayload(BaseModel):
    kind: ManagerReviewKind
    managers_see_reviewers: bool


class ManagerReviewVisibilityRead(BaseModel):
    extraction: bool = False
    quality_assessment: bool = False
