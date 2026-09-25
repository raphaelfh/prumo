"""Read-side service for the researcher MCP `get_extractions` tool (task 8b).

A new module, not an addition to `extraction_run_read_service.py`: that
module is near its 800-line fitness ceiling and `extraction_export_service.py`
is already vulture-baselined, so a third owner for "extraction data, read
out" would blur which one to touch. This module never re-implements blind
review -- every run read goes through
`extraction_run_read_service.get_run_with_workflow_history`, which applies
`run_reveals_peers` and filters peers' human proposals/decisions (the
lockstep copy of migration 0025). There is no ALL_USERS path here (unlike
the export's `managers_see_reviewers`-blind CSV): an agent call is a single
caller's view, so it always renders through that caller's own blind
boundary, never an unblinded aggregate.
"""

from __future__ import annotations

from collections.abc import Callable
from typing import TypeVar
from uuid import UUID

_RESULT_CAP = 32_000
_PAGE_BUDGET = 28_000
_CONCISE_VALUE_CAP = 80
_DETAILED_VALUE_CAP = 1_000
_EVIDENCE_QUOTE_CAP = 300
_EVIDENCE_PER_ROW_CAP = 3

T = TypeVar("T")


def pack_items(
    items: list[tuple[UUID, list[T]]],
    *,
    start: tuple[UUID, int] | None,
    budget: int,
    cost: Callable[[T], int],
) -> tuple[list[tuple[UUID, int, list[T]]], tuple[UUID, int] | None]:
    """Pack per-article item lists into one page under a byte budget.

    `start` is a prior page's cursor: `(article_id, item position)`. Every
    call guarantees forward progress -- the very first item touched this
    call always ships regardless of its own cost (an oversized single item
    ships alone rather than starving the page forever), and an article with
    zero items is always emitted for free (a run-less article is never
    silently dropped). Once the page already holds something, crossing into
    a not-yet-touched article needs STRICTLY more headroom than its next
    item costs (`used + cost >= budget` defers the WHOLE article, not a
    single wedged-in item); an already-started article's own later items use
    inclusive room (`used + cost > budget` stops) so one run's fields don't
    fragment one at a time at the exact boundary.
    """
    start_idx = 0
    start_pos = 0
    if start is not None:
        start_article_id, start_pos = start
        for idx, (article_id, _) in enumerate(items):
            if article_id == start_article_id:
                start_idx = idx
                break
        else:
            return [], None

    out: list[tuple[UUID, int, list[T]]] = []
    used = 0
    for idx in range(start_idx, len(items)):
        article_id, article_items = items[idx]
        first_pos = start_pos if idx == start_idx else 0
        chosen: list[T] = []
        for pos in range(first_pos, len(article_items)):
            item = article_items[pos]
            c = cost(item)
            if not out and not chosen:
                pass  # forced progress: the very first item this call always ships
            elif not chosen:
                if used + c >= budget:
                    return out, (article_id, first_pos)
            else:
                if used + c > budget:
                    out.append((article_id, first_pos, chosen))
                    return out, (article_id, pos)
            chosen.append(item)
            used += c
        out.append((article_id, first_pos, chosen))
    return out, None
