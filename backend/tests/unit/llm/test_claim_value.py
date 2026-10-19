"""value_str_for_claim / option_label_map — unit tests (pure, no IO).

Guards the fix for the "Not supported" attribution bug: a select/boolean field
stores the option CODE ("Y"), and the entailment judge must receive the human
LABEL ("Yes") so the claim is interpretable. Numeric/date/text must pass
through unchanged so the deterministic numeric check still works.
"""

import pytest

from app.llm.claim_value import normalize_options, option_label_map, value_str_for_claim
from app.schemas.template_structure import OptionItem

CANONICAL = [{"value": "Y", "label": "Yes"}, {"value": "N", "label": "No"}]


class TestNormalizeOptions:
    @pytest.mark.parametrize(
        "raw",
        [
            ["Y", "N"],
            {"options": ["Y", "N"]},
            {"options": [{"value": "Y"}, {"value": "N"}]},
        ],
        ids=["bare-strings", "wrapper-of-strings", "wrapper-of-label-less-dicts"],
    )
    def test_legacy_shapes_read_canonical(self, raw: object) -> None:
        assert normalize_options(raw) == [
            {"value": "Y", "label": "Y"},
            {"value": "N", "label": "N"},
        ]

    def test_canonical_is_unchanged(self) -> None:
        assert normalize_options(CANONICAL) == CANONICAL

    def test_mixed_list_and_label_only(self) -> None:
        assert normalize_options(
            ["Y", {"value": "NI", "label": "No information"}, {"label": "Z"}]
        ) == [
            {"value": "Y", "label": "Y"},
            {"value": "NI", "label": "No information"},
            {"value": "Z", "label": "Z"},
        ]

    def test_objects_with_attributes_are_read(self) -> None:
        assert normalize_options([OptionItem(value="dev", label="Development")]) == [
            {"value": "dev", "label": "Development"}
        ]

    def test_junk_is_skipped(self) -> None:
        assert normalize_options(None) == []
        assert normalize_options("x") == []
        assert normalize_options([None, 3, "", {}, {"value": ""}]) == []


class TestOptionLabelMap:
    def test_options_dict_shape_with_labels(self) -> None:
        allowed = {"options": [{"value": "Y", "label": "Yes"}, {"value": "N", "label": "No"}]}
        assert option_label_map(allowed) == {"Y": "Yes", "N": "No"}

    def test_plain_string_options_map_to_themselves(self) -> None:
        assert option_label_map(["Case series", "Registry"]) == {
            "Case series": "Case series",
            "Registry": "Registry",
        }

    def test_dict_without_label_falls_back_to_value(self) -> None:
        assert option_label_map([{"value": "Y"}]) == {"Y": "Y"}

    def test_none_or_unknown_shape_is_empty(self) -> None:
        assert option_label_map(None) == {}
        assert option_label_map("nonsense") == {}
        assert option_label_map({}) == {}


class TestValueStrForClaim:
    def test_select_code_resolves_to_label(self) -> None:
        """The core bug: a select CODE 'Y' must become 'Yes' for the judge."""
        allowed = {"options": [{"value": "Y", "label": "Yes"}]}
        assert value_str_for_claim(field_type="select", allowed_values=allowed, value="Y") == "Yes"

    def test_select_unknown_code_falls_back_to_raw(self) -> None:
        """allow_other free text (not in the option map) keeps its raw value."""
        allowed = {"options": [{"value": "Y", "label": "Yes"}]}
        assert (
            value_str_for_claim(field_type="select", allowed_values=allowed, value="other text")
            == "other text"
        )

    def test_multiselect_joins_labels(self) -> None:
        allowed = {"options": [{"value": "A", "label": "Alpha"}, {"value": "B", "label": "Beta"}]}
        assert (
            value_str_for_claim(field_type="multiselect", allowed_values=allowed, value=["A", "B"])
            == "Alpha, Beta"
        )

    def test_boolean_renders_yes_no(self) -> None:
        assert value_str_for_claim(field_type="boolean", allowed_values=None, value=True) == "Yes"
        assert value_str_for_claim(field_type="boolean", allowed_values=None, value=False) == "No"

    def test_numeric_passes_through_unchanged(self) -> None:
        """Numbers must NOT be remapped — the deterministic numeric check needs the raw form."""
        assert value_str_for_claim(field_type="number", allowed_values=None, value=287) == "287"
        assert value_str_for_claim(field_type="number", allowed_values=None, value=11.8) == "11.8"

    def test_text_passes_through_unchanged(self) -> None:
        assert (
            value_str_for_claim(field_type="text", allowed_values=None, value="Case series")
            == "Case series"
        )

    def test_string_options_select_is_identity(self) -> None:
        """A select whose options are plain label strings resolves to itself."""
        assert (
            value_str_for_claim(
                field_type="select", allowed_values=["Case series"], value="Case series"
            )
            == "Case series"
        )

    def test_missing_field_type_falls_back_to_str(self) -> None:
        assert value_str_for_claim(field_type=None, allowed_values=None, value="Y") == "Y"
