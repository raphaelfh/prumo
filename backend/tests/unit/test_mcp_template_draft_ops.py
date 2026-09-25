from uuid import uuid4

import pytest
from pydantic import ValidationError

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
