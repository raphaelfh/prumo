"""Source-text helpers shared by the TypeScript fitness checks.

Regex/tag scanners, not a TS parser: they only need comments blanked out so a
pattern in a comment or JSDoc example never counts as code.
"""

from __future__ import annotations

QUOTES = "\"'`"


def strip_comments(src: str) -> str:
    """Blank out // and /* */ comments, preserving length and newlines.

    String literals are skipped, so `'https://x'` is not a comment. Length and
    newlines survive, so an offset in the result is an offset in the source.
    """
    out = list(src)
    i, n = 0, len(src)
    while i < n:
        ch = src[i]
        if ch in QUOTES:
            quote = ch
            i += 1
            while i < n and src[i] != quote:
                if src[i] == "\\":
                    i += 1
                i += 1
            i += 1
            continue
        if ch == "/" and i + 1 < n and src[i + 1] == "/":
            while i < n and src[i] != "\n":
                out[i] = " "
                i += 1
            continue
        if ch == "/" and i + 1 < n and src[i + 1] == "*":
            while i < n and not (src[i] == "*" and i + 1 < n and src[i + 1] == "/"):
                if src[i] != "\n":
                    out[i] = " "
                i += 1
            for j in range(i, min(i + 2, n)):
                out[j] = " "
            i += 2
            continue
        i += 1
    return "".join(out)
