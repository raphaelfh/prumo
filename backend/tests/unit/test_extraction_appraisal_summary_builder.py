"""Unit tests for the appraisal-summary sub-builder (§7)."""

from __future__ import annotations

import uuid

import pytest

from app.models.extraction import ExtractionFieldType
from app.services.exports.extraction.workbook import ExportShape, allocate_titles
from app.services.exports.values import ExportValue, to_export_value
from app.services.extraction_export_service import AllowedValue, FieldDescriptor
from tests.unit.helpers.export_layouts import export_value, make_layout

_RISK = FieldDescriptor(
    field_id=uuid.uuid4(),
    label="RoB",
    type=ExtractionFieldType.SELECT,
    allowed_values=(AllowedValue("Low", "Low"), AllowedValue("High", "High")),
)


def _v(code: str) -> ExportValue:
    return to_export_value({"value": code}, _RISK, {})


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
        domain_verdicts=(_v("Low"), _v("High")),
        overall="High",
        per_reviewer_overall={},
    )
    assert row.overall == "High"

    model = AppraisalModel(
        domain_section_ids=(),
        domain_labels=("Participants", "Predictors"),
        domain_fields=(_RISK, _RISK),
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
        # --- ADR-0016 Phase 4: a coded-disposition verdict (resolved to its
        # stable label) is EXCLUDED from the worst-case rank, never most-severe.
        # Discriminating cases: on the pre-fix code a "No information" verdict
        # ranked most-severe (7) and would win the Overall.
        (("No information", "Low"), "Low"),  # marker excluded, real Low wins
        (("Low", "No information"), "Low"),  # order-independent
        (("No information", "High"), "High"),  # real High wins over the marker
        (("Unclear", "No information"), "Unclear"),  # Unclear is substantive, kept
        (("No information", "No information"), None),  # all-marker => blank Overall
        (("No information", "Not applicable", "Not evaluated"), None),  # all 3 codes
    ],
)
def test_appraisal_overall_worst_case(verdicts, expected) -> None:
    from app.services.exports.extraction.appraisal_summary import _appraisal_overall

    assert _appraisal_overall(verdicts) == expected


def test_disposition_marker_verdict_excluded_from_rank() -> None:
    # ADR-0016 Phase 4: every rendered disposition label ranks -1 (ignored), from
    # the SAME single label source display_value emits — so a marker verdict can
    # never silently force a Critical/most-severe Overall. Case-insensitive; must
    # not over-reach onto substantive risk labels.
    from app.services.exports.extraction.appraisal_summary import _verdict_rank
    from app.services.value_semantics import ABSENT_REASON_LABELS

    for label in ABSENT_REASON_LABELS.values():
        assert _verdict_rank(label) == -1
        assert _verdict_rank(label.upper()) == -1  # case-insensitive
    # Substantive risk labels still rank normally (exclusion did not over-reach).
    assert _verdict_rank("High") > _verdict_rank("Low") >= 0
    assert _verdict_rank("Unclear") >= 0


def _layout_with_appraisal(appraisal, *, mode_name="consensus", reviewers=()):
    """Minimal ExportLayout carrying a pre-computed AppraisalModel."""
    from datetime import UTC, datetime

    from app.services.extraction_export_service import (
        ExportLayout,
        ExportMode,
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
        generated_at=datetime(2026, 1, 1, tzinfo=UTC),
        value_map={},
        appraisal=appraisal,
    )


def test_build_appraisal_summary_none_when_no_layer() -> None:
    from app.services.exports.extraction.appraisal_summary import build_appraisal_summary

    layout = _layout_with_appraisal(None)
    assert (
        build_appraisal_summary(
            layout,
            allocate_titles(layout, ExportShape.COMPLETE, include_matrix=True),
            ExportShape.COMPLETE,
        )
        is None
    )


def test_build_appraisal_summary_consensus_shape() -> None:
    from app.services.exports.extraction.appraisal_summary import build_appraisal_summary
    from app.services.extraction_export_service import AppraisalModel, AppraisalRow

    aid = uuid.uuid4()
    appraisal = AppraisalModel(
        domain_section_ids=(uuid.uuid4(), uuid.uuid4()),
        domain_labels=("Participants", "Predictors"),
        domain_fields=(_RISK, _RISK),
        rows=(
            AppraisalRow(
                article_id=aid,
                record_label="Gaca, 2011",
                domain_verdicts=(_v("Low"), _v("High")),
                overall="High",
                per_reviewer_overall={},
            ),
        ),
    )
    layout = _layout_with_appraisal(appraisal)
    spec = build_appraisal_summary(
        layout,
        allocate_titles(layout, ExportShape.COMPLETE, include_matrix=True),
        ExportShape.COMPLETE,
    )
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
        domain_fields=(_RISK,),
        rows=(
            AppraisalRow(
                article_id=uuid.uuid4(),
                record_label="Gaca, 2011",
                domain_verdicts=(_v("Low"),),
                overall="Low",
                per_reviewer_overall={r1: "Low", r2: "High"},
            ),
        ),
    )
    layout = _layout_with_appraisal(appraisal, mode_name="all_users", reviewers=reviewers)
    spec = build_appraisal_summary(
        layout,
        allocate_titles(layout, ExportShape.COMPLETE, include_matrix=True),
        ExportShape.COMPLETE,
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
        domain_fields=(_RISK,),
        rows=(
            AppraisalRow(
                article_id=uuid.uuid4(),
                record_label="Gaca, 2011",
                domain_verdicts=(_v("High"),),
                overall="High",  # the single reviewer's rollup
                per_reviewer_overall={},
            ),
        ),
    )
    layout = _layout_with_appraisal(appraisal, mode_name="single_user")
    spec = build_appraisal_summary(
        layout,
        allocate_titles(layout, ExportShape.COMPLETE, include_matrix=True),
        ExportShape.COMPLETE,
    )
    header = tuple(c.value for c in spec.rows[0])
    assert header == ("Record", "Participants", "Overall")  # no per-reviewer cols
    assert tuple(c.value for c in spec.rows[1]) == ("Gaca, 2011", "High", "High")


