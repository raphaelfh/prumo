"""Pure unit tests for `pack_items` (task 8b): per-article keyset packing
under a JSON-size budget, independent of any DB or Pydantic model."""

from __future__ import annotations

from uuid import UUID, uuid4

from app.services.extraction_agent_read_service import pack_items


def _flat_cost(_item: int) -> int:
    return 10


def test_pack_items_three_articles_budget_cuts_mid_run() -> None:
    a1, a2, a3 = uuid4(), uuid4(), uuid4()
    items: list[tuple[UUID, list[int]]] = [
        (a1, [1, 1, 1, 1, 1]),
        (a2, []),
        (a3, [1, 1, 1, 1, 1, 1, 1]),
    ]

    page1, next1 = pack_items(items, start=None, budget=60, cost=_flat_cost)
    assert [(aid, pos, len(chosen)) for aid, pos, chosen in page1] == [
        (a1, 0, 5),
        (a2, 0, 0),
    ]
    assert next1 == (a3, 0)

    page2, next2 = pack_items(items, start=next1, budget=60, cost=_flat_cost)
    assert [(aid, pos, len(chosen)) for aid, pos, chosen in page2] == [(a3, 0, 6)]
    assert next2 == (a3, 6)

    page3, next3 = pack_items(items, start=next2, budget=60, cost=_flat_cost)
    assert [(aid, pos, len(chosen)) for aid, pos, chosen in page3] == [(a3, 6, 1)]
    assert next3 is None


def test_pack_items_oversized_item_still_emits_for_progress() -> None:
    a1 = uuid4()
    items: list[tuple[UUID, list[int]]] = [(a1, [1])]

    page, nxt = pack_items(items, start=None, budget=1, cost=_flat_cost)

    assert [(aid, pos, chosen) for aid, pos, chosen in page] == [(a1, 0, [1])]
    assert nxt is None


def test_pack_items_start_resumes_mid_article() -> None:
    a1, a2 = uuid4(), uuid4()
    items: list[tuple[UUID, list[int]]] = [(a1, [1, 1, 1, 1, 1]), (a2, [1])]

    page, nxt = pack_items(items, start=(a1, 3), budget=1_000, cost=_flat_cost)

    assert [(aid, pos, len(chosen)) for aid, pos, chosen in page] == [
        (a1, 3, 2),
        (a2, 0, 1),
    ]
    assert nxt is None
