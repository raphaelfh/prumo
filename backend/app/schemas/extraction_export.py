"""Extraction Export Schemas.

Pydantic v2 request/response models for the
`/api/v1/projects/{project_id}/extraction-export` endpoint family.

Feature: 009-extraction-excel-export. Contract:
`specs/009-extraction-excel-export/contracts/extraction-export.openapi.yaml`.
"""

from enum import StrEnum
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class ExtractionExportMode(StrEnum):
    """Source-of-values for the exported workbook."""

    CONSENSUS = "consensus"
    SINGLE_USER = "single_user"
    ALL_USERS = "all_users"


class ExtractionArticleScope(StrEnum):
    """Universe of candidate articles to consider before mode eligibility."""

    CURRENT_LIST = "current_list"
    SELECTED_ONLY = "selected_only"


class ExtractionExportRequest(BaseModel):
    """Start an extraction export."""

    model_config = ConfigDict(populate_by_name=True, str_strip_whitespace=True)

    template_id: UUID = Field(
        ...,
        description="Active project_extraction_templates id.",
    )
    mode: ExtractionExportMode = Field(
        default=ExtractionExportMode.CONSENSUS,
        description="Source of values.",
    )
    reviewer_id: UUID | None = Field(
        default=None,
        description=(
            "Required when mode=single_user. Caller may only target other "
            "reviewers if they hold the project manager role."
        ),
    )
    article_scope: ExtractionArticleScope = Field(
        default=ExtractionArticleScope.CURRENT_LIST,
        description="Article universe before mode eligibility.",
    )
    article_ids: list[UUID] = Field(
        ...,
        description="Candidate article ids (resolved by the caller per article_scope).",
        min_length=1,
    )
    include_ai_metadata: bool = Field(
        default=False,
        description="Adds the optional AI metadata sheet to the workbook.",
    )
    anonymize_reviewer_names: bool = Field(
        default=False,
        description="Only meaningful when mode=all_users; replaces names with Reviewer A/B/…",
    )


class ExtractionExportStartedResponse(BaseModel):
    """202 payload returned when the export is queued."""

    job_id: str
    message: str | None = "Export started. Poll status for download link."


class ExtractionExportStatusResponse(BaseModel):
    """GET /status/{job_id} payload."""

    job_id: str
    status: str = Field(
        ...,
        description="pending | running | completed | failed | cancelled",
    )
    download_url: str | None = None
    expires_at: str | None = None
    error: str | None = None


class ExtractionExportCancelResponse(BaseModel):
    """Cancel endpoint payload."""

    cancelled: bool