def test_verdict_cells_render_through_display_value() -> None:
    from app.services.exports.extraction.appraisal_summary import build_appraisal_summary
    from app.services.extraction_export_service import AppraisalModel, AppraisalRow

    f = FieldDescriptor(
        field_id=uuid.uuid4(),
        label="RoB",
        type=ExtractionFieldType.SELECT,
        allowed_values=(AllowedValue("L", "Low"),),
    )
    appraisal = AppraisalModel(
        domain_section_ids=(uuid.uuid4(), uuid.uuid4()),
        domain_labels=("P", "Q"),
        domain_fields=(f, f),
        rows=(
            AppraisalRow(
                article_id=uuid.uuid4(),
                record_label="Gaca, 2011",
                domain_verdicts=(
                    to_export_value({"value": "L"}, f, {(f.field_id, "L"): "Low"}),
                    None,
                ),
                overall="Low",
                per_reviewer_overall={},
            ),
        ),
    )
    layout = _layout_with_appraisal(appraisal)
    spec = build_appraisal_summary(
        layout,
        allocate_titles(layout, ExportShape.COMPLETE, include_matrix=True),
        ExportShape.COMPLETE,
    )
    assert spec is not None
    assert tuple(c.value for c in spec.rows[1]) == ("Gaca, 2011", "Low", None, "Low")


# --- Publication shape (§5 rule 8, §12.3, D7) --------------------------------

_PUB_RISK = FieldDescriptor(
    field_id=uuid.uuid4(),
    label="Risk",
    type=ExtractionFieldType.SELECT,
    allowed_values=(AllowedValue("low", "Low"), AllowedValue("high", "High")),
)


def _pub_appraisal(derived_labels=(), derived_values=()):
    from app.services.extraction_export_service import AppraisalModel, AppraisalRow

    return AppraisalModel(
        domain_section_ids=(uuid.uuid4(), uuid.uuid4()),
        domain_labels=("Participants", "Predictors"),
        domain_fields=(_PUB_RISK, _PUB_RISK),
        rows=(
            AppraisalRow(
                article_id=uuid.uuid4(),
                record_label="Gaca 2011",
                domain_verdicts=(
                    export_value("absent", absent_code="no_information"),
                    export_value(value_text="high", value_label="High"),
                ),
                overall="High",
                per_reviewer_overall={},
                derived_values=derived_values,
            ),
        ),
        derived_labels=derived_labels,
    )


def _pub_build(appraisal, shape):
    from app.services.exports.extraction.appraisal_summary import build_appraisal_summary

    layout = make_layout(appraisal=appraisal)
    spec = build_appraisal_summary(
        layout, allocate_titles(layout, shape, include_matrix=False), shape
    )
    assert spec is not None
    return spec


def test_publication_appraisal_drops_worst_domain_overall_and_abbreviates() -> None:
    pub = _pub_build(_pub_appraisal(), ExportShape.PUBLICATION)
    assert "Overall" not in [c.value for c in pub.rows[0]]
    assert [c.value for c in pub.rows[1]][1:3] == ["NI", "High"]
    assert "NI = No information" in {r[0].value for r in pub.rows[2:] if r}
    review = _pub_build(_pub_appraisal(), ExportShape.COMPLETE)
    assert "Overall" in [c.value for c in review.rows[0]]
    assert [c.value for c in review.rows[1]][1] == "No information"


def test_publication_appraisal_keeps_derived_overalls_in_full_text() -> None:  # D7
    pub = _pub_build(
        _pub_appraisal(("Overall risk of bias (evaluation)",), ("Not applicable",)),
        ExportShape.PUBLICATION,
    )
    header = [c.value for c in pub.rows[0]]
    row = dict(zip(header, (c.value for c in pub.rows[1]), strict=True))
    assert row["Overall risk of bias (evaluation)"] == "Not applicable"


def test_publication_appraisal_fits_cell_estimate() -> None:  # footnotes add rows
    from app.services.exports.extraction.workbook import estimate_sheet_cells

    layout = make_layout(appraisal=_pub_appraisal())
    pub = _pub_build(_pub_appraisal(), ExportShape.PUBLICATION)
    bound = estimate_sheet_cells(layout, ExportShape.PUBLICATION)["appraisal_summary"]
    assert bound >= len(pub.rows) * max(len(r) for r in pub.rows)
