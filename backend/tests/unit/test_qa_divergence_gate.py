"""The finalize backstop: a published judgment that overrides its derived
default must say why.

Direct-call unit tests on the pure rule (the documented ASGI blind spot makes
endpoint-only coverage invisible to diff-cover). The assembly against a real
run — instance resolution and the published-state read — is proven in
``tests/integration/test_qa_finalize_divergence_gate.py``, which also pins the
subclass relationship the 400 rests on.
"""

from __future__ import annotations

from typing import Any
from uuid import uuid4

from app.services.qa_divergence_gate import divergences_without_rationale

# One recommendation (a derived DEFAULT for an assessor-owned judgment) over a
# single signaling question, plus a computed overall that carries no target —
# the shape the seeded PROBAST+AI spec uses for its 8 + 4 entries.
_SECTION = "dev_d1_participants"
_SPEC: dict[str, Any] = {
    "derived_judgments": [
        {
            "id": "dev_d1_quality",
            "label": "Development D1: quality",
            "rule": "signaling_worst",
            "target": {"section": _SECTION, "field": "quality_concern"},
            "rationale": {"section": _SECTION, "field": "quality_concern_rationale"},
            "inputs": [{"section": _SECTION, "field": "q1"}],
        },
        {
            "id": "dev_overall_quality",
            "label": "Overall quality (development)",
            "rule": "worst_domain",
            "summary": {"section": _SECTION, "field": "summary"},
            "inputs": [{"section": _SECTION, "field": "quality_concern"}],
        },
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


class _Fixture:
    """One section carrying the signaling question, the judgment and its rationale."""

    def __init__(self) -> None:
        self.q1, self.judgment, self.rationale = uuid4(), uuid4(), uuid4()
        self.et = _EntityType(
            _SECTION,
            [
                _Field(self.q1, "q1"),
                _Field(self.judgment, "quality_concern"),
                _Field(self.rationale, "quality_concern_rationale"),
            ],
            label="Development D1: Participants",
        )
        self.iid = uuid4()

    def blocked(self, published: dict[Any, Any], schema: Any = _SPEC) -> list[str]:
        return divergences_without_rationale(
            template_schema=schema,
            entity_types=[self.et],
            instances=[_Instance(self.et.id, self.iid)],
            published=[_Value(self.iid, fid, v) for fid, v in published.items()],
        )


def test_diverged_judgment_without_rationale_is_reported() -> None:
    # "PY" on the only signaling question derives a Low default; the assessor
    # published High over it and wrote nothing.
    f = _Fixture()
    assert f.blocked({f.q1: {"value": "PY"}, f.judgment: {"value": "High"}}) == [
        "Development D1: quality"
    ]


def test_a_rationale_clears_the_gate() -> None:
    f = _Fixture()
    assert (
        f.blocked(
            {
                f.q1: {"value": "PY"},
                f.judgment: {"value": "High"},
                f.rationale: {"value": "Small sample, wide CI."},
            }
        )
        == []
    )


def test_whitespace_is_not_a_rationale() -> None:
    # Mirrors the client's ``.trim()`` — is_value_filled would call "  " filled
    # and let a blank explanation through.
    f = _Fixture()
    assert f.blocked(
        {f.q1: {"value": "PY"}, f.judgment: {"value": "High"}, f.rationale: {"value": "   "}}
    ) == ["Development D1: quality"]


def test_agreeing_with_the_default_needs_no_rationale() -> None:
    f = _Fixture()
    assert f.blocked({f.q1: {"value": "PY"}, f.judgment: {"value": "Low"}}) == []


def test_case_and_padding_do_not_manufacture_a_divergence() -> None:
    # judgment_of casefolds and strips, so a re-cased publish is the SAME
    # judgment — the gate must not read it as an override.
    f = _Fixture()
    assert f.blocked({f.q1: {"value": "PY"}, f.judgment: {"value": "  low  "}}) == []


def test_blank_target_is_not_a_divergence() -> None:
    # Nothing published over the default: an unfinished judgment is the
    # completeness gate's business, not this one.
    f = _Fixture()
    assert f.blocked({f.q1: {"value": "PY"}, f.judgment: {"value": None}}) == []
    assert f.blocked({f.q1: {"value": "PY"}}) == []


def test_not_applicable_marker_is_not_a_judgment() -> None:
    f = _Fixture()
    marker = {"value": None, "absent_reason": "not_applicable"}
    assert f.blocked({f.q1: {"value": "PY"}, f.judgment: marker}) == []


def test_no_information_marker_is_a_judgment_and_diverges() -> None:
    # Instrument semantics: on a DOMAIN judgment "no information" IS a
    # judgment (Unclear), so overriding a Low default with it still owes a
    # rationale. worst_domain reads it the same way.
    f = _Fixture()
    marker = {"value": None, "absent_reason": "no_information"}
    assert f.blocked({f.q1: {"value": "PY"}, f.judgment: marker}) == ["Development D1: quality"]


def test_no_default_means_nothing_to_diverge_from() -> None:
    # The signaling question is unanswered, so the recommendation computes no
    # default — any published judgment stands on its own.
    f = _Fixture()
    assert f.blocked({f.judgment: {"value": "High"}}) == []


def test_out_of_scope_section_can_never_block() -> None:
    # §2a drops an excluded section's values before the rules run, so the
    # default is None there — a leftover published judgment in an
    # inapplicable part must not strand the finalize.
    f = _Fixture()
    schema = dict(_SPEC)
    schema["scope_rules"] = {
        "classifier": {"section": _SECTION, "field": "q1"},
        "excludes": {"PY": [_SECTION]},
    }
    assert f.blocked({f.q1: {"value": "PY"}, f.judgment: {"value": "High"}}, schema=schema) == []


def test_rationale_is_found_in_its_own_section() -> None:
    # The payload keeps the target's entity type but drops the rationale's.
    # Locating the rationale through the tree — not under the target's
    # instance — is what stops a split pair reading as "nothing written".
    f = _Fixture()
    elsewhere_id = uuid4()
    elsewhere = _EntityType("overall_judgement", [_Field(elsewhere_id, "why")])
    other_instance = uuid4()
    spec = {
        "derived_judgments": [
            dict(
                _SPEC["derived_judgments"][0],
                rationale={"section": "overall_judgement", "field": "why"},
            )
        ]
    }
    blocked = divergences_without_rationale(
        template_schema=spec,
        entity_types=[f.et, elsewhere],
        instances=[_Instance(f.et.id, f.iid), _Instance(elsewhere.id, other_instance)],
        published=[
            _Value(f.iid, f.q1, {"value": "PY"}),
            _Value(f.iid, f.judgment, {"value": "High"}),
            _Value(other_instance, elsewhere_id, {"value": "Explained over there."}),
        ],
    )
    assert blocked == []


def test_only_the_first_instance_of_a_repeated_section_is_backstopped() -> None:
    # The payload derives the default from the FIRST instance's values, so the
    # gate must read the published judgment from that same instance. Reading
    # the last would both strand a finalize the first instance explained and
    # stop seeing an unexplained override on it. Keep q1 on the first instance:
    # the payload resolves the input coordinate through the same map, so an
    # answer on the second derives no default and the entry would be skipped
    # for an unrelated reason.
    f = _Fixture()
    second = uuid4()
    instances = [_Instance(f.et.id, f.iid), _Instance(f.et.id, second)]

    def blocked(published: list[_Value]) -> list[str]:
        return divergences_without_rationale(
            template_schema=_SPEC,
            entity_types=[f.et],
            instances=instances,
            published=published,
        )

    assert (
        blocked(
            [
                _Value(f.iid, f.q1, {"value": "PY"}),
                _Value(f.iid, f.judgment, {"value": "Low"}),
                _Value(second, f.judgment, {"value": "High"}),
            ]
        )
        == []
    )
    assert blocked(
        [
            _Value(f.iid, f.q1, {"value": "PY"}),
            _Value(f.iid, f.judgment, {"value": "High"}),
            _Value(second, f.judgment, {"value": "Low"}),
        ]
    ) == ["Development D1: quality"]


def test_template_without_a_spec_is_a_no_op() -> None:
    # Kind-neutral: extraction templates carry no recommendations, so the gate
    # costs them nothing and needs no ``kind ==`` branch.
    f = _Fixture()
    assert f.blocked({f.judgment: {"value": "High"}}, schema={}) == []


def test_a_computed_overall_is_never_gated() -> None:
    # Only RECOMMENDATION entries own a stored judgment. The overall has no
    # target, so its summary field can diverge freely.
    f = _Fixture()
    spec: dict[str, Any] = {"derived_judgments": [_SPEC["derived_judgments"][1]]}
    assert f.blocked({f.judgment: {"value": "High"}}, schema=spec) == []
