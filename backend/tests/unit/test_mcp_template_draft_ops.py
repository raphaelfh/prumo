from datetime import UTC, datetime
from uuid import uuid4

import pytest
from pydantic import ValidationError

from app.api.mcp.draft_diff import DIFF_CHAR_BUDGET, DIFF_ROW_CAP, LABEL_CAP, capped_diff
from app.api.mcp.errors import validation_failure
from app.api.mcp.tools.template_draft import (
    _DESCRIPTION,
    _NEXT_STEP,
    MAX_OPS,
    _applied_reply,
)
from app.core.config import Settings
from app.schemas.hitl_session import TemplateConfigDiffRead
from app.schemas.mcp_template_draft import (
    AddQuestionOp,
    AddSectionOp,
    DeleteQuestionOp,
    DeleteSectionOp,
    EditTemplateDraftResult,
    McpLintCounts,
    MoveQuestionOp,
    OptionInput,
    ReorderQuestionsOp,
    SetInstructionOp,
    SetOptionsOp,
    UpdateQuestionOp,
    UpdateSectionOp,
)
from app.schemas.template_structure import OptionItem, SectionRead, TemplateFieldRead
from app.services.agent_template_draft_service import (
    AppliedDraftOp,
    OptionValueConflictError,
    _resolve_options,
)
from app.utils.compact_json import RESULT_CAP, compact_json
from app.utils.text_caps import cap_text

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
        ({"type": "text", "options": [{"label": "a"}]}, ("options",)),
        ({"type": "select"}, ("options",)),
        ({"options": [{"label": "a"}, {"label": "a"}], "type": "select"}, ("options",)),
        (
            {"options": [{"label": " Yes "}, {"value": "Yes", "label": "Again"}], "type": "select"},
            ("options",),
        ),
        ({"options": [{"label": "a", "extra": 1}], "type": "select"}, ("options", 0, "extra")),
        ({"instructions": "x" * 1001}, ("instructions",)),
        ({"name": "smuggled"}, ("name",)),
    ],
)
def test_add_question_op_invalid_cases(overrides: dict[str, object], loc: tuple[str, ...]) -> None:
    with pytest.raises(ValidationError) as exc_info:
        AddQuestionOp(**_base_add(**overrides))
    assert exc_info.value.errors()[0]["loc"] == loc


def test_add_question_op_multiselect_with_options_is_valid() -> None:
    op = AddQuestionOp(
        **_base_add(type="multiselect", options=[{"label": "Yes"}, {"value": "n", "label": "No"}])
    )
    assert op.type == "multiselect"
    assert op.options is not None
    assert [o.to_option_item() for o in op.options] == [
        OptionItem(value="Yes", label="Yes"),
        OptionItem(value="n", label="No"),
    ]


def test_add_question_op_missing_value_is_the_trimmed_label() -> None:
    op = AddQuestionOp(**_base_add(type="select", options=[{"label": " Yes "}]))
    assert op.options is not None
    assert op.options[0].to_option_item() == OptionItem(value="Yes", label=" Yes ")


def test_add_question_op_bare_string_options_are_invalid() -> None:
    with pytest.raises(ValidationError):
        AddQuestionOp(**_base_add(type="select", options=["a"]))


def test_duplicate_option_value_message_has_no_pydantic_prefix() -> None:
    with pytest.raises(ValidationError) as exc_info:
        AddQuestionOp(
            **_base_add(
                type="select", options=[{"label": "Yes"}, {"value": "Yes", "label": "Again"}]
            )
        )
    error = validation_failure(exc_info.value)
    assert error.extras["field"] == "options"
    assert error.message == "option values must be unique"


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
            "affects_ai": True,
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


def _pt_br_diff(count: int) -> TemplateConfigDiffRead:
    rows = [
        {
            "id": f"modified:field:{i}:llm_description:",
            "variant": "field_modified",
            "tier": "semantic",
            "label_path": ["Seção " + "ç" * 300, "Questão " + "ã" * 300],
            "attribute": "llm_description",
            "before": "ação " * 100,
            "after": "intervenção " * 100,
            "affects_ai": True,
        }
        for i in range(count)
    ]
    return TemplateConfigDiffRead.model_validate(
        {
            "project_template_id": uuid4(),
            "status": "available",
            "changes": {"semantic": rows},
            "fingerprint": "fp",
        }
    )


def test_capped_diff_budgets_serialized_chars_for_non_ascii_rows() -> None:
    capped = capped_diff(_pt_br_diff(DIFF_ROW_CAP), budget=10_000)
    assert len(compact_json(capped.model_dump(mode="json"))) <= 10_000
    assert 0 < len(capped.changes) < DIFF_ROW_CAP
    assert capped.changes_truncated is True
    assert capped.counts["semantic"] == DIFF_ROW_CAP


