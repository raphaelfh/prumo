"""Origin rules (spec §7, simple variant): reviewer cells and consensus rows."""

from __future__ import annotations

from datetime import date

from app.services.exports.extraction.data_sheet import (
    LINEAGE_EXACT_SINCE,
    consensus_origin_of,
    origin_of,
)
from app.services.run_lifecycle_service import APPROVE_ALL_RATIONALE
from tests.unit.helpers.export_layouts import ai_link, make_cell, make_run_view_field

_num = make_run_view_field(field_type="number")


def test_linked_equal_is_ai_accepted():
    assert origin_of(make_cell({"value": 42}, link=ai_link(42)), _num) == "ai_accepted"


def test_legacy_accept_proposal_is_ai_accepted():
    cell = make_cell({"value": 42}, kind="accept_proposal", link=ai_link(42))
    assert origin_of(cell, _num) == "ai_accepted"


def test_linked_different_is_ai_edited():
    assert origin_of(make_cell({"value": 43}, link=ai_link(42)), _num) == "ai_edited"


def test_unlinked_is_human():
    assert origin_of(make_cell({"value": 42}), _num) == "human"


def test_system_link_is_human():
    cell = make_cell({"value": 42}, link=ai_link(42, source="system"))
    assert origin_of(cell, _num) == "human"


def test_unfilled_cell_is_human():
    assert origin_of(make_cell(None, kind="reject", link=ai_link(42)), _num) == "human"


def test_v1_pinned_options_keep_ai_accepted():
    v1 = make_run_view_field(
        field_type="multiselect",
        allowed_values=[{"value": "a", "label": "A"}, {"value": "b", "label": "B"}],
    )
    assert origin_of(make_cell({"value": ["a", "b"]}, link=ai_link(["b", "a"])), v1) == (
        "ai_accepted"
    )


def test_approve_all_with_agreeing_origins_is_no_conflict():
    c = make_cell({"value": 42}, kind="manual_override", rationale=APPROVE_ALL_RATIONALE)
    reviewers = [make_cell({"value": 42}, link=ai_link(42))] * 2
    assert consensus_origin_of(c, reviewers, _num) == ("ai_accepted", "no_conflict")


def test_approve_all_with_differing_origins_is_mixed():
    c = make_cell({"value": 42}, kind="manual_override", rationale=APPROVE_ALL_RATIONALE)
    reviewers = [make_cell({"value": 42}, link=ai_link(42)), make_cell({"value": 42})]
    assert consensus_origin_of(c, reviewers, _num) == ("mixed", "no_conflict")


def test_approve_all_ignores_unfilled_reviewer_cells():
    c = make_cell({"value": 42}, kind="manual_override", rationale=APPROVE_ALL_RATIONALE)
    reviewers = [make_cell({"value": 42}, link=ai_link(42)), make_cell(None, kind="reject")]
    assert consensus_origin_of(c, reviewers, _num) == ("ai_accepted", "no_conflict")


def test_typed_override_is_human_override():
    c = make_cell({"value": 50}, kind="manual_override", rationale="typo")
    assert consensus_origin_of(c, [], _num) == ("human", "override")


def test_select_existing_takes_the_selected_link():
    c = make_cell({"value": 42}, kind="select_existing", link=ai_link(42))
    assert consensus_origin_of(c, [make_cell({"value": 42})], _num) == (
        "ai_accepted",
        "select_existing",
    )


def test_lineage_exact_since_is_pr2_prod_date():
    assert date(2026, 10, 31) == LINEAGE_EXACT_SINCE
