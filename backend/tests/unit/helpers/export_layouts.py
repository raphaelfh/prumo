"""The one unit-test layout helper for the export builders (R12).

``make_layout`` builds an ``ExportLayout`` the way ``resolve_layout`` shapes
it: rule-3 codes stamped on the fields and a Codebook over the given sections
as the only (active) version. Keyword overrides win.
"""

from __future__ import annotations

from collections.abc import Sequence
from datetime import UTC, datetime
from typing import Any
from uuid import uuid4

from app.schemas.extraction_run import RunViewField
from app.services.exports.codebook_model import (
    VersionSections,
    apply_field_codes,
    build_codebook_entries,
)
from app.services.exports.descriptors import ValueKey
from app.services.exports.values import ExportStatus, ExportValue, build_option_labels
from app.services.extraction_export_service import (
    ArticleDescriptor,
    ExportLayout,
    ExportMode,
    ReviewerDescriptor,
    SectionDescriptor,
)


def export_value(status: ExportStatus = "answered", **over: Any) -> ExportValue:
    return ExportValue(**{"raw": None, "status": status, **over})


def make_run_view_field(**kw: Any) -> RunViewField:
    base: dict[str, Any] = {
        "id": uuid4(),
        "name": "f",
        "label": "F",
        "is_required": False,
        "sort_order": 0,
    }
    return RunViewField(**{**base, **kw})


def make_layout(
    *,
    sections: Sequence[SectionDescriptor] = (),
    articles: Sequence[ArticleDescriptor] = (),
    value_map: dict[ValueKey, ExportValue] | None = None,
    mode: ExportMode = ExportMode.CONSENSUS,
    reviewers: Sequence[ReviewerDescriptor] = (),
    **over: Any,
) -> ExportLayout:
    labels = over.pop("option_labels", None) or build_option_labels(sections, [])
    codebook = build_codebook_entries(VersionSections(uuid4(), 1, tuple(sections)), (), labels)
    codes = {e.field_id: e.field_code for e in codebook}
    fields: dict[str, Any] = {
        "project_name": "Test Project",
        "template_name": "Template",
        "template_version": 1,
        "sections": apply_field_codes(sections, codes),
        "articles": tuple(articles),
        "reviewers": tuple(reviewers),
        "mode": mode,
        "include_ai_metadata": False,
        "anonymize_reviewer_names": False,
        "generated_at": datetime(2026, 1, 1, tzinfo=UTC),
        "value_map": value_map or {},
        "codebook": codebook,
    }
    return ExportLayout(**{**fields, **over})
