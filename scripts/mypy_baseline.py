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

# Proof-of-life: a mypy run that reached the end always prints exactly one of
# these on stdout (singular forms included):
#   Success: no issues found in 412 source files
#   Found 3 errors in 2 files (checked 412 source files)
_SUMMARY_RE = re.compile(
    r"^(?:Success: no issues found in \d+ source files?"
    r"|Found \d+ errors? in \d+ files? \(checked \d+ source files?\))\s*$"
)


def mypy_ran(lines: list[str], signatures: set[str]) -> bool:
    """Did mypy actually produce this output, or is the gate reading nothing?

    The CI step is ``{ uv run mypy ... || true; } | mypy_baseline.py``. The
    ``|| true`` is required (mypy exits 1 whenever it reports errors) but it
    also swallows a *spawn* failure — a venv without mypy prints "Failed to
    spawn: `mypy`" on **stderr**, so the pipe carries an empty stdin and the
    ratchet used to grade "0 signatures" as a clean run. Same blindness for a
    crash, a bad path, or "There are no .py[i] files in directory".

    Two independent proofs are accepted, so this can never produce a false RED:
      * at least one parsed error signature — mypy demonstrably type-checked;
      * a terminal summary line — mypy finished, with or without errors.
    """
    if signatures:
        return True
    return any(_SUMMARY_RE.match(line.rstrip("\n")) for line in lines)


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

    lines = args.input.readlines()
    current = parse_signatures(lines)

    # Before grading anything — including --update, where an empty read would
    # silently WIPE the ratchet baseline instead of merely passing it.
    if not mypy_ran(lines, current):
        print(
            "::error::mypy ratchet: mypy did not run — its output carried "
            "neither an error line nor a terminal summary "
            '("Success: no issues found in N source files" / "Found N errors '
            'in M files (checked K source files)").'
        )
        print(
            "The gate reads mypy's STDOUT through `|| true`, which hides a "
            "spawn/crash failure (that goes to stderr). Check that mypy is "
            "installed in the environment running the step: "
            "`cd backend && uv sync --frozen --extra dev`."
        )
        preview = [line.rstrip("\n") for line in lines[:5]]
        print(f"Input was {len(lines)} line(s); first lines: {preview or '<empty>'}")
        return 2

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
