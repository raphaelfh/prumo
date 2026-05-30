"""Pydantic schemas for the feedback intake endpoint."""

from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field, field_validator

FeedbackType = Literal["bug", "suggestion", "question", "other"]
FeedbackSeverity = Literal["low", "medium", "high", "critical"]
AttachmentKind = Literal["image", "video"]

_ALLOWED_CONTENT_TYPES = {
    "image/png",
    "image/webp",
    "image/jpeg",
    "video/webm",
}


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
    content_type: str
    size_bytes: int | None = Field(default=None, ge=0)

    @field_validator("content_type")
    @classmethod
    def _check_content_type(cls, v: str) -> str:
        if v not in _ALLOWED_CONTENT_TYPES:
            raise ValueError(f"content_type not allowed: {v}")
        return v


class FeedbackCreate(BaseModel):
    type: FeedbackType
    severity: FeedbackSeverity | None = None
    summary: str | None = Field(default=None, max_length=200)
    description: str = Field(min_length=10, max_length=5000)
    context: FeedbackContextIn = Field(default_factory=FeedbackContextIn)
    attachments: list[FeedbackAttachmentIn] = Field(default_factory=list, max_length=5)


class FeedbackCreated(BaseModel):
    report_id: UUID
