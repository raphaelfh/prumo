"""The Data sheet (spec §4.1): one row per (article, instance, field, rater)."""

from __future__ import annotations

from dataclasses import replace
from datetime import UTC, datetime, timedelta, timezone
from typing import Any
from uuid import uuid4

from app.models.extraction import ExtractionCardinality, ExtractionFieldType
from app.services.exports.descriptors import value_key
from app.services.exports.extraction.data_sheet import (
    DATA_COLUMNS,
    DataRow,
    build_data_sheet,
    data_rows,
    origin_counts,
)
from app.services.exports.extraction.workbook import ExportShape, allocate_titles
from app.services.extraction_export_service import (
    ArticleDescriptor,
    ExportLayout,
    ExportMode,
    FieldDescriptor,
    SectionDescriptor,
)
from app.services.run_lifecycle_service import APPROVE_ALL_RATIONALE
from tests.unit.helpers.export_layouts import ai_link, export_value, make_cell, make_layout

_RUN = uuid4()
_INST = uuid4()
_TXT = FieldDescriptor(uuid4(), "Text", ExtractionFieldType.TEXT, (), name="txt")
_FLAG = FieldDescriptor(uuid4(), "Flag", ExtractionFieldType.BOOLEAN, (), name="flag")
_STUDY = SectionDescriptor(uuid4(), "Study", None, (_TXT, _FLAG), name="study")
_ART = ArticleDescriptor(
    uuid4(), "Smith 2020", _RUN, None, entries={(_STUDY.entity_type_id, None): (_INST,)}
)
_A, _B = uuid4(), uuid4()


def _layout(**over: Any) -> ExportLayout:
    return make_layout(sections=(_STUDY,), articles=(_ART,), **over)


def _rows(layout: ExportLayout) -> tuple[DataRow, ...]:
    return data_rows(layout, allocate_titles(layout, ExportShape.COMPLETE, include_matrix=True))


def _row(r: DataRow) -> dict[str, Any]:
    return dict(zip(DATA_COLUMNS, r, strict=True))


def _only(layout: ExportLayout) -> dict[str, Any]:
    (r,) = _rows(layout)
    return _row(r)


def test_columns_are_the_machine_contract() -> None:
    assert DATA_COLUMNS[:10] == (
        "article_id", "article_label", "sheet", "record_id", "parent_record_id",
        "instance_id", "record_label", "field_id", "field_code", "rater",
    )  # fmt: skip
    assert DATA_COLUMNS[10:] == (
        "status", "value_num", "value_text", "value_bool", "value_label", "unit",
        "other_text", "absent_code", "out_of_scope", "origin", "ai_proposed",
        "ai_proposal_id", "decided_by", "decided_at", "rationale",
        "consensus_method", "n_raters_with_value",
    )  # fmt: skip


def test_root_row_keys_join_the_articles_sheet() -> None:
    k = value_key(_RUN, _INST, _TXT.field_id)
    r = _only(
        _layout(value_map={k: export_value(value_text="x")}, cells={k: make_cell({"value": "x"})})
    )
    assert (r["article_id"], r["article_label"], r["sheet"]) == (
        str(_ART.article_id), "Smith 2020", "Articles"
    )  # fmt: skip
    assert (r["record_id"], r["parent_record_id"]) == (str(_ART.article_id), None)
    assert (r["instance_id"], r["field_id"], r["field_code"]) == (
        str(_INST), str(_TXT.field_id), "study.txt"
    )  # fmt: skip
    assert (r["rater"], r["value_text"]) == ("consensus", "x")


def test_stamp_row() -> None:
    stamp = export_value("absent", absent_code="not_applicable", out_of_scope=True)
    r = _only(_layout(value_map={value_key(_RUN, _INST, _TXT.field_id): stamp}))
    assert (r["status"], r["absent_code"], r["out_of_scope"], r["origin"]) == (
        "absent", "not_applicable", True, "rule"
    )  # fmt: skip


def test_unlinked_with_ai_proposal_is_human_and_ai_proposed() -> None:
    k = value_key(_RUN, _INST, _TXT.field_id)
    r = _only(
        _layout(
            value_map={k: export_value(value_text="x")},
            cells={k: make_cell({"value": "x"}, kind="manual_override")},
            ai_proposed=frozenset({(_ART.article_id, _INST, _TXT.field_id)}),
        )
    )
    assert (r["origin"], r["ai_proposed"], r["ai_proposal_id"]) == ("human", True, None)


