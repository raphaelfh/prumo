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


def test_pack_items_start_article_deleted_resumes_at_next_survivor() -> None:
    """Fix round 1, M2: a page's `next_cursor` names the article the next
    call should resume at. The real caller's own keyset query already
    filters the `items` it passes to only articles at-or-after that cursor
    (`Article.id >= start[0]`), so when the cursor's own article was
    deleted since the page that issued it, `items` simply no longer
    contains it -- `items[0]` is already the next surviving article, and
    packing must resume there (position 0), never treat the missing exact
    match as "nothing left"."""
    a2, a3 = uuid4(), uuid4()
    deleted_a1 = uuid4()
    # `a1` is GONE from `items` (as if deleted) but `start` still names it --
    # exactly what a stale cursor looks like to the next call.
    items: list[tuple[UUID, list[int]]] = [(a2, [1, 1]), (a3, [1])]

    page, nxt = pack_items(items, start=(deleted_a1, 0), budget=1_000, cost=_flat_cost)

    assert [(aid, pos, len(chosen)) for aid, pos, chosen in page] == [
        (a2, 0, 2),
        (a3, 0, 1),
    ]
    assert nxt is None
