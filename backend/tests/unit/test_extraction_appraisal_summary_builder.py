"""Unit tests for the appraisal-summary sub-builder (§7)."""

from __future__ import annotations

import uuid

import pytest


def test_appraisal_dataclasses_importable_and_default_none() -> None:
    """AppraisalModel/AppraisalRow exist and ExportLayout.appraisal defaults to None."""
    from app.services.extraction_export_service import (
        AppraisalModel,
        AppraisalRow,
        ExportLayout,
    )

    row = AppraisalRow(
        article_id=uuid.uuid4(),
        record_label="Gaca, 2011",
        domain_verdicts=("Low", "High"),
        overall="High",
        per_reviewer_overall={},
    )
    assert row.overall == "High"

    model = AppraisalModel(
        domain_section_ids=(),
        domain_labels=("Participants", "Predictors"),
        rows=(row,),
    )
    assert model.domain_labels[1] == "Predictors"

    # ExportLayout.appraisal is an optional projection (back-compat default).
    assert "appraisal" in ExportLayout.__dataclass_fields__
    field = ExportLayout.__dataclass_fields__["appraisal"]
    assert field.default is None


@pytest.mark.parametrize(
    ("verdicts", "expected"),
    [
        (("Low", "Low", "Low"), "Low"),
        (("Low", "High", "Low"), "High"),  # any High => High (§7)
        (("Low", "Unclear", "Low"), "Unclear"),  # Unclear outranks Low
        (("Unclear", "High"), "High"),  # High outranks Unclear
        (("Some concerns", "Low"), "Some concerns"),  # QUADAS/ROBINS labels
        (("Moderate", "Low"), "Moderate"),
        ((None, "", None), None),  # all-blank => blank Overall
        (("Low", None, "High"), "High"),  # blanks ignored, High wins
        (("Critical", "Low"), "Critical"),  # unknown non-empty => most severe
        (("low", "high"), "high"),  # case-insensitive rank, label preserved
    ],
)
def test_appraisal_overall_worst_case(verdicts, expected) -> None:
    from app.services.exports.extraction.appraisal_summary import _appraisal_overall

    assert _appraisal_overall(verdicts) == expected


def _layout_with_appraisal(appraisal, *, mode_name="consensus", reviewers=()):
    """Minimal ExportLayout carrying a pre-computed AppraisalModel."""
    from datetime import UTC, datetime

    from app.services.extraction_export_service import (
        ExportLayout,
        ExportMode,
        ExportNotes,
    )

    notes = ExportNotes(
        omitted_articles_by_stage={},
        template_version_label="QA v1",
        export_mode_label=mode_name,
        anonymize_reviewer_names=False,
        include_ai_metadata=False,
        generated_at=datetime.now(UTC),
    )
    return ExportLayout(
        project_name="P",
        template_name="PROBAST",
        template_version=1,
        sections=(),
        articles=(),
        reviewers=reviewers,
        mode=ExportMode(mode_name),
        include_ai_metadata=False,
        anonymize_reviewer_names=False,
        notes=notes,
        value_map={},
        appraisal=appraisal,
    )


def test_build_appraisal_summary_none_when_no_layer() -> None:
    from app.services.exports.extraction.appraisal_summary import build_appraisal_summary

    layout = _layout_with_appraisal(None)
    assert build_appraisal_summary(layout) is None


def test_build_appraisal_summary_consensus_shape() -> None:
    from app.services.exports.extraction.appraisal_summary import build_appraisal_summary
    from app.services.extraction_export_service import AppraisalModel, AppraisalRow

    aid = uuid.uuid4()
    appraisal = AppraisalModel(
        domain_section_ids=(uuid.uuid4(), uuid.uuid4()),
        domain_labels=("Participants", "Predictors"),
        rows=(
            AppraisalRow(
                article_id=aid,
                record_label="Gaca, 2011",
                domain_verdicts=("Low", "High"),
                overall="High",
                per_reviewer_overall={},
            ),
        ),
    )
    spec = build_appraisal_summary(_layout_with_appraisal(appraisal))
    assert spec is not None
    # Header row: Record + each domain + Overall.
    header = tuple(c.value for c in spec.rows[0])
    assert header == ("Record", "Participants", "Predictors", "Overall")
    # Data row: label, verdicts, rolled-up Overall.
    data = tuple(c.value for c in spec.rows[1])
    assert data == ("Gaca, 2011", "Low", "High", "High")
    assert spec.freeze == "B2"  # record column + header frozen


def test_build_appraisal_summary_all_users_per_reviewer_columns() -> None:
    from app.services.exports.extraction.appraisal_summary import build_appraisal_summary
    from app.services.extraction_export_service import (
        AppraisalModel,
        AppraisalRow,
        ReviewerDescriptor,
    )

    r1, r2 = uuid.uuid4(), uuid.uuid4()
    reviewers = (
        ReviewerDescriptor(reviewer_id=r1, display_label="Reviewer 1"),
        ReviewerDescriptor(reviewer_id=r2, display_label="Reviewer 2"),
    )
    appraisal = AppraisalModel(
        domain_section_ids=(uuid.uuid4(),),
        domain_labels=("Participants",),
        rows=(
            AppraisalRow(
                article_id=uuid.uuid4(),
                record_label="Gaca, 2011",
                domain_verdicts=("Low",),
                overall="Low",
                per_reviewer_overall={r1: "Low", r2: "High"},
            ),
        ),
    )
    spec = build_appraisal_summary(
        _layout_with_appraisal(appraisal, mode_name="all_users", reviewers=reviewers)
    )
    header = tuple(c.value for c in spec.rows[0])
    # consensus Overall + one Overall column PER reviewer, in reviewer order.
    assert header == (
        "Record",
        "Participants",
        "Overall",
        "Overall — Reviewer 1",
        "Overall — Reviewer 2",
    )
    data = tuple(c.value for c in spec.rows[1])
    assert data == ("Gaca, 2011", "Low", "Low", "Low", "High")


def test_build_appraisal_summary_single_user_one_overall() -> None:
    from app.services.exports.extraction.appraisal_summary import build_appraisal_summary
    from app.services.extraction_export_service import AppraisalModel, AppraisalRow

    appraisal = AppraisalModel(
        domain_section_ids=(uuid.uuid4(),),
        domain_labels=("Participants",),
        rows=(
            AppraisalRow(
                article_id=uuid.uuid4(),
                record_label="Gaca, 2011",
                domain_verdicts=("High",),
                overall="High",  # the single reviewer's rollup
                per_reviewer_overall={},
            ),
        ),
    )
    spec = build_appraisal_summary(_layout_with_appraisal(appraisal, mode_name="single_user"))
    header = tuple(c.value for c in spec.rows[0])
    assert header == ("Record", "Participants", "Overall")  # no per-reviewer cols
    assert tuple(c.value for c in spec.rows[1]) == ("Gaca, 2011", "High", "High")