def test_capped_diff_truncates_label_path_elements() -> None:
    capped = capped_diff(_pt_br_diff(1))
    assert [len(label) for label in capped.changes[0].label_path] == [100, 100]


def test_capped_diff_default_budget_bounds_the_worst_case() -> None:
    capped = capped_diff(_pt_br_diff(DIFF_ROW_CAP))
    assert len(compact_json(capped.model_dump(mode="json"))) <= DIFF_CHAR_BUDGET


def test_tool_description_states_the_option_shape() -> None:
    assert "[{value?, label}]" in _DESCRIPTION
    assert "trimmed label" in _DESCRIPTION


def test_delete_question_op_validates() -> None:
    op = DeleteQuestionOp(op="delete_question", field_id=_FIELD_ID)
    assert op.field_id == _FIELD_ID


def test_move_question_op_validates() -> None:
    op = MoveQuestionOp(op="move_question", field_id=_FIELD_ID, section_id=_SECTION_ID, position=0)
    assert op.position == 0


def test_move_question_op_negative_position_is_invalid() -> None:
    with pytest.raises(ValidationError) as exc_info:
        MoveQuestionOp(op="move_question", field_id=_FIELD_ID, section_id=_SECTION_ID, position=-1)
    assert exc_info.value.errors()[0]["loc"] == ("position",)


def test_reorder_questions_op_validates() -> None:
    op = ReorderQuestionsOp(op="reorder_questions", section_id=_SECTION_ID, field_ids=[_FIELD_ID])
    assert op.field_ids == [_FIELD_ID]


def test_reorder_questions_op_empty_field_ids_is_invalid() -> None:
    with pytest.raises(ValidationError) as exc_info:
        ReorderQuestionsOp(op="reorder_questions", section_id=_SECTION_ID, field_ids=[])
    assert exc_info.value.errors()[0]["loc"] == ("field_ids",)


@pytest.mark.parametrize(
    ("model", "payload"),
    [
        (DeleteQuestionOp, {"op": "delete_question", "field_id": _FIELD_ID, "x": 1}),
        (
            MoveQuestionOp,
            {
                "op": "move_question",
                "field_id": _FIELD_ID,
                "section_id": _SECTION_ID,
                "position": 0,
                "x": 1,
            },
        ),
        (
            ReorderQuestionsOp,
            {
                "op": "reorder_questions",
                "section_id": _SECTION_ID,
                "field_ids": [_FIELD_ID],
                "x": 1,
            },
        ),
    ],
    ids=["delete", "move", "reorder"],
)
def test_new_ops_forbid_extra_keys(model: type, payload: dict[str, object]) -> None:
    with pytest.raises(ValidationError) as exc_info:
        model.model_validate(payload)
    assert exc_info.value.errors()[0]["loc"] == ("x",)


def test_tool_description_names_the_fingerprint_rule() -> None:
    for op in ("delete_question", "move_question", "reorder_questions"):
        assert op in _DESCRIPTION
    assert "expected_fingerprint" in _DESCRIPTION


def test_applied_reply_caps_every_text_leaf_so_a_full_batch_fits_the_result_cap() -> None:
    # Escape-heavy UI-written names and labels, far over any agent-side limit.
    long_text = '"' * 1000
    field = TemplateFieldRead(
        id=_FIELD_ID,
        entity_type_id=_SECTION_ID,
        name=long_text,
        label=long_text,
        field_type="text",
        is_required=False,
        sort_order=0,
        created_at=datetime.now(UTC),
    )
    applied = [
        AppliedDraftOp(
            op_index=i,
            op="move_question",
            field=field,
            section_id=_SECTION_ID,
            section_label=long_text,
        )
        for i in range(MAX_OPS)
    ]
    replies = [_applied_reply(a) for a in applied]
    assert {len(r.label) for r in replies} == {LABEL_CAP}
    assert {len(r.name) for r in replies} == {LABEL_CAP}
    assert {len(r.section_label) for r in replies} == {LABEL_CAP}
    # The floor of every reply: a full worst-case batch, capped names, and the
    # row-less diff a zero budget still renders.
    floor = EditTemplateDraftResult(
        status="draft_saved_unpublished",
        visible_to_reviewers_and_ai=False,
        project_name=long_text[:200],
        template_name=long_text[:200],
        applied=replies,
        diff=capped_diff(_diff_with_additive_rows(DIFF_ROW_CAP), budget=0),
        draft_fingerprint="f" * 64,
        editor_url="https://example.test/" + "p" * 200,
        next_step=_NEXT_STEP,
        lint=McpLintCounts(block=0, warn=0),
        destructive_changes=0,
    )
    assert len(compact_json(floor.model_dump(mode="json"))) <= RESULT_CAP


