"""The project-details whitelist: exactly the 11 descriptive columns, typed."""

from __future__ import annotations

from typing import Any, get_args

import pytest
from pydantic import ValidationError

from app.models.base import POSTGRESQL_ENUM_VALUES
from app.schemas.project_details import (
    ProjectDetailsFields,
    ProjectDetailsRead,
    ProjectDetailsUpdate,
    ProjectDetailsValues,
    ReviewTypeValue,
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
