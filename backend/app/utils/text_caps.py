"""The one length cap for unbounded article metadata in MCP results.

`public.articles.title` (and `journal_title`, each author, a file's
`original_filename`) is unbounded `Text`: every read tool that returns one
cuts it here, so a single pathological row cannot push a result past the
32,000-char cap (spec §5.1).
"""

from __future__ import annotations

TITLE_CAP = 200


def cap_text(value: str, cap: int = TITLE_CAP) -> tuple[str, bool]:
    """`value` cut to `cap` chars, and whether it was cut -- a citing agent
    deserves to know the title it quotes is not the whole title."""
    if len(value) <= cap:
        return value, False
    return value[:cap], True


def join_capped(values: list[str], *, sep: str, cap: int) -> str:
    """`values` joined by `sep`, cut to `cap` chars plus a visible "…" mark."""
    joined = sep.join(values)
    return joined if len(joined) <= cap else joined[:cap] + "…"
