"""Run-view exposes computed overalls for templates that declare a spec.

Direct-call unit tests on purpose: lines reached only via httpx ASGITransport
do not register with diff-cover (the documented ASGI blind spot), so the
payload assembly is exercised by calling the builder directly.
"""

from __future__ import annotations

import copy
from typing import Any
from unittest.mock import patch
from uuid import uuid4

from app.schemas.extraction_run import RunViewDerivedInput, RunViewDerivedJudgment
from app.services.derived_judgment_payload import (
    build_derived_judgments_payload,
    values_for_derivation,
)

_SPEC: dict[str, Any] = {
    "derived_judgments": [
        {
            "id": "dev_overall_quality",
            "label": "Overall quality (development)",
            "rule": "worst_domain",
            "inputs": [{"section": "dev_d1_participants", "field": "quality_concern"}],
        }
    ]
}


class _Field:
    def __init__(self, fid: Any, name: str, label: str = "") -> None:
        self.id = fid
        self.name = name
        self.label = label


class _EntityType:
    def __init__(self, name: str, fields: list[_Field], label: str = "") -> None:
        self.id = uuid4()
        self.name = name
        self.label = label
        self.fields = fields


class _Instance:
    def __init__(self, entity_type_id: Any, iid: Any) -> None:
        self.entity_type_id = entity_type_id
        self.id = iid


class _Value:
    def __init__(self, iid: Any, fid: Any, value: Any) -> None:
        self.instance_id = iid
        self.field_id = fid
        self.value = value


def test_returns_empty_without_a_spec() -> None:
    assert (
        build_derived_judgments_payload(
            template_schema={}, entity_types=[], instances=[], values=[]
        )
        == []
    )


def test_maps_names_to_coordinates_and_computes() -> None:
    fid, iid = uuid4(), uuid4()
    et = _EntityType(
        "dev_d1_participants", [_Field(fid, "quality_concern")], label="D1 — Participants"
    )
    out = build_derived_judgments_payload(
        template_schema=_SPEC,
        entity_types=[et],
        instances=[_Instance(et.id, iid)],
        values=[_Value(iid, fid, {"value": "High"})],
    )
    assert out == [
        RunViewDerivedJudgment(
            id="dev_overall_quality",
            label="Overall quality (development)",
            value="High",
            # The breakdown names the contributing domain in the SECTION's own
            # words, so the banner reads like the accordion below it.
            inputs=[
                RunViewDerivedInput(label="D1 — Participants", value="High", contribution="High")
            ],
        )
    ]


def test_breakdown_names_the_domain_that_blocks_an_incomplete_overall() -> None:
    """The dash's reason must be nameable: an unjudged domain reports value=None
    against its own label, so the client never leaves the reviewer hunting."""
    fid, iid = uuid4(), uuid4()
    et = _EntityType(
        "dev_d1_participants", [_Field(fid, "quality_concern")], label="D1 — Participants"
    )
    out = build_derived_judgments_payload(
        template_schema=_SPEC,
        entity_types=[et],
        instances=[_Instance(et.id, iid)],
        values=[_Value(iid, fid, {"value": None})],
    )
    assert out[0].value is None
    assert out[0].inputs == [RunViewDerivedInput(label="D1 — Participants", value=None)]


def test_breakdown_falls_back_to_the_section_name_without_a_label() -> None:
    fid, iid = uuid4(), uuid4()
    et = _EntityType("dev_d1_participants", [_Field(fid, "quality_concern")])
    out = build_derived_judgments_payload(
        template_schema=_SPEC,
        entity_types=[et],
        instances=[_Instance(et.id, iid)],
        values=[_Value(iid, fid, "Low")],
    )
    assert out[0].inputs == [
        RunViewDerivedInput(label="dev_d1_participants", value="Low", contribution="Low")
    ]


