"""The pure questionnaire lint: one finding per rule that fires, built from
`RunViewEntityType`/`RunViewField` literals (no DB)."""

from __future__ import annotations

import re
from pathlib import Path
from uuid import UUID, uuid4

from app.schemas.extraction_run import RunViewEntityType, RunViewField
from app.schemas.template_lint import LintFinding
from app.services.template_lint import CUSTOMIZE_SLOT, lint_tree


def _field(label: str, **overrides: object) -> RunViewField:
    values: dict[str, object] = {
        "id": uuid4(),
        "name": label.lower().replace(" ", "_"),
        "label": label,
        "description": None,
        "llm_description": f"Extract the {label}.",
        "field_type": "text",
        "is_required": False,
        "sort_order": 0,
    }
    values.update(overrides)
    return RunViewField.model_validate(values)


def _section(
    label: str,
    fields: list[RunViewField],
    *,
    cardinality: str = "one",
    entry_label: str | None = None,
    parent: UUID | None = None,
    section_id: UUID | None = None,
) -> RunViewEntityType:
    return RunViewEntityType(
        id=section_id or uuid4(),
        name=label.lower(),
        label=label,
        entry_label=entry_label,
        parent_entity_type_id=parent,
        cardinality=cardinality,
        sort_order=0,
        is_required=False,
        fields=fields,
    )


def _key(label: str = "Model name") -> RunViewField:
    return _field(label, is_entity_key=True)


def test_a_clean_tree_has_no_findings() -> None:
    tree = [
        _section("Study", [_field("Design")]),
        _section("Models", [_key()], cardinality="many", entry_label="model"),
    ]
    assert lint_tree(tree, "Extract what the article reports.") == []


def test_select_without_options_blocks_and_aggregates() -> None:
    selects = [
        _field("Outcome", field_type="select"),
        _field("Setting", field_type="multiselect", allowed_values=[]),
        _field("Phase", field_type="select"),
    ]
    with_options = _field(
        "Blinding", field_type="select", allowed_values=[{"value": "y", "label": "Yes"}]
    )
    tree = [_section("Plain", [_field("Note")]), _section("Design", [*selects, with_options])]

    assert lint_tree(tree, None) == [
        LintFinding(
            code="SELECT_WITHOUT_OPTIONS",
            status="block",
            section_label="Design",
            question_labels=["Outcome", "Setting", "Phase"],
            count=3,
        )
    ]


def test_repeating_section_without_entity_key_blocks() -> None:
    tree = [
        _section("Models", [_field("Model name")], cardinality="many", entry_label="model"),
        _section("Doses", [_field("Amount")], cardinality="many", entry_label="dose"),
        _section("Study", [_field("Design")]),
    ]
    assert lint_tree(tree, None) == [
        LintFinding(
            code="REPEATING_SECTION_WITHOUT_ENTITY_KEY",
            status="block",
            section_label="Models",
            count=2,
        )
    ]


def test_repeating_section_without_entry_label_warns() -> None:
    tree = [
        _section("Models", [_key()], cardinality="many", entry_label="  "),
        _section("Doses", [_key("Amount")], cardinality="many"),
    ]
    assert lint_tree(tree, None) == [
        LintFinding(
            code="REPEATING_SECTION_WITHOUT_ENTRY_LABEL",
            status="warn",
            section_label="Models",
            count=2,
        )
    ]


def test_empty_section_warns_unless_it_has_a_child() -> None:
    parent_id = uuid4()
    tree = [
        _section("Outer", [], section_id=parent_id),
        _section("Inner", [_field("Q")], parent=parent_id),
        _section("Hollow", []),
    ]
    assert lint_tree(tree, None) == [
        LintFinding(code="EMPTY_SECTION", status="warn", section_label="Hollow", count=1)
    ]


def test_question_without_ai_guidance_warns() -> None:
    tree = [
        _section("Study", [_field("Design")]),
        _section(
            "Outcomes",
            [
                _field("Primary", llm_description=None),
                _field("Secondary", llm_description="  ", description=""),
                _field("Described", llm_description=None, description="What was measured"),
            ],
        ),
    ]
    assert lint_tree(tree, None) == [
        LintFinding(
            code="QUESTION_WITHOUT_AI_GUIDANCE",
            status="warn",
            section_label="Outcomes",
            question_labels=["Primary", "Secondary"],
            count=2,
        )
    ]


def test_unresolved_customize_slot_in_instruction_and_questions() -> None:
    tree = [
        _section(
            "Study",
            [_field("Design", llm_description="Report the [customize: design list] used.")],
        )
    ]
    assert lint_tree(tree, "Focus on [customize:population].") == [
        LintFinding(
            code="UNRESOLVED_CUSTOMIZE_SLOT",
            status="warn",
            section_label="Study",
            question_labels=["Design"],
            count=2,
        )
    ]


def test_customize_slot_only_in_instruction_counts_one_and_names_no_section() -> None:
    tree = [_section("Study", [_field("Design")])]
    assert lint_tree(tree, "Use [customize:]") == [
        LintFinding(code="UNRESOLVED_CUSTOMIZE_SLOT", status="warn", count=1)
    ]


def test_question_labels_cap_at_five() -> None:
    tree = [_section("Many", [_field(f"Q{i}", llm_description=None) for i in range(7)])]
    (finding,) = lint_tree(tree, None)
    assert finding.count == 7
    assert finding.question_labels == ["Q0", "Q1", "Q2", "Q3", "Q4"]


def test_findings_follow_the_rule_order() -> None:
    tree = [
        _section("Hollow", []),
        _section(
            "Models",
            [_field("Kind", field_type="select", llm_description="[customize:x]")],
            cardinality="many",
        ),
        _section("Plain", [_field("Bare", llm_description=None)]),
    ]
    assert [(f.code, f.status) for f in lint_tree(tree, None)] == [
        ("SELECT_WITHOUT_OPTIONS", "block"),
        ("REPEATING_SECTION_WITHOUT_ENTITY_KEY", "block"),
        ("REPEATING_SECTION_WITHOUT_ENTRY_LABEL", "warn"),
        ("EMPTY_SECTION", "warn"),
        ("QUESTION_WITHOUT_AI_GUIDANCE", "warn"),
        ("UNRESOLVED_CUSTOMIZE_SLOT", "warn"),
    ]


_FRONTEND = Path(__file__).resolve().parents[3] / "frontend/components/extraction"
_JS_LITERAL = re.compile(r"/(\\\[customize:[^/]*)/g")


def test_customize_slot_parity() -> None:
    literals = [
        _JS_LITERAL.search((_FRONTEND / name).read_text()).group(1)  # type: ignore[union-attr]
        for name in ("TemplateInstructionControl.tsx", "TemplateInstructionPane.tsx")
    ]
    assert literals[0] == literals[1]
    assert CUSTOMIZE_SLOT.pattern == literals[0]
