"""The project-details whitelist: exactly the 11 descriptive columns, typed."""

from __future__ import annotations

from typing import Any, get_args

import pytest
from pydantic import ValidationError

from app.models.base import POSTGRESQL_ENUM_VALUES
from app.schemas.project_details import (
    ProjectDetailsExpected,
    ProjectDetailsFields,
    ProjectDetailsRead,
    ProjectDetailsUpdate,
    ProjectDetailsValues,
    ReviewTypeValue,
)
from app.schemas.project_protocol import (
    EligibilityCriteria,
    PicotsSlotKey,
    PicotsSlotsWrite,
    StudyDesign,
)

_ELEVEN = {
    "name",
    "description",
    "review_type",
    "review_title",
    "condition_studied",
    "review_rationale",
    "search_strategy",
    "eligibility_criteria",
    "study_design",
    "review_keywords",
    "review_context",
}


def test_review_type_values_match_the_postgres_enum() -> None:
    # The schema layer cannot import models, so this pins the copy.
    assert set(get_args(ReviewTypeValue)) == set(POSTGRESQL_ENUM_VALUES["review_type"])


def test_editable_columns_are_exactly_the_eleven() -> None:
    assert set(ProjectDetailsFields.model_fields) == _ELEVEN
    assert set(ProjectDetailsValues.model_fields) == _ELEVEN
    assert set(ProjectDetailsRead.model_fields) - {"updated_at"} == _ELEVEN


@pytest.mark.parametrize(
    "key", ["picots_config_ai_review", "settings", "is_active", "created_by_id"]
)
def test_unknown_key_is_refused(key: str) -> None:
    with pytest.raises(ValidationError) as info:
        ProjectDetailsFields.model_validate({key: "x"})
    assert info.value.errors()[0]["type"] == "extra_forbidden"


@pytest.mark.parametrize(
    ("payload", "loc"),
    [
        ({"name": ""}, ("name",)),
        ({"name": None}, ("name",)),
        ({"review_type": "meta"}, ("review_type",)),
        ({"review_keywords": "x"}, ("review_keywords",)),
        ({"eligibility_criteria": None}, ("eligibility_criteria",)),
        ({"study_design": None}, ("study_design",)),
        ({"review_keywords": None}, ("review_keywords",)),
    ],
    ids=[
        "empty-name",
        "null-name",
        "bad-review-type",
        "keywords-not-list",
        "null-eligibility",
        "null-study-design",
        "null-keywords",
    ],
)
def test_invalid_values_name_their_field(payload: dict[str, Any], loc: tuple[str, ...]) -> None:
    with pytest.raises(ValidationError) as info:
        ProjectDetailsFields.model_validate(payload)
    assert info.value.errors()[0]["loc"] == loc


def test_nullable_columns_accept_null() -> None:
    payload = {"description": None, "review_type": None, "review_context": None}
    fields = ProjectDetailsFields.model_validate(payload)
    assert fields.model_dump(mode="json", exclude_unset=True) == payload


def test_update_requires_expected_for_every_changed_key() -> None:
    with pytest.raises(ValidationError, match="description"):
        ProjectDetailsUpdate.model_validate(
            {"fields": {"name": "a", "description": "b"}, "expected": {"name": "x"}}
        )


def test_update_requires_at_least_one_field() -> None:
    with pytest.raises(ValidationError, match="at least one"):
        ProjectDetailsUpdate.model_validate({"fields": {}, "expected": {}})


# --- Typed protocol shapes (eligibility, study design, PICOTS writes) ---


def test_eligibility_accepts_a_partial_shape() -> None:
    parsed = EligibilityCriteria.model_validate({"inclusion": []})
    assert parsed.model_dump(exclude_unset=True) == {"inclusion": []}


@pytest.mark.parametrize(
    "payload",
    [
        {"inclusion": [], "extra": 1},
        {"inclusion": ["x"] * 51},
        {"exclusion": ["x" * 501]},
        {"inclusion": [""]},
        {"notes": "x" * 2001},
    ],
    ids=["unknown-key", "51-items", "501-char-item", "empty-item", "2001-char-notes"],
)
def test_eligibility_bounds_are_enforced(payload: dict[str, Any]) -> None:
    with pytest.raises(ValidationError):
        EligibilityCriteria.model_validate(payload)


def test_study_design_refuses_31_types() -> None:
    assert StudyDesign.model_validate({"types": ["rct"] * 30}).types == ["rct"] * 30
    with pytest.raises(ValidationError):
        StudyDesign.model_validate({"types": ["rct"] * 31})


def test_fields_refuse_an_unknown_eligibility_key_naming_the_column() -> None:
    with pytest.raises(ValidationError) as info:
        ProjectDetailsFields(eligibility_criteria={"inclusion": ["x"], "extra": 1})  # type: ignore[arg-type]
    assert info.value.errors()[0]["loc"][0] == "eligibility_criteria"


def test_fields_dump_keeps_a_partial_eligibility_partial() -> None:
    fields = ProjectDetailsFields.model_validate({"eligibility_criteria": {"inclusion": ["a"]}})
    assert fields.model_dump(mode="json", exclude_unset=True) == {
        "eligibility_criteria": {"inclusion": ["a"]}
    }


def test_expected_accepts_a_legacy_shape() -> None:
    expected = ProjectDetailsExpected(eligibility_criteria={"legacy": True})
    assert expected.model_dump(mode="json", exclude_unset=True) == {
        "eligibility_criteria": {"legacy": True}
    }


def test_expected_has_the_same_eleven_keys_and_refuses_unknown_ones() -> None:
    assert set(ProjectDetailsExpected.model_fields) == _ELEVEN
    with pytest.raises(ValidationError):
        ProjectDetailsExpected.model_validate({"settings": {}})


def test_update_accepts_a_legacy_expected_with_a_typed_field() -> None:
    update = ProjectDetailsUpdate.model_validate(
        {
            "fields": {"eligibility_criteria": {"inclusion": ["adults"]}},
            "expected": {"eligibility_criteria": {"legacy": "x"}},
        }
    )
    assert isinstance(update.expected, ProjectDetailsExpected)


@pytest.mark.parametrize(
    "payload",
    [{"population": {}, "intervention": {}}, {"population": {"description": "x" * 2001}}],
    ids=["unknown-slot", "2001-char-description"],
)
def test_picots_write_bounds(payload: dict[str, Any]) -> None:
    with pytest.raises(ValidationError):
        PicotsSlotsWrite.model_validate(payload)


def test_picots_write_fills_every_slot() -> None:
    parsed = PicotsSlotsWrite.model_validate({"population": {"description": "Adults"}})
    dumped = parsed.model_dump()
    assert set(dumped) == set(get_args(PicotsSlotKey))
    assert dumped["timing"] == {"description": "", "inclusion": [], "exclusion": []}