def test_unjudged_domain_yields_null_not_low() -> None:
    et = _EntityType("dev_d1_participants", [_Field(uuid4(), "quality_concern")])
    out = build_derived_judgments_payload(
        template_schema=_SPEC, entity_types=[et], instances=[], values=[]
    )
    assert out[0].value is None


def test_first_instance_wins_for_a_repeated_entity_type() -> None:
    """Mirrors the export's ``instance_ids[0]`` rule."""
    fid, first, second = uuid4(), uuid4(), uuid4()
    et = _EntityType("dev_d1_participants", [_Field(fid, "quality_concern")])
    out = build_derived_judgments_payload(
        template_schema=_SPEC,
        entity_types=[et],
        instances=[_Instance(et.id, first), _Instance(et.id, second)],
        values=[_Value(first, fid, "Low"), _Value(second, fid, "High")],
    )
    assert out[0].value == "Low"


def test_dangling_spec_reference_does_not_crash() -> None:
    """A spec coordinate the template no longer has nulls the overall (and is
    logged) rather than raising."""
    et = _EntityType("some_other_section", [_Field(uuid4(), "quality_concern")])
    out = build_derived_judgments_payload(
        template_schema=_SPEC, entity_types=[et], instances=[], values=[]
    )
    assert out[0].value is None


def test_schema_model_accepts_null_value() -> None:
    assert RunViewDerivedJudgment(id="x", label="X", value=None).value is None


# --- naming a collapse group whose spec carries no label --------------------

_D4_SPEC: dict[str, Any] = {
    "derived_judgments": [
        {
            "id": "eval_overall_rob",
            "label": "Overall risk of bias (evaluation)",
            "rule": "worst_domain",
            # No "label" on the collapse — exactly the spec shape production
            # holds, because neither the seed nor the clone ever updates it.
            "inputs": [
                {
                    "collapse": "worst_of",
                    "inputs": [
                        {"section": "eval_d4_analysis_apparent", "field": "risk_of_bias"},
                        {"section": "eval_d4_analysis_internal", "field": "risk_of_bias"},
                        {"section": "eval_d4_analysis_external", "field": "risk_of_bias"},
                    ],
                }
            ],
        }
    ]
}

# Verbatim from the seeded PROBAST+AI template.
_D4_LABELS = {
    "eval_d4_analysis_apparent": "Evaluation D4: Analysis (apparent performance)",
    "eval_d4_analysis_internal": "Evaluation D4: Analysis (internal validation)",
    "eval_d4_analysis_external": "Evaluation D4: Analysis (external validation)",
}


def test_unlabelled_collapse_is_named_by_what_its_sections_share() -> None:
    """A three-section row must not be named after one performance type."""
    fid = uuid4()
    entity_types, instances, values = [], [], []
    for name, label in _D4_LABELS.items():
        iid = uuid4()
        et = _EntityType(name, [_Field(fid, "risk_of_bias")], label=label)
        entity_types.append(et)
        instances.append(_Instance(et.id, iid))
        values.append(_Value(iid, fid, {"value": "Low"}))

    out = build_derived_judgments_payload(
        template_schema=_D4_SPEC,
        entity_types=entity_types,
        instances=instances,
        values=values,
    )
    assert out[0].inputs == [
        RunViewDerivedInput(label="Evaluation D4: Analysis", value="Low", contribution="Low")
    ]


def test_a_single_section_label_is_used_verbatim() -> None:
    """Only a group needs deriving; one section already names itself, trailing
    punctuation and all."""
    fid, iid = uuid4(), uuid4()
    et = _EntityType(
        "dev_d1_participants", [_Field(fid, "quality_concern")], label="D1: Participants:"
    )
    out = build_derived_judgments_payload(
        template_schema=_SPEC,
        entity_types=[et],
        instances=[_Instance(et.id, iid)],
        values=[_Value(iid, fid, "Low")],
    )
    assert out[0].inputs[0].label == "D1: Participants:"


