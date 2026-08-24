"""The screen and the workbook must report the SAME overall judgments.

The two callers of ``derived_judgment_service`` hand it different shapes for the
same stored value: the run view passes the RAW jsonb envelope, while the export
passes a value_map that ``resolve_value`` has already collapsed to a display
label (so a marker arrives as the string ``"No information"``). A read-time
interpretation that handles only one of those shapes makes the banner and the
xlsx disagree in silence — which has happened once already.

This module is the guard: one value set, both paths, assert equality. It runs
the real payload builder and the real export model builder, not a mental model
of either.
"""

from __future__ import annotations

from typing import Any
from uuid import uuid4

from app.models.extraction import ExtractionEntityRole, ExtractionFieldType
from app.services.derived_judgment_payload import build_derived_judgments_payload
from app.services.exports.value_envelope import resolve_value
from app.services.extraction_export_service import (
    ArticleDescriptor,
    ExportMode,
    ExtractionExportService,
    FieldDescriptor,
    SectionDescriptor,
)

_NI: dict[str, Any] = {"value": None, "absent_reason": "no_information"}
_ROB = "risk_of_bias"

# The four-domain shape of a PROBAST+AI evaluation roll-up, D4 collapse included.
_SPEC: dict[str, Any] = {
    "derived_judgments": [
        {
            "id": "eval_overall_rob",
            "label": "Overall risk of bias (evaluation)",
            "rule": "worst_domain",
            "inputs": [
                {"section": "eval_d1", "field": _ROB},
                {"section": "eval_d2", "field": _ROB},
                {"section": "eval_d3", "field": _ROB},
                {
                    "collapse": "worst_of",
                    "label": "Evaluation D4: Analysis",
                    "inputs": [
                        {"section": "eval_d4_apparent", "field": _ROB},
                        {"section": "eval_d4_internal", "field": _ROB},
                        {"section": "eval_d4_external", "field": _ROB},
                    ],
                },
            ],
        }
    ]
}

_SECTIONS = (
    "eval_d1",
    "eval_d2",
    "eval_d3",
    "eval_d4_apparent",
    "eval_d4_internal",
    "eval_d4_external",
)


class _Field:
    def __init__(self, fid: Any, name: str) -> None:
        self.id = fid
        self.name = name


class _EntityType:
    def __init__(self, name: str, fields: list[_Field]) -> None:
        self.id = uuid4()
        self.name = name
        self.label = name
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


def _screen_overall(
    values_by_section: dict[str, Any],
    spec: dict[str, Any] | None = None,
    section_names: tuple[str, ...] = _SECTIONS,
) -> str | None:
    """What the banner renders — the run-view payload, fed RAW envelopes."""
    entity_types, instances, values = [], [], []
    for name in section_names:
        fid, iid = uuid4(), uuid4()
        et = _EntityType(name, [_Field(fid, _ROB)])
        entity_types.append(et)
        instances.append(_Instance(et.id, iid))
        if name in values_by_section:
            values.append(_Value(iid, fid, values_by_section[name]))
    payload = build_derived_judgments_payload(
        template_schema=spec if spec is not None else _SPEC,
        entity_types=entity_types,
        instances=instances,
        values=values,
    )
    assert len(payload) == 1
    return payload[0].value


def _workbook_overall(
    values_by_section: dict[str, Any],
    spec: dict[str, Any] | None = None,
    section_names: tuple[str, ...] = _SECTIONS,
) -> str | None:
    """What the Appraisal-summary sheet prints — the export model builder, fed
    the value_map AFTER ``resolve_value`` has collapsed each envelope to a
    display label, exactly as ``_build_*_value_map`` does upstream."""
    run_id = uuid4()
    sections: list[SectionDescriptor] = []
    section_instances: dict[Any, tuple[Any, ...]] = {}
    value_map: dict[tuple[Any, ...], Any] = {}
    for name in section_names:
        section_id, field_id, instance_id = uuid4(), uuid4(), uuid4()
        field = FieldDescriptor(
            field_id=field_id,
            label="Risk of bias",
            type=ExtractionFieldType.SELECT,
            allowed_values=("Low", "High", "Unclear"),
            name=_ROB,
        )
        sections.append(
            SectionDescriptor(
                entity_type_id=section_id,
                label=name,
                role=ExtractionEntityRole.STUDY_SECTION,
                parent_entity_type_id=None,
                fields=(field,),
                name=name,
            )
        )
        section_instances[section_id] = (instance_id,)
        if name in values_by_section:
            # The collapse to a display label is the whole point of the parity
            # check: a marker reaches the export as "No information".
            value_map[(run_id, instance_id, field_id)] = resolve_value(values_by_section[name])

    article = ArticleDescriptor(
        article_id=uuid4(),
        header_label="Art 1",
        run_id=run_id,
        version_id=None,
        model_instances=(),
        section_instances=section_instances,
    )
    model = ExtractionExportService._build_appraisal_model(
        sections=tuple(sections),
        articles=(article,),
        reviewers=(),
        value_map=value_map,
        mode=ExportMode.CONSENSUS,
        template_schema=spec if spec is not None else _SPEC,
    )
    assert model is not None
    return model.rows[0].derived_values[0]


