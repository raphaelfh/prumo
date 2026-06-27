"""Deterministic value-presence checks for numeric/date/unit fields.

NLI alone is unreliable on exact numbers, so the entailment gate pairs a judge
with this check for numeric-like values. Pure, no IO."""

from __future__ import annotations

import re
import unicodedata

_NUM = re.compile(r"-?\d+(?:[.,]\d+)?")


def _norm(s: str) -> str:
    return unicodedata.normalize("NFKC", s).casefold()


def is_numeric_like(value: str) -> bool:
    return bool(_NUM.search(value or ""))


def _candidates(value: str) -> set[str]:
    """Normalized numeric forms a value may appear as (raw, %<->fraction)."""
    out: set[str] = set()
    for m in _NUM.findall(_norm(value)):
        n = m.replace(",", ".")
        out.add(n.rstrip("0").rstrip(".") if "." in n else n)
        try:
            f = float(n)
            out.add(str(f / 100).rstrip("0").rstrip("."))  # 12.5 -> 0.125
            out.add(str(f * 100).rstrip("0").rstrip("."))  # 0.125 -> 12.5
        except ValueError:
            pass
    return {c for c in out if c}


def numeric_value_supported(value: str, text: str) -> bool:
    text_nums = {
        (
            m.replace(",", ".").rstrip("0").rstrip(".")
            if "." in m.replace(",", ".")
            else m.replace(",", ".")
        )
        for m in _NUM.findall(_norm(text))
    }
    return bool(_candidates(value) & text_nums)
