"""Unit tests for `get_template`'s pure paging helper (fix round 1, A2/B1):
no DB needed, `RunViewEntityType`/`RunViewField` are constructed directly."""

from __future__ import annotations

from uuid import uuid4

import pytest

from app.api.mcp.errors import McpErrorCode, McpToolError
from app.api.mcp.template_changes import page_changes
from app.api.mcp.tools.templates import _page_sections, _question, _section_header_cost
from app.domain.template_change import ChangeTier, ChangeVariant, DiffStatus
from app.schemas.extraction_run import RunViewEntityType, RunViewField
from app.schemas.hitl_session import (
    TemplateChangeRowRead,
    TemplateConfigDiffBuckets,
    TemplateConfigDiffRead,
)
from app.utils.opaque_cursor import encode_cursor


def _field(name: str, *, description: str = "") -> RunViewField:
    return RunViewField(
        id=uuid4(),
        name=name,
        label=name,
        description=description or None,
        field_type="text",
        is_required=False,
        sort_order=0,
    )


def _entity(name: str, fields: list[RunViewField]) -> RunViewEntityType:
    return RunViewEntityType(
        id=uuid4(),
        name=name,
        label=name,
        parent_entity_type_id=None,
        cardinality="one",
        sort_order=0,
        is_required=False,
        fields=fields,
    )


def test_page_sections_never_emits_empty_section_on_forced_cut() -> None:
    # Section A has one big question that (together with A's own header)
    # exactly fills the budget; section B's header would still fit, but
    # not even its first (and only) question would. B must defer WHOLE --
    # never appear on the page with zero questions.
    field_a = _field("big", description="x" * 300)
    field_b = _field("small")
    entity_a = _entity("A", [field_a])
    entity_b = _entity("B", [field_b])
    tree = [entity_a, entity_b]

    header_a_cost = _section_header_cost(entity_a, False) + 1
    question_a_cost = len(_question(field_a).model_dump_json()) + 1
    header_b_cost = _section_header_cost(entity_b, False) + 1

    budget = header_a_cost + question_a_cost + header_b_cost - 1  # not enough for B's header too

    sections, nxt = _page_sections(tree, (0, 0), budget=budget)

    assert [s.name for s in sections] == ["A"]
    assert all(s.questions for s in sections)
    assert nxt == (1, 0)


def test_page_sections_emits_genuinely_empty_section() -> None:
    # A section with zero fields in the template itself (not a paging
    # artifact) is still emitted, with an empty `questions` list.
    empty_entity = _entity("Empty", [])
    tree = [empty_entity, _entity("Next", [_field("q")])]

    sections, nxt = _page_sections(tree, (0, 0), budget=10_000)

    assert [s.name for s in sections] == ["Empty", "Next"]
    assert sections[0].questions == []
    assert nxt is None


def test_page_sections_forces_progress_on_oversized_first_question() -> None:
    # Nothing has been emitted yet on the page: the first question is
    # always forced in even if it alone exceeds the budget, so paging can
    # never get stuck returning nothing forever.
    huge = _field("huge", description="x" * 10_000)
    tree = [_entity("A", [huge])]

    sections, nxt = _page_sections(tree, (0, 0), budget=1)

    assert [s.name for s in sections] == ["A"]
    assert len(sections[0].questions) == 1
    assert nxt is None


def test_question_lists_only_true_flags_in_a_fixed_order() -> None:
    field = _field("all").model_copy(
        update={
            "is_required": True,
            "is_entity_key": True,
            "allows_not_applicable": True,
            "allows_not_evaluated": True,
            "allows_no_information": True,
            "allow_other": True,
        }
    )
    assert _question(field).flags == [
        "required",
        "entity_key",
        "allows_not_applicable",
        "allows_not_evaluated",
        "allows_no_information",
        "allow_other",
    ]
    none = _field("none").model_copy(update={"allows_no_information": False})
    assert _question(none).flags == []
    assert "required" not in _question(none).model_dump()


def test_question_keeps_only_a_list_of_unit_strings() -> None:
    listed = _field("u").model_copy(update={"unit": "mg", "allowed_units": ["mg", "g"]})
    assert (_question(listed).unit, _question(listed).allowed_units) == ("mg", ["mg", "g"])
    mapped = _field("m").model_copy(update={"allowed_units": {"mg": 1}})
    assert _question(mapped).allowed_units is None
    mixed = _field("x").model_copy(update={"allowed_units": ["mg", 3]})
    assert _question(mixed).allowed_units == ["mg"]


