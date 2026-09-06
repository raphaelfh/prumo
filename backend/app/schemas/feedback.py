"""Pydantic schemas for the feedback intake endpoint."""

from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field, field_validator

FeedbackType = Literal["bug", "suggestion", "question", "other"]
FeedbackSeverity = Literal["low", "medium", "high", "critical"]
AttachmentKind = Literal["image", "video"]

# A Literal, not a validated str, so the set reaches the frontend through the
# generated OpenAPI contract (frontend/types/api/schema.d.ts) and
# frontend/lib/feedback-media.ts keys its table off it — a disagreement is then
# a type error, not a runtime surprise. The `feedback-media` bucket's
# allowed_mime_types is the one copy that still has to be kept in step by hand.
FeedbackContentType = Literal[
    "image/png",
    "image/jpeg",
    "image/webp",
    "image/gif",
    "video/mp4",
    "video/webm",
    "video/quicktime",
]


class FeedbackContextIn(BaseModel):
    url: str | None = None
    route: str | None = None
    user_agent: str | None = None
    viewport_size: dict | None = None
    project_id: UUID | None = None
    article_id: UUID | None = None
    app_version: str | None = None


class FeedbackAttachmentIn(BaseModel):
    kind: AttachmentKind
    storage_key: str = Field(min_length=1)
    content_type: FeedbackContentType
    size_bytes: int | None = Field(default=None, ge=0)


class FeedbackCreate(BaseModel):
    type: FeedbackType
    severity: FeedbackSeverity | None = None
    summary: str | None = Field(default=None, max_length=200)
    description: str = Field(max_length=5000)
    context: FeedbackContextIn = Field(default_factory=FeedbackContextIn)
    attachments: list[FeedbackAttachmentIn] = Field(default_factory=list, max_length=5)

    @field_validator("description")
    @classmethod
    def _non_blank_description(cls, v: str) -> str:
        v = v.strip()
        if len(v) < 10:
            raise ValueError("description must be at least 10 non-whitespace characters")
        return v


class FeedbackCreated(BaseModel):
    report_id: UUID
