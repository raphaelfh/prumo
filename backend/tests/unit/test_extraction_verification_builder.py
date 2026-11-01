"""The Verification sheet (spec §4.3): reviewer columns, match and agreement."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import uuid4

from app.models.extraction import ExtractionFieldType
from app.services.exports.ai_proposal_projection import EngineFacts
from app.services.exports.descriptors import value_key
from app.services.exports.extraction.sheet_spec import SheetSpec
from app.services.exports.extraction.verification import agreement, build_verification, match_of
from app.services.exports.extraction.workbook import ExportShape, allocate_titles
from app.services.extraction_export_service import (
    AIProposalRow,
    ArticleDescriptor,
    ExportLayout,
    ExportMode,
    FieldDescriptor,
    ReviewerDescriptor,
    SectionDescriptor,
)
from app.services.run_lifecycle_service import APPROVE_ALL_RATIONALE
from tests.unit.helpers.export_layouts import (
    ai_link,
    export_value,
    make_cell,
    make_layout,
    make_run_view_field,
)

_num = make_run_view_field(field_type="number")
_A, _B = uuid4(), uuid4()
_RUN = uuid4()
_INST = uuid4()
_DOSE = FieldDescriptor(uuid4(), "Dose", ExtractionFieldType.NUMBER, (), name="dose")
_AGE = FieldDescriptor(uuid4(), "Age", ExtractionFieldType.NUMBER, (), name="age")
_STUDY = SectionDescriptor(uuid4(), "Study", None, (_DOSE, _AGE), name="study")
_ART = ArticleDescriptor(
    uuid4(), "Smith 2020", _RUN, None, entries={(_STUDY.entity_type_id, None): (_INST,)}
)
_RA = ReviewerDescriptor(_A, "Member A")
_RB = ReviewerDescriptor(_B, "Member B")


def test_a_filled_b_blank_is_incomplete() -> None:
    assert match_of({_A: {"value": 1}, _B: None}, 2, _num) == "incomplete"


def test_two_distinct_values_conflict() -> None:
    assert match_of({_A: {"value": 1}, _B: {"value": 2}}, 2, _num) == "conflict"


def test_string_and_int_are_all_equal() -> None:
    assert match_of({_A: {"value": "7"}, _B: {"value": 7}}, 2, _num) == "all_equal"


def test_single_rater_never_all_equal() -> None:
    assert match_of({_A: {"value": 1}}, 1, _num) == "incomplete"


def test_absent_markers_compare_by_code() -> None:
    ni = {"value": None, "absent_reason": "no_information"}
    na = {"value": None, "absent_reason": "not_applicable"}
    assert match_of({_A: ni, _B: dict(ni)}, 2, _num) == "all_equal"
    assert match_of({_A: ni, _B: na}, 2, _num) == "conflict"


def _layout(**over: Any) -> ExportLayout:
    base: dict[str, Any] = {
        "mode": ExportMode.ALL_USERS,
        "reviewers": (_RA, _RB),
        "raters_by_run": {_RUN: (_A, _B)},
        "articles": (_ART,),
    }
    return make_layout(sections=(_STUDY,), **{**base, **over})


def _cells(field: FieldDescriptor, **by_rater: Any) -> dict[Any, Any]:
    """Reviewer cells of one coordinate keyed by rater name (``a`` / ``b`` / ``consensus``)."""
    raters = {"a": _A, "b": _B, "consensus": None}
    return {
        value_key(_RUN, _INST, field.field_id, raters[name]): cell
        for name, cell in by_rater.items()
    }


def _values(cells: dict[Any, Any]) -> dict[Any, Any]:
    return {k: export_value(value_num=c.envelope["value"]) for k, c in cells.items()}


def _spec(layout: ExportLayout) -> SheetSpec:
    titles = allocate_titles(layout, ExportShape.COMPLETE, include_matrix=True)
    spec = build_verification(layout, titles)
    assert spec is not None
    return spec


def _table(layout: ExportLayout) -> list[dict[str, Any]]:
    spec = _spec(layout)
    header = [c.value for c in spec.rows[0]]
    return [dict(zip(header, (c.value for c in row), strict=True)) for row in spec.rows[1:]]


def test_reviewer_outside_rater_set_shows_dash() -> None:
    cells = _cells(_DOSE, a=make_cell({"value": 5}, actor_id=_A))
    (row,) = _table(_layout(cells=cells, value_map=_values(cells), raters_by_run={_RUN: (_A,)}))
    assert row["Member A"] == 5
    assert row["Member B"] == "—"
    assert (row["n_raters"], row["n_raters_with_value"], row["match"]) == (1, 1, "incomplete")


def test_columns_and_consensus_facts() -> None:
    cells = _cells(
        _DOSE,
        a=make_cell({"value": 5}, actor_id=_A),
        b=make_cell({"value": 5}, actor_id=_B),
        consensus=make_cell(
            {"value": 5}, kind="manual_override", actor_id=_A, rationale=APPROVE_ALL_RATIONALE
        ),
    )
    layout = _layout(cells=cells, value_map=_values(cells), rater_labels={_A: "Member A"})
    spec = _spec(layout)
    assert [c.value for c in spec.rows[0]] == [
        "article_label", "record_label", "field_code", "field_label", "Member A", "Member B",
        "Consensus", "match", "n_raters", "n_raters_with_value", "consensus_method",
        "consensus_by", "consensus_rationale",
    ]  # fmt: skip
    (row,) = _table(layout)
    assert (row["article_label"], row["record_label"], row["field_code"], row["field_label"]) == (
        "Smith 2020", "Smith 2020", "study.dose", "Dose"
    )  # fmt: skip
    assert (row["Consensus"], row["match"], row["n_raters"], row["n_raters_with_value"]) == (
        5, "all_equal", 2, 2
    )  # fmt: skip
    assert (row["consensus_method"], row["consensus_by"], row["consensus_rationale"]) == (
        "no_conflict", "Member A", APPROVE_ALL_RATIONALE
    )  # fmt: skip


def test_rows_are_coordinates_with_a_reviewer_cell_in_data_order() -> None:
    cells = {
        **_cells(_DOSE, a=make_cell({"value": 1}, actor_id=_A)),
        **_cells(_AGE, b=make_cell({"value": 2}, actor_id=_B)),
    }
    # A consensus-only coordinate is not a Verification row.
    only_consensus = value_key(_RUN, uuid4(), _DOSE.field_id)
    cells[only_consensus] = make_cell({"value": 3}, kind="manual_override")
    rows = _table(_layout(cells=cells, value_map=_values(cells)))
    assert [r["field_code"] for r in rows] == ["study.age", "study.dose"]


def test_rejected_reviewer_cell_has_no_value() -> None:
    cells = _cells(
        _DOSE,
        a=make_cell({"value": 5}, actor_id=_A),
        b=make_cell({"value": 9}, kind="reject", actor_id=_B, link=ai_link(9)),
    )
    vm = {
        **_values(cells),
        value_key(_RUN, _INST, _DOSE.field_id, _B): export_value("rejected"),
    }
    (row,) = _table(_layout(cells=cells, value_map=vm))
    assert (row["Member B"], row["match"], row["n_raters_with_value"]) == (
        None, "incomplete", 1
    )  # fmt: skip


def _ai_row(value: int, at: datetime, **over: Any) -> AIProposalRow:
    base: dict[str, Any] = {
        "article_id": _ART.article_id,
        "instance_id": _INST,
        "field_id": _DOSE.field_id,
        "ai_proposal_id": uuid4(),
        "created_at": at,
        "engine": EngineFacts("openai", "gpt-4o", "v2"),
        "value": export_value(value_num=value),
        "confidence": None,
        "rationale": None,
        "evidence_quote": "",
        "page": "",
    }
    return AIProposalRow(**{**base, **over})


def test_ai_column_is_the_latest_current_run_proposal() -> None:
    t0 = datetime(2026, 5, 1, tzinfo=UTC)
    # A newer proposal of a previous run, in scope only because reviewer A links it.
    old_run_link = ai_link(99)
    newer_foreign = _ai_row(99, t0 + timedelta(days=9), ai_proposal_id=old_run_link.id)
    cells = _cells(
        _DOSE,
        a=make_cell({"value": 99}, actor_id=_A, link=old_run_link),
        b=make_cell({"value": 7}, actor_id=_B),
    )
    rows = (
        _ai_row(6, t0),
        _ai_row(7, t0 + timedelta(days=1)),
        newer_foreign,
    )
    layout = _layout(
        cells=cells, value_map=_values(cells), include_ai_metadata=True, ai_proposal_rows=rows
    )
    (row,) = _table(layout)
    assert row["AI"] == 7
    assert row["match"] == "conflict"


def test_ai_column_absent_without_ai_metadata() -> None:
    cells = _cells(_DOSE, a=make_cell({"value": 1}, actor_id=_A))
    header = [c.value for c in _spec(_layout(cells=cells, value_map=_values(cells))).rows[0]]
    assert "AI" not in header


def test_verification_absent_outside_all_users() -> None:
    layout = make_layout(mode=ExportMode.CONSENSUS)
    titles = allocate_titles(layout, ExportShape.COMPLETE, include_matrix=True)
    assert build_verification(layout, titles) is None


def test_verification_absent_outside_complete() -> None:
    layout = _layout()
    titles = allocate_titles(layout, ExportShape.PUBLICATION, include_matrix=False)
    assert build_verification(layout, titles) is None


def test_verification_sits_between_data_and_ai_proposals() -> None:
    layout = _layout(include_ai_metadata=True)
    order = allocate_titles(layout, ExportShape.COMPLETE, include_matrix=True).order
    assert order[order.index("Data") + 1 : order.index("Data") + 3] == (
        "Verification", "AI proposals"
    )  # fmt: skip


def test_agreement_counts_all_equal_over_rows_with_two_raters() -> None:
    cells = {
        **_cells(
            _DOSE,
            a=make_cell({"value": 1}, actor_id=_A),
            b=make_cell({"value": 1}, actor_id=_B),
        ),
        **_cells(
            _AGE,
            a=make_cell({"value": 1}, actor_id=_A),
            b=make_cell({"value": 2}, actor_id=_B),
        ),
    }
    lone_run, lone_inst = uuid4(), uuid4()
    lone = ArticleDescriptor(
        uuid4(), "Doe 2021", lone_run, None, entries={(_STUDY.entity_type_id, None): (lone_inst,)}
    )
    cells[value_key(lone_run, lone_inst, _DOSE.field_id, _A)] = make_cell({"value": 1})
    layout = _layout(
        articles=(_ART, lone),
        cells=cells,
        value_map=_values(cells),
        raters_by_run={_RUN: (_A, _B), lone_run: (_A,)},
    )
    assert agreement(layout) == (1, 2)
