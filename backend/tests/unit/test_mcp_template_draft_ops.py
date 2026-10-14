from uuid import uuid4

import pytest
from pydantic import ValidationError

from app.api.mcp.draft_diff import DIFF_ROW_CAP, capped_diff
from app.api.mcp.errors import validation_failure
from app.core.config import Settings
from app.schemas.hitl_session import TemplateConfigDiffRead
from app.schemas.mcp_template_draft import AddQuestionOp, UpdateQuestionOp

_SECTION_ID = uuid4()
_FIELD_ID = uuid4()


def _base_add(**overrides: object) -> dict[str, object]:
    payload: dict[str, object] = {
        "op": "add_question",
        "section_id": _SECTION_ID,
        "label": "Follow-up",
        "type": "text",
    }
    payload.update(overrides)
    return payload


@pytest.mark.parametrize(
    ("overrides", "loc"),
    [
        ({"label": "x" * 101}, ("label",)),
        ({"type": "rating"}, ("type",)),
        ({"type": "text", "options": ["a"]}, ("options",)),
        ({"type": "select"}, ("options",)),
        ({"options": ["a", "a"], "type": "select"}, ("options",)),
        ({"instructions": "x" * 1001}, ("instructions",)),
        ({"name": "smuggled"}, ("name",)),
    ],
)
def test_add_question_op_invalid_cases(overrides: dict[str, object], loc: tuple[str, ...]) -> None:
    with pytest.raises(ValidationError) as exc_info:
        AddQuestionOp(**_base_add(**overrides))
    assert exc_info.value.errors()[0]["loc"] == loc


def test_add_question_op_multiselect_with_options_is_valid() -> None:
    op = AddQuestionOp(**_base_add(type="multiselect", options=["a", "b"]))
    assert op.type == "multiselect"
    assert op.options == ["a", "b"]


def test_add_question_op_date_with_no_options_is_valid() -> None:
    op = AddQuestionOp(**_base_add(type="date"))
    assert op.type == "date"
    assert op.options is None


def test_update_question_op_label_null_is_invalid() -> None:
    with pytest.raises(ValidationError) as exc_info:
        UpdateQuestionOp(op="update_question", field_id=_FIELD_ID, label=None)
    assert exc_info.value.errors()[0]["loc"] == ("label",)


def test_update_question_op_description_and_instructions_null_clear() -> None:
    op = UpdateQuestionOp(
        op="update_question", field_id=_FIELD_ID, description=None, instructions=None
    )
    dumped = op.model_dump(exclude_unset=True)
    assert dumped["description"] is None
    assert dumped["instructions"] is None
    assert "label" not in dumped


def test_update_question_op_description_too_long_is_invalid() -> None:
    with pytest.raises(ValidationError) as exc_info:
        UpdateQuestionOp(op="update_question", field_id=_FIELD_ID, description="x" * 501)
    assert exc_info.value.errors()[0]["loc"] == ("description",)


def test_select_without_options_message_has_no_pydantic_prefix() -> None:
    # Regression guard: validation_failure (task 1.7) strips "Value error, ".
    with pytest.raises(ValidationError) as exc_info:
        AddQuestionOp(**_base_add(type="select"))
    error = validation_failure(exc_info.value, op_index=0)
    assert error.extras["field"] == "options"
    assert not error.message.startswith("Value error,")
    assert error.message == "options are required for select and multiselect questions"


def _diff_with_additive_rows(count: int) -> TemplateConfigDiffRead:
    rows = [
        {
            "id": f"added:entity_type:{i}::",
            "variant": "entity_type_added",
            "tier": "additive",
            "label_path": [f"Section {i}"],
            "after": "x" * 500,
        }
        for i in range(count)
    ]
    return TemplateConfigDiffRead.model_validate(
        {
            "project_template_id": uuid4(),
            "status": "available",
            "changes": {"additive": rows},
            "fingerprint": "fp",
        }
    )


def test_capped_diff_caps_rows_and_truncates_values() -> None:
    capped = capped_diff(_diff_with_additive_rows(DIFF_ROW_CAP + 5))
    assert len(capped.changes) == DIFF_ROW_CAP
    assert capped.changes_truncated is True
    assert capped.counts["additive"] == DIFF_ROW_CAP + 5
    assert capped.changes[0].after == "x" * 200


def test_capped_diff_under_the_cap_is_not_truncated() -> None:
    capped = capped_diff(_diff_with_additive_rows(2))
    assert len(capped.changes) == 2
    assert capped.changes_truncated is False


def test_public_app_url_defaults_to_the_production_frontend_origin() -> None:
    assert Settings.model_fields["PUBLIC_APP_URL"].default == "https://prumoai.vercel.app"
