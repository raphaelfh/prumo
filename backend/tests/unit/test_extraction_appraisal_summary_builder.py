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