def test_an_explicit_collapse_label_wins_over_the_derived_one() -> None:
    spec = copy.deepcopy(_D4_SPEC)
    spec["derived_judgments"][0]["inputs"][0]["label"] = "Domain 4 — Analysis"
    fid = uuid4()
    entity_types, instances, values = [], [], []
    for name, label in _D4_LABELS.items():
        iid = uuid4()
        et = _EntityType(name, [_Field(fid, "risk_of_bias")], label=label)
        entity_types.append(et)
        instances.append(_Instance(et.id, iid))
        values.append(_Value(iid, fid, {"value": "Low"}))

    out = build_derived_judgments_payload(
        template_schema=spec, entity_types=entity_types, instances=instances, values=values
    )
    assert out[0].inputs[0].label == "Domain 4 — Analysis"


# --- which value set feeds the derivation, by stage and reveal --------------
#
# Hypothesis A1 in the audit: a partial published set would win over the
# caller's edits mid-consensus. It does — deliberately — and these pin the
# whole truth table so the choice cannot drift silently.

_PUBLISHED = ["published"]
_OWN = ["own"]


def test_blind_caller_derives_from_their_own_values() -> None:
    """extract stage, or any reviewer who may not see peers."""
    assert (
        values_for_derivation(
            peers_revealed=False, published_states=_PUBLISHED, current_values=_OWN
        )
        == _OWN
    )


def test_revealed_caller_derives_from_the_published_state() -> None:
    """consensus (arbitrator) / finalized — never the caller's own values, or an
    arbitrator would read the reviewer's overalls as if they were published."""
    assert (
        values_for_derivation(peers_revealed=True, published_states=_PUBLISHED, current_values=_OWN)
        == _PUBLISHED
    )


def test_revealed_caller_before_anything_is_published_falls_back_to_own_values() -> None:
    """An empty published set is 'consensus has not published yet', not 'every
    domain is unjudged' — falling back keeps the banner meaningful."""
    assert (
        values_for_derivation(peers_revealed=True, published_states=[], current_values=_OWN) == _OWN
    )


# --- target/rationale/summary id resolution (spec 2026-08-22 §4) ------------

_V2_SPEC: dict[str, Any] = {
    "derived_judgments": [
        {
            "id": "dev_d1_quality",
            "label": "Development D1: quality",
            "rule": "signaling_worst",
            "target": {"section": "dev_d1_participants", "field": "quality_concern"},
            "rationale": {
                "section": "dev_d1_participants",
                "field": "quality_concern_rationale",
            },
            "inputs": [{"section": "dev_d1_participants", "field": "q1"}],
        },
        {
            "id": "dev_overall_quality",
            "label": "Overall quality (development)",
            "rule": "worst_domain",
            "summary": {"section": "overall_judgement", "field": "summary_quality_development"},
            "inputs": [{"section": "dev_d1_participants", "field": "quality_concern"}],
        },
    ]
}


def _v2_tree() -> tuple[_EntityType, _EntityType, dict[str, Any]]:
    ids = {"q1": uuid4(), "qc": uuid4(), "qcr": uuid4(), "sm": uuid4()}
    d1 = _EntityType(
        "dev_d1_participants",
        [
            _Field(ids["q1"], "q1"),
            _Field(ids["qc"], "quality_concern"),
            _Field(ids["qcr"], "quality_concern_rationale"),
        ],
        label="D1",
    )
    overall = _EntityType("overall_judgement", [_Field(ids["sm"], "summary_quality_development")])
    return d1, overall, ids


def test_recommendation_resolves_target_and_rationale_ids() -> None:
    d1, overall, ids = _v2_tree()
    out = build_derived_judgments_payload(
        template_schema=_V2_SPEC, entity_types=[d1, overall], instances=[], values=[]
    )
    rec, ov = out
    assert rec.target_entity_type_id == d1.id
    assert rec.target_field_id == ids["qc"]
    assert rec.rationale_field_id == ids["qcr"]
    assert rec.summary_field_id is None
    assert ov.target_entity_type_id is None
    assert ov.target_field_id is None
    assert ov.rationale_field_id is None
    assert ov.summary_field_id == ids["sm"]