def test_linked_ai_proposal_fills_id_and_ai_proposed() -> None:
    k = value_key(_RUN, _INST, _TXT.field_id, _A)
    link = ai_link("x")
    r = _only(
        _layout(
            mode=ExportMode.SINGLE_USER,
            reviewer_id=_A,
            value_map={k: export_value(value_text="x")},
            cells={k: make_cell({"value": "x"}, actor_id=_A, link=link)},
        )
    )
    assert (r["origin"], r["ai_proposed"], r["ai_proposal_id"]) == (
        "ai_accepted", True, str(link.id)
    )  # fmt: skip


def test_system_link_leaves_ai_columns_unset() -> None:
    k = value_key(_RUN, _INST, _TXT.field_id, _A)
    r = _only(
        _layout(
            mode=ExportMode.SINGLE_USER,
            reviewer_id=_A,
            value_map={k: export_value(value_text="x")},
            cells={k: make_cell({"value": "x"}, actor_id=_A, link=ai_link("x", source="system"))},
        )
    )
    assert (r["origin"], r["ai_proposed"], r["ai_proposal_id"]) == ("human", False, None)


def _all_users(**over: Any) -> ExportLayout:
    ka, kb, kc = (value_key(_RUN, _INST, _TXT.field_id, r) for r in (_A, _B, None))
    cells = {
        ka: make_cell({"value": "x"}, actor_id=_A),
        kb: make_cell({"value": "x"}, actor_id=_B),
        kc: make_cell({"value": "x"}, kind="manual_override", rationale=APPROVE_ALL_RATIONALE),
    }
    return _layout(
        mode=ExportMode.ALL_USERS,
        value_map={k: export_value(value_text="x") for k in cells},
        cells=cells,
        raters_by_run={_RUN: (_A, _B)},
        rater_labels={_A: "Member A", _B: "Member B"},
        **over,
    )


def test_consensus_row_has_method_and_n_raters_with_value() -> None:
    r = _row(_rows(_all_users())[0])
    assert (r["rater"], r["consensus_method"], r["n_raters_with_value"]) == (
        "consensus", "no_conflict", 2
    )  # fmt: skip
    assert r["origin"] == "human" and r["rationale"] == APPROVE_ALL_RATIONALE


def test_reviewer_row_leaves_consensus_columns_blank() -> None:
    r = _row(_rows(_all_users())[1])
    assert r["rater"] == "Member A"
    assert (r["consensus_method"], r["n_raters_with_value"]) == (None, None)


def test_consensus_sorts_before_reviewers_by_rater() -> None:
    assert [_row(r)["rater"] for r in _rows(_all_users())] == ["consensus", "Member A", "Member B"]


def test_decided_by_reads_the_rater_label_map() -> None:
    assert [_row(r)["decided_by"] for r in _rows(_all_users())][1:] == ["Member A", "Member B"]


def test_section_outside_active_tree_leaves_sheet_blank() -> None:
    """Guard: never "Articles" for an instance whose section is not active."""
    gone, iid = uuid4(), uuid4()
    art = ArticleDescriptor(
        uuid4(), "Smith 2020", _RUN, None,
        entries={(_STUDY.entity_type_id, None): (_INST,), (gone, None): (iid,)},
    )  # fmt: skip
    k = value_key(_RUN, iid, _TXT.field_id)
    layout = make_layout(
        sections=(_STUDY,), articles=(art,),
        value_map={k: export_value(value_text="x")}, cells={k: make_cell({"value": "x"})},
    )  # fmt: skip
    r = _only(layout)
    assert r["sheet"] in (None, "") and r["record_label"] == ""


def test_field_not_in_the_instance_section_leaves_sheet_blank() -> None:
    removed = uuid4()
    k = value_key(_RUN, _INST, removed)
    r = _only(_layout(value_map={k: export_value(value_text="x")}, cells={k: make_cell({})}))
    assert r["sheet"] in (None, "") and r["record_label"] == ""


def test_level_record_keys_and_label() -> None:
    dose = FieldDescriptor(uuid4(), "Dose", ExtractionFieldType.TEXT, (), name="dose")
    arm = SectionDescriptor(
        uuid4(), "Arm", None, (dose,), cardinality=ExtractionCardinality.MANY, name="arm"
    )
    a1, a2 = uuid4(), uuid4()
    art = ArticleDescriptor(
        uuid4(), "Smith 2020", _RUN, None, entries={(arm.entity_type_id, None): (a1, a2)}
    )
    k = value_key(_RUN, a2, dose.field_id)
    layout = make_layout(
        sections=(arm,), articles=(art,),
        value_map={k: export_value(value_text="5")}, cells={k: make_cell({"value": "5"})},
    )  # fmt: skip
    r = _only(layout)
    assert (r["sheet"], r["record_id"], r["parent_record_id"], r["record_label"]) == (
        "arm", str(a2), str(art.article_id), "Arm 2"
    )  # fmt: skip