def _assert_agree(label: str, values_by_section: dict[str, Any], expected: str | None) -> None:
    screen = _screen_overall(dict(values_by_section))
    workbook = _workbook_overall(dict(values_by_section))
    assert screen == expected, f"{label}: banner said {screen!r}, expected {expected!r}"
    assert workbook == screen, f"{label}: workbook said {workbook!r}, banner said {screen!r}"


# --- the edge-case matrix, exercised through BOTH paths ---------------------


def test_all_low() -> None:
    _assert_agree(
        "all-Low",
        {
            "eval_d1": {"value": "Low"},
            "eval_d2": {"value": "Low"},
            "eval_d3": {"value": "Low"},
            "eval_d4_apparent": {"value": "Low"},
        },
        "Low",
    )


def test_a_high_propagates_through_an_unrated_domain() -> None:
    """Spec 2026-08-22 §1: the official step-4 "at least one domain high ->
    high" row does not require the other domains to be rated."""
    _assert_agree(
        "High + unrated",
        {
            "eval_d1": {"value": "High"},
            # eval_d2 / eval_d3 / every D4 type unrated
        },
        "High",
    )


def test_a_single_high_dominates() -> None:
    _assert_agree(
        "single High",
        {
            "eval_d1": {"value": "Low"},
            "eval_d2": {"value": "High"},
            "eval_d3": {"value": "Low"},
            "eval_d4_apparent": {"value": "Low"},
        },
        "High",
    )


def test_mixed_unclear_without_a_high() -> None:
    _assert_agree(
        "mixed Unclear",
        {
            "eval_d1": {"value": "Low"},
            "eval_d2": {"value": "Unclear"},
            "eval_d3": {"value": "Low"},
            "eval_d4_apparent": {"value": "Low"},
        },
        "Unclear",
    )


def test_every_domain_no_information_is_unclear_not_blank() -> None:
    """methodology.md §4b — a domain-level NI IS a judgment of Unclear.

    D4 carries a judged performance type here so the domain is actually
    judged; the all-types-NI variant is the case below, which means something
    different.
    """
    _assert_agree(
        "every domain NI",
        {
            "eval_d1": _NI,
            "eval_d2": _NI,
            "eval_d3": _NI,
            "eval_d4_apparent": _NI,
            "eval_d4_internal": {"value": "Unclear"},
        },
        "Unclear",
    )


def test_every_domain_ni_including_all_d4_types_is_incomplete() -> None:
    """The two NI meanings meet here, and the cautious one wins.

    D1-D3 read as Unclear (§4b), but an NI on EVERY D4 performance type means
    the study reported no performance at all (§5), so D4 is excluded down to
    nothing and is therefore unjudged — and an unjudged domain refuses the
    overall (rule 3) rather than settling for Unclear. A reviewer who meant
    "D4 was reported but cannot be judged" has to say so on a reported type;
    that expressiveness gap is a property of the instrument's collapse, not of
    this code.
    """
    _assert_agree(
        "every domain NI, D4 wholly unreported",
        {
            "eval_d1": _NI,
            "eval_d2": _NI,
            "eval_d3": _NI,
            "eval_d4_apparent": _NI,
            "eval_d4_internal": _NI,
            "eval_d4_external": _NI,
        },
        None,
    )


def test_unreported_d4_types_are_excluded_not_counted_as_unclear() -> None:
    """methodology.md §5 — a study is not marked down for validation it never
    performed. Apparent is Low and the two unreported types drop out, so the
    collapse is Low and the overall stays Low."""
    _assert_agree(
        "unreported D4 types",
        {
            "eval_d1": {"value": "Low"},
            "eval_d2": {"value": "Low"},
            "eval_d3": {"value": "Low"},
            "eval_d4_apparent": {"value": "Low"},
            "eval_d4_internal": _NI,
            "eval_d4_external": _NI,
        },
        "Low",
    )


def test_partially_filled_is_incomplete_never_low() -> None:
    _assert_agree(
        "partially filled",
        {
            "eval_d1": {"value": "Low"},
            "eval_d2": {"value": "Low"},
            # eval_d3 never judged
            "eval_d4_apparent": {"value": "Low"},
        },
        None,
    )


