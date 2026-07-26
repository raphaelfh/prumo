"""Run-view exposes computed overalls for templates that declare a spec.

Direct-call unit tests on purpose: lines reached only via httpx ASGITransport
do not register with diff-cover (the documented ASGI blind spot), so the
payload assembly is exercised by calling the builder directly.
"""

from __future__ import annotations

from typing import Any
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
    def __init__(self, fid: Any, name: str) -> None:
        self.id = fid
        self.name = name


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
            inputs=[RunViewDerivedInput(label="D1 — Participants", value="High")],
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
    assert out[0].inputs == [RunViewDerivedInput(label="dev_d1_participants", value="Low")]


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