def test_section_header_carries_description_entry_label_and_required() -> None:
    entity = _entity("Doses", []).model_copy(
        update={"description": "Each dose", "entry_label": "dose", "is_required": True}
    )
    sections, _ = _page_sections([entity], (0, 0), budget=10_000)
    header = sections[0]
    assert (header.description, header.entry_label, header.required) == (
        "Each dose",
        "dose",
        True,
    )


# --- the `changes` view's paging (template_changes.page_changes) -----------


def _row(row_id: str, tier: ChangeTier, **overrides: object) -> TemplateChangeRowRead:
    values: dict[str, object] = {
        "id": row_id,
        "variant": ChangeVariant.FIELD_MODIFIED,
        "tier": tier,
        "label_path": ["Section", "Question"],
        "attribute": "label",
        "before": "old",
        "after": "new",
        "affects_ai": True,
    }
    values.update(overrides)
    return TemplateChangeRowRead.model_validate(values)


def _diff(fingerprint: str | None = "f" * 64, **buckets: list) -> TemplateConfigDiffRead:
    return TemplateConfigDiffRead(
        project_template_id=uuid4(),
        status=DiffStatus.AVAILABLE,
        changes=TemplateConfigDiffBuckets(**buckets),
        fingerprint=fingerprint,
    )


def test_page_changes_orders_destructive_semantic_additive_cosmetic() -> None:
    diff = _diff(
        additive=[_row("a", ChangeTier.ADDITIVE)],
        cosmetic=[_row("c", ChangeTier.COSMETIC)],
        semantic=[_row("s", ChangeTier.SEMANTIC)],
        destructive=[_row("d", ChangeTier.DESTRUCTIVE)],
    )
    rows, nxt = page_changes(diff, None, budget=100_000)
    assert [(r.id, r.tier) for r in rows] == [
        ("d", "destructive"),
        ("s", "semantic"),
        ("a", "additive"),
        ("c", "cosmetic"),
    ]
    assert nxt is None


def test_page_changes_follows_its_cursor_through_every_row() -> None:
    diff = _diff(additive=[_row(f"r{i}", ChangeTier.ADDITIVE) for i in range(5)])
    seen: list[str] = []
    cursor: str | None = None
    for _ in range(10):
        rows, cursor = page_changes(diff, cursor, budget=1)
        assert len(rows) == 1  # forced progress on a budget no row fits
        seen += [r.id for r in rows]
        if cursor is None:
            break
    assert seen == [f"r{i}" for i in range(5)]


def test_page_changes_renders_booleans_and_caps_values() -> None:
    diff = _diff(
        semantic=[
            _row("b", ChangeTier.SEMANTIC, attribute="is_required", before=False, after=True),
            _row("l", ChangeTier.SEMANTIC, before="x" * 500, after=None, affects_ai=False),
        ]
    )
    (flag, long), _ = page_changes(diff, None, budget=100_000)
    assert (flag.before, flag.after) == ("false", "true")
    assert long.before == "x" * 200
    assert long.after is None
    assert long.affects_ai is False


@pytest.mark.parametrize(
    "cursor",
    [
        "not-a-cursor",
        encode_cursor(["0" * 12, 1]),  # another fingerprint: the draft changed
        encode_cursor(["f" * 12, 99]),  # past the last row
        encode_cursor(["f" * 12, -1]),
    ],
    ids=["malformed", "stale", "past-end", "negative"],
)
def test_page_changes_refuses_a_bad_cursor(cursor: str) -> None:
    diff = _diff(additive=[_row(f"r{i}", ChangeTier.ADDITIVE) for i in range(3)])
    with pytest.raises(McpToolError) as caught:
        page_changes(diff, cursor, budget=100_000)
    assert caught.value.code == McpErrorCode.INVALID_ARGUMENT
    assert caught.value.extras["field"] == "cursor"


def test_page_changes_refuses_any_cursor_without_a_fingerprint() -> None:
    with pytest.raises(McpToolError):
        page_changes(_diff(fingerprint=None), encode_cursor(["f" * 12, 0]), budget=100_000)