def test_v1_shaped_spec_has_no_pointer_ids() -> None:
    et = _EntityType("dev_d1_participants", [_Field(uuid4(), "quality_concern")])
    out = build_derived_judgments_payload(
        template_schema=_SPEC, entity_types=[et], instances=[], values=[]
    )
    assert out[0].target_entity_type_id is None
    assert out[0].target_field_id is None
    assert out[0].rationale_field_id is None
    assert out[0].summary_field_id is None


def test_dangling_target_pointer_warns_and_leaves_ids_none() -> None:
    spec = copy.deepcopy(_V2_SPEC)
    spec["derived_judgments"][0]["target"]["field"] = "renamed_gone"
    d1, overall, _ids = _v2_tree()
    with patch("app.services.derived_judgment_payload.logger") as mock_logger:
        out = build_derived_judgments_payload(
            template_schema=spec, entity_types=[d1, overall], instances=[], values=[]
        )
    assert out[0].target_entity_type_id is None
    assert out[0].target_field_id is None
    # The rationale still resolves independently of the broken target.
    assert out[0].rationale_field_id is not None
    warned = mock_logger.warning.call_args
    assert warned.args[0] == "qa_derived_spec_dangling_ref"
    assert ("dev_d1_participants", "renamed_gone") in warned.kwargs["coordinates"]


def test_contribution_passes_through_to_the_breakdown() -> None:
    """signaling_worst rows carry the RAW answer plus the judgment consumed —
    the client highlights by contribution with zero rule knowledge."""
    d1, overall, ids = _v2_tree()
    iid = uuid4()
    out = build_derived_judgments_payload(
        template_schema=_V2_SPEC,
        entity_types=[d1, overall],
        instances=[_Instance(d1.id, iid)],
        values=[_Value(iid, ids["q1"], {"value": "PN"})],
    )
    assert out[0].value == "High"
    # Recommendation rows are named after the QUESTION (field label; the fake
    # field carries none, so its machine name), never the shared section.
    assert out[0].inputs == [RunViewDerivedInput(label="q1", value="PN", contribution="High")]


def test_recommendation_rows_are_named_after_the_question() -> None:
    """All of a recommendation's inputs live in ONE section — naming them by
    the section label would repeat identically on every row and leave the
    reviewer unable to tell WHICH answer caused the default."""
    q1, q2 = uuid4(), uuid4()
    d1 = _EntityType(
        "dev_d1_participants",
        [
            _Field(q1, "q1_appropriate_data_sources", "Were appropriate data sources used?"),
            _Field(q2, "q2_appropriate_study_design", "Was an appropriate study design used?"),
            _Field(uuid4(), "quality_concern", "Quality"),
            _Field(uuid4(), "quality_concern_rationale", "Rationale of quality rating"),
        ],
        label="Development D1",
    )
    spec = {
        "derived_judgments": [
            {
                "id": "dev_d1_quality",
                "label": "Development D1: quality",
                "rule": "signaling_worst",
                "target": {"section": "dev_d1_participants", "field": "quality_concern"},
                "rationale": {
                    "section": "dev_d1_participants",
                    "field": "quality_concern_rationale",
                },
                "inputs": [
                    {"section": "dev_d1_participants", "field": "q1_appropriate_data_sources"},
                    {"section": "dev_d1_participants", "field": "q2_appropriate_study_design"},
                ],
            }
        ]
    }
    out = build_derived_judgments_payload(
        template_schema=spec, entity_types=[d1], instances=[], values=[]
    )
    assert [i.label for i in out[0].inputs] == [
        "Were appropriate data sources used?",
        "Was an appropriate study design used?",
    ]
