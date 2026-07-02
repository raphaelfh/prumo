"""Pure unit tests for _build_appraisal_model (§7) — no DB."""

from __future__ import annotations

import uuid

from app.models.extraction import (
    ExtractionCardinality,
    ExtractionEntityRole,
    ExtractionFieldType,
)
from app.services.extraction_export_service import (
    ArticleDescriptor,
    ExportMode,
    ExtractionExportService,
    FieldDescriptor,
    ReviewerDescriptor,
    SectionDescriptor,
)


def _field(
    label,
    ftype=ExtractionFieldType.SELECT,
    parent=None,
    allowed_values=("Low", "Unclear", "High"),
):
    return FieldDescriptor(
        field_id=uuid.uuid4(),
        label=label,
        type=ftype,
        allowed_values=allowed_values,
        parent_section_id=parent or uuid.uuid4(),
    )


def _section(label, verdict_field, sort_order):
    sid = uuid.uuid4()
    vf = FieldDescriptor(
        field_id=verdict_field.field_id,
        label=verdict_field.label,
        type=verdict_field.type,
        allowed_values=verdict_field.allowed_values,
        parent_section_id=sid,
    )
    return SectionDescriptor(
        entity_type_id=sid,
        label=label,
        role=ExtractionEntityRole.STUDY_SECTION,
        parent_entity_type_id=None,
        fields=(vf,),
        cardinality=ExtractionCardinality.ONE,
        sort_order=sort_order,
    )


def test_build_appraisal_model_consensus_rollup() -> None:
    d1 = _section("Participants", _field("RoB"), 0)
    d2 = _section("Predictors", _field("RoB"), 1)
    f1 = d1.fields[0].field_id
    f2 = d2.fields[0].field_id

    run_id = uuid.uuid4()
    inst1 = uuid.uuid4()
    inst2 = uuid.uuid4()
    aid = uuid.uuid4()
    article = ArticleDescriptor(
        article_id=aid,
        header_label="Gaca, 2011",
        run_id=run_id,
        run_stage=None,
        version_id=None,
        model_instances=(),
        section_instances={d1.entity_type_id: (inst1,), d2.entity_type_id: (inst2,)},
    )
    # consensus value_map: 3-tuple keys, already-resolved scalars.
    value_map = {
        (run_id, inst1, f1): "Low",
        (run_id, inst2, f2): "High",
    }

    model = ExtractionExportService._build_appraisal_model(
        sections=(d1, d2),
        articles=(article,),
        reviewers=(),
        value_map=value_map,
        mode=ExportMode.CONSENSUS,
    )
    assert model is not None
    assert model.domain_labels == ("Participants", "Predictors")
    assert len(model.rows) == 1
    row = model.rows[0]
    assert row.record_label == "Gaca, 2011"
    assert row.domain_verdicts == ("Low", "High")
    assert row.overall == "High"  # worst-case
    assert row.per_reviewer_overall == {}


def test_build_appraisal_model_excludes_disposition_marker_verdict() -> None:
    # ADR-0016 Phase 4: a coded-disposition verdict resolves (via resolve_value,
    # upstream of this builder) to its stable label — "No information" here. The
    # domain CELL keeps that label, but the worst-case Overall EXCLUDES it, so the
    # real "High" wins instead of a fabricated Critical/most-severe. An all-marker
    # record rolls up to a blank Overall while its cells still show the label.
    d1 = _section("Participants", _field("RoB"), 0)
    d2 = _section("Predictors", _field("RoB"), 1)
    f1 = d1.fields[0].field_id
    f2 = d2.fields[0].field_id

    run_id = uuid.uuid4()
    inst1, inst2, aid = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    article = ArticleDescriptor(
        article_id=aid,
        header_label="Gaca, 2011",
        run_id=run_id,
        run_stage=None,
        version_id=None,
        model_instances=(),
        section_instances={d1.entity_type_id: (inst1,), d2.entity_type_id: (inst2,)},
    )

    # Mixed: one domain silent (marker → "No information"), one real "High".
    mixed = ExtractionExportService._build_appraisal_model(
        sections=(d1, d2),
        articles=(article,),
        reviewers=(),
        value_map={(run_id, inst1, f1): "No information", (run_id, inst2, f2): "High"},
        mode=ExportMode.CONSENSUS,
    )
    assert mixed is not None
    row = mixed.rows[0]
    assert row.domain_verdicts == ("No information", "High")  # cells stay populated
    assert row.overall == "High"  # marker excluded — real verdict wins

    # All-marker: every domain silent → blank Overall, cells still labelled.
    all_marker = ExtractionExportService._build_appraisal_model(
        sections=(d1, d2),
        articles=(article,),
        reviewers=(),
        value_map={
            (run_id, inst1, f1): "No information",
            (run_id, inst2, f2): "Not applicable",
        },
        mode=ExportMode.CONSENSUS,
    )
    assert all_marker is not None
    am_row = all_marker.rows[0]
    assert am_row.domain_verdicts == ("No information", "Not applicable")
    assert am_row.overall is None  # nothing assessable => blank, not most-severe


