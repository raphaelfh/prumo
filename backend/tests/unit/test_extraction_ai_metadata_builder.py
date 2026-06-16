"""Unit tests for the pure AI-metadata sub-builder (``build_ai_metadata``)."""

from __future__ import annotations

from datetime import UTC, datetime

from app.services.exports.extraction.ai_metadata import build_ai_metadata
from app.services.extraction_export_service import (
    AIProposalRow,
    ExportLayout,
    ExportMode,
    ExportNotes,
)


def _layout(*, include_ai_metadata: bool, rows: tuple[AIProposalRow, ...] = ()) -> ExportLayout:
    return ExportLayout(
        project_name="P",
        template_name="T",
        template_version=1,
        sections=(),
        articles=(),
        reviewers=(),
        mode=ExportMode.CONSENSUS,
        include_ai_metadata=include_ai_metadata,
        anonymize_reviewer_names=False,
        notes=ExportNotes(),
        value_map={},
        ai_proposal_rows=rows,
    )


def _proposal(**over: object) -> AIProposalRow:
    base: dict[str, object] = {
        "article_label": "Gaca, 2011",
        "section_label": "1. Source of data",
        "instance_index": 1,
        "field_label": "1.1 Dose",
        "ai_proposed_value": "5 mg",
        "confidence": 0.93,
        "rationale": "reason",
        "evidence_text": "evidence",
        "evidence_pages": "4",
        "proposed_at": datetime(2026, 5, 23, 10, 0, 0, tzinfo=UTC),
        "reviewer_outcome": "accepted",
        "final_value_used": "Yes",
    }
    base.update(over)
    return AIProposalRow(**base)  # type: ignore[arg-type]


def test_returns_none_when_toggled_off() -> None:
    assert build_ai_metadata(_layout(include_ai_metadata=False)) is None


def test_header_and_placeholder_when_no_rows() -> None:
    spec = build_ai_metadata(_layout(include_ai_metadata=True))
    assert spec is not None
    assert spec.title == "AI metadata"
    assert spec.rows[0][0].value == "Article"
    assert spec.rows[0][4].value == "AI proposed value"
    assert spec.rows[0][11].value == "Final value used"
    assert spec.rows[1][0].value == "(No AI proposals recorded for the selected articles.)"


def test_one_row_per_proposal_in_canonical_order() -> None:
    spec = build_ai_metadata(_layout(include_ai_metadata=True, rows=(_proposal(),)))
    assert spec is not None
    row = spec.rows[1]
    assert row[0].value == "Gaca, 2011"
    assert row[2].value == 1
    assert row[3].value == "1.1 Dose"
    # Value columns (E/L) render via the shared format helper.
    assert row[4].value == "5 mg"
    assert row[11].value == "Yes"
    # Timestamp is ISO-8601 text (SheetSpec IR is scalar-only).
    assert row[9].value == "2026-05-23T10:00:00+00:00"
    assert row[10].value == "accepted"