def test_set_options_op_validates() -> None:
    op = SetOptionsOp(
        op="set_options",
        field_id=_FIELD_ID,
        options=[{"value": "y", "label": "Yes"}, {"label": " Maybe "}],
    )
    assert [o.value for o in op.options] == ["y", None]


@pytest.mark.parametrize(
    ("options", "loc"),
    [([], ("options",)), ([{"label": "a", "x": 1}], ("options", 0, "x"))],
    ids=["empty", "extra-key"],
)
def test_set_options_op_invalid_cases(options: list[object], loc: tuple[object, ...]) -> None:
    with pytest.raises(ValidationError) as exc_info:
        SetOptionsOp.model_validate(
            {"op": "set_options", "field_id": _FIELD_ID, "options": options}
        )
    assert exc_info.value.errors()[0]["loc"] == loc


def test_add_question_op_flags_and_units_validate() -> None:
    op = AddQuestionOp(
        **_base_add(
            type="number",
            required=True,
            unit="mg",
            allowed_units=["mg", "g"],
            allows_not_applicable=True,
            allows_not_evaluated=True,
            allows_no_information=False,
            allow_other=True,
        )
    )
    assert (op.required, op.unit, op.allowed_units) == (True, "mg", ["mg", "g"])
    assert (op.allows_not_applicable, op.allows_no_information, op.allow_other) == (
        True,
        False,
        True,
    )


def test_add_question_op_flag_defaults_match_the_rest_api() -> None:
    op = AddQuestionOp(**_base_add())
    assert (op.required, op.allows_not_applicable, op.allows_not_evaluated) == (False, False, False)
    assert (op.allows_no_information, op.allow_other, op.unit, op.allowed_units) == (
        True,
        False,
        None,
        None,
    )


def test_add_question_op_allowed_unit_over_50_chars_is_invalid() -> None:
    with pytest.raises(ValidationError) as exc_info:
        AddQuestionOp(**_base_add(type="number", allowed_units=["x" * 51]))
    assert exc_info.value.errors()[0]["loc"] == ("allowed_units", 0)


def test_update_question_op_allowed_unit_over_50_chars_is_invalid() -> None:
    with pytest.raises(ValidationError) as exc_info:
        UpdateQuestionOp(op="update_question", field_id=_FIELD_ID, allowed_units=["x" * 51])
    assert exc_info.value.errors()[0]["loc"] == ("allowed_units", 0)


def test_update_question_op_name_is_refused_by_the_schema() -> None:
    with pytest.raises(ValidationError) as exc_info:
        UpdateQuestionOp.model_validate(
            {"op": "update_question", "field_id": _FIELD_ID, "name": "renamed"}
        )
    assert exc_info.value.errors()[0]["loc"] == ("name",)


@pytest.mark.parametrize(
    "key",
    [
        "required",
        "allows_not_applicable",
        "allows_not_evaluated",
        "allows_no_information",
        "is_entity_key",
        "allow_other",
    ],
)
def test_update_question_op_flag_null_is_invalid(key: str) -> None:
    with pytest.raises(ValidationError) as exc_info:
        UpdateQuestionOp.model_validate({"op": "update_question", "field_id": _FIELD_ID, key: None})
    assert exc_info.value.errors()[0]["loc"] == (key,)


def test_update_question_op_sends_only_set_keys() -> None:
    op = UpdateQuestionOp(op="update_question", field_id=_FIELD_ID, is_entity_key=True, unit=None)
    assert op.model_dump(exclude_unset=True, exclude={"op", "field_id"}) == {
        "is_entity_key": True,
        "unit": None,
    }


def test_tool_description_names_set_options() -> None:
    assert "set_options" in _DESCRIPTION


def test_resolve_options_first_stored_label_wins_and_new_derive() -> None:
    stored = [
        {"value": "a1", "label": "A"},
        {"value": "a2", "label": " A "},
        {"value": "b", "label": "B"},
    ]
    sent = [OptionInput(label="A "), OptionInput(value="z", label="B"), OptionInput(label=" C ")]
    assert _resolve_options(stored, sent) == [
        OptionItem(value="a1", label="A "),
        OptionItem(value="z", label="B"),
        OptionItem(value="C", label=" C "),
    ]


def test_resolve_options_legacy_bare_strings_keep_their_codes() -> None:
    assert _resolve_options(["Yes", "No"], [OptionInput(label=" Yes ")]) == [
        OptionItem(value="Yes", label=" Yes ")
    ]


