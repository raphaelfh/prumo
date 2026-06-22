#!/usr/bin/env python3
"""Mypy ratchet — fail only when NEW type errors are introduced.

Operationalises constitution §V ("static typing is mandatory ... do not add new
errors; mypy becomes blocking when clean") without requiring the whole backend
to be type-clean today. It mirrors the ``scripts/fitness/*.baseline`` ratchet:
the committed baseline is an allow-list of ``(file, error-code)`` pairs, and the
current mypy run must be a subset of it. Fixing errors lets you shrink the
baseline (``--update``); introducing a new ``(file, code)`` pair fails CI.

Why ``(file:code)`` and not full messages or line numbers: line numbers churn on
every edit and messages churn on wording, which would make the baseline noisy.
``(file, error-code)`` is the stable unit "this file is allowed to have this
class of type error" — enough to stop regressions, cheap to review.

Usage (run from the ``backend/`` directory, same cwd as the CI mypy step)::

    # check (CI):
    uv run mypy app --ignore-missing-imports > mypy.out || true
    uv run python ../scripts/mypy_baseline.py --baseline .mypy_baseline --input mypy.out

    # regenerate after fixing errors (tighten the ratchet), or to accept the
    # current state on first install:
    uv run mypy app --ignore-missing-imports > mypy.out || true
    uv run python ../scripts/mypy_baseline.py --baseline .mypy_baseline --input mypy.out --update
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

# Matches a mypy error line, with or without a column number:
#   app/services/foo.py:12: error: Incompatible return value  [return-value]
#   app/api/bar.py:3:5: error: Name "x" is not defined  [name-defined]
_ERROR_RE = re.compile(
    r"^(?P<file>.+?\.py):\d+:(?:\d+:)?\s*error:.*\[(?P<code>[a-z][a-z0-9-]*)\]\s*$"
)


def parse_signatures(lines: list[str]) -> set[str]:
    """Reduce raw mypy output to a set of stable ``file:error-code`` signatures."""
    signatures: set[str] = set()
    for line in lines:
        match = _ERROR_RE.match(line.rstrip("\n"))
        if match:
            signatures.add(f"{match.group('file')}:{match.group('code')}")
    return signatures


def classify(current: set[str], baseline: set[str]) -> tuple[list[str], list[str]]:
    """Return (new, fixed) signatures relative to the baseline, both sorted."""
    return sorted(current - baseline), sorted(baseline - current)


def load_baseline(path: Path) -> set[str]:
    if not path.exists():
        return set()
    return {
        line.strip()
        for line in path.read_text().splitlines()
        if line.strip() and not line.lstrip().startswith("#")
    }


def write_baseline(path: Path, signatures: set[str]) -> None:
    header = (
        "# mypy ratchet baseline — (file:error-code) pairs tolerated today.\n"
        "# Only shrinks; a new pair fails CI (constitution §V). Regenerate with\n"
        "# scripts/mypy_baseline.py --update after fixing errors.\n"
    )
    body = "\n".join(sorted(signatures))
    path.write_text(header + body + ("\n" if body else ""))


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--baseline", required=True, type=Path)
    parser.add_argument(
        "--input",
        type=argparse.FileType("r"),
        default=sys.stdin,
        help="mypy output file (defaults to stdin)",
    )
    parser.add_argument(
        "--update",
        action="store_true",
        help="overwrite the baseline with the current signatures",
    )
    args = parser.parse_args(argv)

    current = parse_signatures(args.input.readlines())

    if args.update:
        write_baseline(args.baseline, current)
        print(f"mypy baseline written: {len(current)} (file:code) pairs -> {args.baseline}")
        return 0

    baseline = load_baseline(args.baseline)
    new, fixed = classify(current, baseline)

    if new:
        print(
            f"::error::mypy ratchet: {len(new)} new type-error class(es) "
            "introduced (constitution §V: do not add new errors):"
        )
        for signature in new:
            print(f"  + {signature}")
        print(
            "Fix them, or — only if the regression is intentional — rerun with "
            "--update and commit the baseline in the same PR."
        )
        return 1

    if fixed:
        print(
            f"mypy ratchet: {len(fixed)} (file:code) pair(s) fixed since the "
            "baseline — rerun with --update to tighten it:"
        )
        for signature in fixed:
            print(f"  - {signature}")

    print(
        f"mypy ratchet OK: {len(current)} <= {len(baseline)} tolerated "
        "(file:code) pairs, no new errors."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