def test_rejected_vs_cleared() -> None:
    k1, k2 = value_key(_RUN, _INST, _TXT.field_id), value_key(_RUN, _INST, _FLAG.field_id)
    layout = _layout(
        value_map={k1: export_value("rejected"), k2: export_value("cleared")},
        cells={k1: make_cell(None, kind="reject"), k2: make_cell({"value": None})},
    )
    assert {_row(r)["status"] for r in _rows(layout)} == {"rejected", "cleared"}


def test_boolean_goes_to_value_bool() -> None:
    """D3: an Excel boolean, never "false" text."""
    k = value_key(_RUN, _INST, _FLAG.field_id)
    r = _only(
        _layout(
            value_map={k: export_value(value_bool=False)}, cells={k: make_cell({"value": False})}
        )
    )
    assert (r["value_bool"], r["value_text"]) == (False, None)


def test_decided_at_is_naive_utc_datetime() -> None:
    k = value_key(_RUN, _INST, _TXT.field_id)
    aware = datetime(2026, 5, 1, 12, 0, tzinfo=timezone(timedelta(hours=-3)))
    cell = make_cell({"value": "x"}, kind="manual_override")
    cell = replace(cell, decision=replace(cell.decision, created_at=aware))
    r = _only(_layout(value_map={k: export_value(value_text="x")}, cells={k: cell}))
    assert r["decided_at"] == aware.astimezone(UTC).replace(tzinfo=None)
    assert r["decided_at"].tzinfo is None


def test_single_user_rows_carry_the_reviewer_label() -> None:
    """R1: the reviewer slot, labelled from the project map."""
    rid = uuid4()
    k = value_key(_RUN, _INST, _TXT.field_id, rid)
    layout = _layout(
        mode=ExportMode.SINGLE_USER,
        reviewer_id=rid,
        value_map={k: export_value(value_text="x")},
        cells={k: make_cell({"value": "x"}, actor_id=rid)},
        rater_labels={rid: "Member A"},
    )
    assert _only(layout)["rater"] == "Member A"


def test_rows_follow_article_order_then_field_code() -> None:
    other_run, other_inst = uuid4(), uuid4()
    first = ArticleDescriptor(
        uuid4(), "Adams 2019", other_run, None,
        entries={(_STUDY.entity_type_id, None): (other_inst,)},
    )  # fmt: skip
    keys = [
        value_key(_RUN, _INST, _TXT.field_id),
        value_key(_RUN, _INST, _FLAG.field_id),
        value_key(other_run, other_inst, _TXT.field_id),
    ]
    layout = make_layout(
        sections=(_STUDY,),
        articles=(first, _ART),
        value_map={k: export_value(value_text="x") for k in keys},
    )
    got = [(_row(r)["article_label"], _row(r)["field_code"]) for r in _rows(layout)]
    assert got == [
        ("Adams 2019", "study.txt"), ("Smith 2020", "study.flag"), ("Smith 2020", "study.txt")
    ]  # fmt: skip


def test_build_data_sheet_has_one_header_row_and_freezes_a2() -> None:
    k = value_key(_RUN, _INST, _TXT.field_id)
    layout = _layout(
        value_map={k: export_value(value_text="x")}, cells={k: make_cell({"value": "x"})}
    )
    spec = build_data_sheet(
        layout, allocate_titles(layout, ExportShape.COMPLETE, include_matrix=True)
    )
    assert spec is not None
    assert (spec.title, spec.freeze, len(spec.rows)) == ("Data", "A2", 2)
    assert tuple(c.value for c in spec.rows[0]) == DATA_COLUMNS


def test_build_data_sheet_is_absent_outside_complete() -> None:
    layout = _layout()
    titles = allocate_titles(layout, ExportShape.PUBLICATION, include_matrix=False)
    assert build_data_sheet(layout, titles) is None


def test_origin_counts_read_the_primary_slot() -> None:
    counts = origin_counts(_all_users())
    assert dict(counts) == {"human": 1}