def test_resolve_options_collision_raises() -> None:
    with pytest.raises(OptionValueConflictError):
        _resolve_options(
            [{"value": "y", "label": "Yes"}],
            [OptionInput(label="Yes"), OptionInput(value="y", label="Again")],
        )


# --- section and instruction ops ---------------------------------------------


def test_section_and_instruction_ops_validate() -> None:
    add = AddSectionOp(op="add_section", label=" Models ", cardinality="many", entry_label="Model")
    assert (add.label, add.parent_section_id, add.required) == ("Models", None, False)
    update = UpdateSectionOp(op="update_section", section_id=_SECTION_ID, cardinality="one")
    assert update.model_dump(exclude_unset=True) == {
        "op": "update_section",
        "section_id": _SECTION_ID,
        "cardinality": "one",
    }
    assert DeleteSectionOp(op="delete_section", section_id=_SECTION_ID).section_id == _SECTION_ID
    assert SetInstructionOp(op="set_instruction", instruction=None).instruction is None
    assert SetInstructionOp(op="set_instruction", instruction="x" * 4000).instruction


@pytest.mark.parametrize(
    ("model", "payload", "loc"),
    [
        (AddSectionOp, {"op": "add_section", "label": "S", "cardinality": "few"}, ("cardinality",)),
        (
            UpdateSectionOp,
            {"op": "update_section", "section_id": _SECTION_ID, "cardinality": "few"},
            ("cardinality",),
        ),
        (AddSectionOp, {"op": "add_section", "label": "  ", "cardinality": "one"}, ("label",)),
        (
            AddSectionOp,
            {"op": "add_section", "label": "S", "cardinality": "one", "description": "d" * 501},
            ("description",),
        ),
        (
            SetInstructionOp,
            {"op": "set_instruction", "instruction": "x" * 4001},
            ("instruction",),
        ),
        (SetInstructionOp, {"op": "set_instruction"}, ("instruction",)),
        (
            UpdateSectionOp,
            {"op": "update_section", "section_id": _SECTION_ID, "label": None},
            ("label",),
        ),
        (
            DeleteSectionOp,
            {"op": "delete_section", "section_id": _SECTION_ID, "cascade": True},
            ("cascade",),
        ),
    ],
    ids=[
        "add-cardinality-few",
        "update-cardinality-few",
        "blank-label",
        "long-description",
        "instruction-4001",
        "instruction-missing",
        "update-label-null",
        "delete-extra-key",
    ],
)
def test_section_and_instruction_op_invalid_cases(
    model: type, payload: dict[str, object], loc: tuple[object, ...]
) -> None:
    with pytest.raises(ValidationError) as exc_info:
        model.model_validate(payload)
    assert exc_info.value.errors()[0]["loc"] == loc


def test_update_section_without_changes_names_the_rule() -> None:
    with pytest.raises(ValidationError) as exc_info:
        UpdateSectionOp.model_validate({"op": "update_section", "section_id": _SECTION_ID})
    error = validation_failure(exc_info.value, op_index=0)
    assert error.message == "name at least one field to change"
    assert "field" not in error.extras


def test_tool_description_lists_every_op_and_human_only_publish() -> None:
    for op in ("add_section", "update_section", "delete_section", "set_instruction"):
        assert op in _DESCRIPTION
    assert "only a human" in _DESCRIPTION


def test_section_and_instruction_replies_stay_bounded() -> None:
    long_text = '"' * 1000
    section = SectionRead(
        id=_SECTION_ID,
        project_template_id=uuid4(),
        name="models",
        label=long_text,
        cardinality="many",
        sort_order=1,
        is_required=False,
        created_at=datetime.now(UTC),
    )
    added = _applied_reply(AppliedDraftOp(op_index=0, op="add_section", section=section))
    assert added.model_dump() == {
        "op_index": 0,
        "op": "add_section",
        "section_id": _SECTION_ID,
        "label": cap_text(long_text, LABEL_CAP)[0],
        "cardinality": "many",
    }
    assert len(added.label or "") == LABEL_CAP
    deleted = _applied_reply(
        AppliedDraftOp(op_index=1, op="delete_section", before={"section_id": str(_SECTION_ID)})
    )
    assert deleted.model_dump() == {
        "op_index": 1,
        "op": "delete_section",
        "section_id": _SECTION_ID,
        "label": None,
        "cardinality": None,
    }
    instruction = _applied_reply(AppliedDraftOp(op_index=2, op="set_instruction", changed=True))
    assert instruction.model_dump() == {"op_index": 2, "op": "set_instruction", "changed": True}