def test_a_cleared_domain_blanks_the_overall() -> None:
    """The reported production state: a bare {"value": null} left by a clear is
    unjudged, so the overall refuses to conclude."""
    _assert_agree(
        "value cleared",
        {
            "eval_d1": {"value": "Low"},
            "eval_d2": {"value": "Low"},
            "eval_d3": {"value": None},
            "eval_d4_apparent": {"value": "Low"},
        },
        None,
    )


def test_re_entering_the_cleared_domain_restores_the_overall() -> None:
    """…and re-entering it computes again. The write path is what used to drop
    the re-entry (see selectDirtyEntries); the rule never did."""
    _assert_agree(
        "value re-entered",
        {
            "eval_d1": {"value": "Low"},
            "eval_d2": {"value": "Low"},
            "eval_d3": {"value": "Unclear"},
            "eval_d4_apparent": {"value": "Low"},
        },
        "Unclear",
    )


def test_no_performance_type_reported_blanks_the_collapse() -> None:
    """D4 is a domain like any other: if NO type was reported at all there is
    nothing to collapse, so the overall is incomplete rather than Low."""
    _assert_agree(
        "no D4 type reported",
        {
            "eval_d1": {"value": "Low"},
            "eval_d2": {"value": "Low"},
            "eval_d3": {"value": "Low"},
        },
        None,
    )


def test_not_applicable_is_never_a_judgment() -> None:
    _assert_agree(
        "not_applicable on a domain",
        {
            "eval_d1": {"value": "Low"},
            "eval_d2": {"value": None, "absent_reason": "not_applicable"},
            "eval_d3": {"value": "Low"},
            "eval_d4_apparent": {"value": "Low"},
        },
        None,
    )


# --- v2 shape (spec 2026-08-22 §2): overalls over STORED judgments ----------

_V2_SECTIONS = ("eval_d1", "eval_d2", "eval_d3", "eval_d4_judgment")
_V2_SPEC: dict[str, Any] = {
    "derived_judgments": [
        {
            "id": "eval_overall_rob",
            "label": "Overall risk of bias (evaluation)",
            "rule": "worst_domain",
            "inputs": [{"section": s, "field": _ROB} for s in _V2_SECTIONS],
        }
    ]
}


def _assert_v2_agree(label: str, values: dict[str, Any], expected: str | None) -> None:
    screen = _screen_overall(dict(values), spec=_V2_SPEC, section_names=_V2_SECTIONS)
    workbook = _workbook_overall(dict(values), spec=_V2_SPEC, section_names=_V2_SECTIONS)
    assert screen == expected, f"{label}: banner said {screen!r}, expected {expected!r}"
    assert workbook == screen, f"{label}: workbook said {workbook!r}, banner said {screen!r}"


def test_v2_all_low_agrees() -> None:
    _assert_v2_agree("v2 all-Low", {s: {"value": "Low"} for s in _V2_SECTIONS}, "Low")


def test_v2_high_propagates_through_unrated_domains_on_both_paths() -> None:
    """The single stored eval-D4 judgment fires the overall even while the
    other domains are unrated — on the banner AND in the workbook."""
    _assert_v2_agree("v2 lone High", {"eval_d4_judgment": {"value": "High"}}, "High")


def test_v2_ni_on_the_stored_judgment_is_unclear() -> None:
    values: dict[str, Any] = {s: {"value": "Low"} for s in ("eval_d1", "eval_d2", "eval_d3")}
    values["eval_d4_judgment"] = _NI
    _assert_v2_agree("v2 NI judgment", values, "Unclear")


def test_signaling_worst_agrees_across_caller_shapes() -> None:
    """Rule-level parity for the recommendation rule: raw envelopes (run
    view) and resolved display labels (any future export caller) agree."""
    from app.services.derived_judgment_service import compute_derived_judgments

    spec = [
        {
            "id": "r",
            "label": "R",
            "rule": "signaling_worst",
            "target": {"section": "s", "field": "j"},
            "inputs": [
                {"section": "s", "field": "q1"},
                {"section": "s", "field": "q2"},
            ],
        }
    ]
    raw = {
        ("s", "q1"): {"value": "PN"},
        ("s", "q2"): {"value": None, "absent_reason": "no_information"},
    }
    resolved = {("s", "q1"): "PN", ("s", "q2"): "No information"}
    a = compute_derived_judgments(spec, raw)[0]
    b = compute_derived_judgments(spec, resolved)[0]
    assert a.value == b.value == "High"
    assert [i.contribution for i in a.inputs] == [i.contribution for i in b.inputs]
