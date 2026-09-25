"""The one length cap for unbounded article metadata in MCP results.

`public.articles.title` (and `journal_title`, each author, a file's
`original_filename`) is unbounded `Text`: every read tool that returns one
cuts it here, so a single pathological row cannot push a result past the
32,000-char cap (spec §5.1). A char cap bounds weight only for ASCII:
`compact_json` renders a CJK char as a 6-char `\\uXXXX` escape (an astral one
as 12), so a field whose char cap could still blow the result budget is cut
by `cap_json_weight` instead.
"""

from __future__ import annotations

from app.utils.compact_json import compact_json

TITLE_CAP = 200


def cap_text(value: str, cap: int = TITLE_CAP) -> tuple[str, bool]:
    """`value` cut to `cap` chars, and whether it was cut -- a citing agent
    deserves to know the title it quotes is not the whole title."""
    if len(value) <= cap:
        return value, False
    return value[:cap], True


def cap_json_weight(value: str, budget: int) -> tuple[str, bool]:
    """The longest prefix of `value` whose `compact_json` rendering (quotes
    included) is at most `budget` chars, and whether it was cut.

    Each code point's escape is independent, so the weight is the sum of
    per-char weights plus the two quotes."""
    remaining = budget - 2
    for index, char in enumerate(value):
        remaining -= len(compact_json(char)) - 2
        if remaining < 0:
            return value[:index], True
    return value, False


def join_capped(values: list[str], *, sep: str, cap: int) -> str:
    """`values` joined by `sep`, cut to `cap` chars plus a visible "…" mark."""
    joined = sep.join(values)
    return joined if len(joined) <= cap else joined[:cap] + "…"
