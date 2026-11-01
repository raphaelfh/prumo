"""Canonical equality against the run's pinned field, with the both-sides fallback."""

from app.services.exports.values import canonical_equal, canonical_keys
from tests.unit.helpers.export_layouts import make_run_view_field as _field


def test_number_string_and_int_are_equal() -> None:
    assert canonical_equal({"value": "7394"}, {"value": 7394}, _field(field_type="number"))


def test_multiselect_compares_as_set_under_pinned_options() -> None:
    f = _field(
        field_type="multiselect",
        allowed_values=[{"value": "a", "label": "A"}, {"value": "b", "label": "B"}],
    )
    assert canonical_equal({"value": ["b", "a"]}, {"value": ["a", "b"]}, f)


def test_option_removed_in_later_version_falls_back_to_peeled_raw() -> None:
    v2 = _field(field_type="multiselect", allowed_values=[{"value": "a", "label": "A"}])
    assert not canonical_equal({"value": ["b", "a"]}, {"value": ["a", "b"]}, v2)


def test_one_side_raising_compares_both_peeled() -> None:
    f = _field(field_type="number")
    assert canonical_keys(({"value": 7}, {"value": "x"}), f) == (
        canonical_keys(({"value": 7},), None)[0],
        canonical_keys(({"value": "x"},), None)[0],
    )


def test_verification_sibling_is_ignored() -> None:
    assert canonical_equal(
        {"value": "x", "verification": {"verdict": "ok"}},
        {"value": "x"},
        _field(field_type="text"),
    )


def test_absent_marker_compares_by_code_even_when_field_disallows_it() -> None:
    f = _field(field_type="text", allows_not_applicable=False)
    assert not canonical_equal(
        {"value": None, "absent_reason": "not_applicable"},
        {"value": None, "absent_reason": "no_information"},
        f,
    )