def test_build_appraisal_model_all_users_per_reviewer() -> None:
    d1 = _section("Participants", _field("RoB"), 0)
    f1 = d1.fields[0].field_id
    run_id, inst1, aid = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    r1, r2 = uuid.uuid4(), uuid.uuid4()
    reviewers = (
        ReviewerDescriptor(reviewer_id=r1, display_label="R1"),
        ReviewerDescriptor(reviewer_id=r2, display_label="R2"),
    )
    article = ArticleDescriptor(
        article_id=aid,
        header_label="Gaca, 2011",
        run_id=run_id,
        run_stage=None,
        version_id=None,
        model_instances=(),
        section_instances={d1.entity_type_id: (inst1,)},
    )
    # all_users value_map: 4-tuple keys; consensus row uses reviewer_id=None.
    value_map = {
        (run_id, inst1, f1, None): "Low",
        (run_id, inst1, f1, r1): "Low",
        (run_id, inst1, f1, r2): "High",
    }
    model = ExtractionExportService._build_appraisal_model(
        sections=(d1,),
        articles=(article,),
        reviewers=reviewers,
        value_map=value_map,
        mode=ExportMode.ALL_USERS,
    )
    row = model.rows[0]
    assert row.overall == "Low"  # consensus rollup
    assert row.per_reviewer_overall == {r1: "Low", r2: "High"}


def test_build_appraisal_model_none_when_no_select_field() -> None:
    # A QA template whose domains carry no SELECT verdict field -> None (no sheet).
    text_field = _field("Notes", ftype=ExtractionFieldType.TEXT)
    d1 = _section("Free notes", text_field, 0)
    model = ExtractionExportService._build_appraisal_model(
        sections=(d1,),
        articles=(),
        reviewers=(),
        value_map={},
        mode=ExportMode.CONSENSUS,
    )
    assert model is None


def test_build_appraisal_model_skips_signalling_select_picks_risk_label_field() -> None:
    # Mirrors the real seed: SELECT-typed signalling questions precede the
    # risk_of_bias judgment in sort_order. The verdict must be the risk-label
    # SELECT (Low/High/Unclear), NOT the first SELECT (a signalling answer).
    sid = uuid.uuid4()
    signalling = FieldDescriptor(
        field_id=uuid.uuid4(),
        label="q1_1 appropriate data sources",
        type=ExtractionFieldType.SELECT,
        allowed_values=("Y", "PY", "PN", "N", "NI", "NA"),  # _PROBAST_SIGNALING
        parent_section_id=sid,
    )
    risk = FieldDescriptor(
        field_id=uuid.uuid4(),
        label="Risk of bias",
        type=ExtractionFieldType.SELECT,
        allowed_values=("Low", "High", "Unclear"),  # _PROBAST_JUDGMENT
        parent_section_id=sid,
    )
    applicability = FieldDescriptor(
        field_id=uuid.uuid4(),
        label="Applicability concerns",
        type=ExtractionFieldType.SELECT,
        allowed_values=("Low", "High", "Unclear"),
        parent_section_id=sid,
    )
    d1 = SectionDescriptor(
        entity_type_id=sid,
        label="Participants",
        role=ExtractionEntityRole.STUDY_SECTION,
        parent_entity_type_id=None,
        fields=(signalling, risk, applicability),  # signalling first, by sort_order
        cardinality=ExtractionCardinality.ONE,
        sort_order=0,
    )
    run_id, inst, aid = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    article = ArticleDescriptor(
        article_id=aid,
        header_label="Gaca, 2011",
        run_id=run_id,
        run_stage=None,
        version_id=None,
        model_instances=(),
        section_instances={sid: (inst,)},
    )
    # If selection wrongly picked the signalling field, "Y" would be read and
    # ranked maximally severe -> Overall "Y". Keying on the risk-label set
    # reads risk_of_bias instead, so the verdict is the judgment "Low".
    value_map = {
        (run_id, inst, signalling.field_id): "Y",
        (run_id, inst, risk.field_id): "Low",
        (run_id, inst, applicability.field_id): "High",
    }
    model = ExtractionExportService._build_appraisal_model(
        sections=(d1,),
        articles=(article,),
        reviewers=(),
        value_map=value_map,
        mode=ExportMode.CONSENSUS,
    )
    assert model is not None
    row = model.rows[0]
    assert row.domain_verdicts == ("Low",)  # risk_of_bias, not "Y" or "High"
    assert row.overall == "Low"
