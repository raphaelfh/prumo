"""Run-view exposes computed overalls for templates that declare a spec.

Direct-call unit tests on purpose: lines reached only via httpx ASGITransport
do not register with diff-cover (the documented ASGI blind spot), so the
payload assembly is exercised by calling the builder directly.
"""

from __future__ import annotations

from typing import Any
from uuid import uuid4

from app.schemas.extraction_run import RunViewDerivedJudgment
from app.services.extraction_run_read_service import build_derived_judgments_payload

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
    def __init__(self, name: str, fields: list[_Field]) -> None:
        self.id = uuid4()
        self.name = name
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
    et = _EntityType("dev_d1_participants", [_Field(fid, "quality_concern")])
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
        )
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
