"""Unit tests for `get_template`'s pure paging helper (fix round 1, A2/B1):
no DB needed, `RunViewEntityType`/`RunViewField` are constructed directly."""

from __future__ import annotations

from uuid import uuid4

from app.api.mcp.tools.templates import _page_sections, _question, _section_header_cost
from app.schemas.extraction_run import RunViewEntityType, RunViewField


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
