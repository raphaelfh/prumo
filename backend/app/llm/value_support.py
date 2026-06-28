"""Deterministic value-presence checks for numeric/date/unit fields.

NLI alone is unreliable on exact numbers, so the entailment gate pairs a judge
with this check for numeric-like values. Pure, no IO."""

from __future__ import annotations

import re
import unicodedata

# A numeric token: optional sign, digits, then any run of `,`/`.` groups so
# grouped numbers like "1,234.5" or "24,077" are captured as a single token.
_NUM = re.compile(r"-?\d+(?:[.,]\d+)*")


def _norm(s: str) -> str:
    return unicodedata.normalize("NFKC", s).casefold()


def _canon(n: str) -> str:
    """Canonicalize an en-form numeric string (`.` decimal, no grouping)."""
    return n.rstrip("0").rstrip(".") if "." in n else n


def is_numeric_like(value: str) -> bool:
    return bool(_NUM.search(value or ""))


def _looks_grouped(token: str) -> bool:
    """True if *token* (digits + `,` only) reads as N,NNN,NNN thousands groups.

    Guards the grouping interpretation so a locale comma-decimal like "11,8"
    (== 11.8) is never mistaken for the integer 118.
    """
    parts = token.lstrip("-").split(",")
    if len(parts) < 2:
        return False
    return (
        1 <= len(parts[0]) <= 3
        and all(len(p) == 3 for p in parts[1:])
        and all(p.isdigit() for p in parts)
    )


def _raw_forms(token: str) -> set[str]:
    """Locale-aware interpretations of one numeric token as canonical strings.

    - both `,` and `.`: the rightmost separator is the decimal point, the rest
      group thousands ("1,234.5" -> "1234.5").
    - only `,`: ambiguous -> a decimal reading ("24,077" -> "24.077") plus, when
      it looks like thousands groups, an integer reading ("24,077" -> "24077").
    - only `.` (or none): `.` is the decimal point, so "11.8" never yields 118.
    """
    has_comma = "," in token
    has_dot = "." in token
    if has_comma and has_dot:
        dec = max(token.rfind(","), token.rfind("."))
        int_part = token[:dec].replace(",", "").replace(".", "")
        return {_canon(f"{int_part}.{token[dec + 1 :]}")}
    if has_comma:
        forms = {_canon(token.replace(",", "."))}
        if _looks_grouped(token):
            forms.add(_canon(token.replace(",", "")))
        return forms
    return {_canon(token)}


def _text_forms(text: str) -> set[str]:
    out: set[str] = set()
    for tok in _NUM.findall(_norm(text)):
        out |= _raw_forms(tok)
    return {c for c in out if c}


def _candidates(value: str) -> set[str]:
    """Normalized numeric forms a value may appear as (raw, %<->fraction)."""
    out: set[str] = set()
    for tok in _NUM.findall(_norm(value)):
        for n in _raw_forms(tok):
            out.add(n)
            try:
                f = float(n)
            except ValueError:
                continue
            # `.12g` keeps 12 significant digits without leaking binary float
            # noise (`str(11.8 / 100)` -> "0.11800000000000001"), so the clean
            # decimal in the source text still matches.
            out.add(_canon(format(f / 100, ".12g")))  # 12.5 -> 0.125
            out.add(_canon(format(f * 100, ".12g")))  # 0.125 -> 12.5
    return {c for c in out if c}


def numeric_value_supported(value: str, text: str) -> bool:
    return bool(_candidates(value) & _text_forms(text))
