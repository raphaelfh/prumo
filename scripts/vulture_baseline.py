#!/usr/bin/env python3
"""Vulture ratchet — fail only when NEW dead-code findings are introduced.

Backend counterpart of the frontend's knip gate (which runs at zero findings).
The backend cannot gate at zero: vulture's 60%-confidence tier — the only tier
that sees unused functions/methods/classes — also flags framework-consumed
symbols (Starlette ``dispatch``, Celery ``on_failure``, ORM column writes) that
no reader in ``app/`` ever touches by name. The committed baseline is the
allow-list of those, and it only shrinks. A new signature fails CI; deleting
dead code lets you tighten the baseline (``--update``) in the same PR.

The baseline carries no dead-code backlog: every entry is a false positive of
one of the shapes the generated header lists. Treat anything outside them as
dead code to delete, not as a new entry.

Why ``file:kind:name`` and not line numbers: lines churn on every edit, which
would make the baseline noisy. The triple is the stable unit "this symbol in
this file is tolerated dead" — enough to stop regressions, cheap to review.

Usage (run from the ``backend/`` directory, same cwd as the CI step)::

    # check (CI):
    uv run vulture > vulture.out || true
    uv run python ../scripts/vulture_baseline.py --baseline .vulture_baseline --input vulture.out

    # tighten after deleting dead code (or accept an intentional regression):
    uv run vulture > vulture.out || true
    uv run python ../scripts/vulture_baseline.py --baseline .vulture_baseline --input vulture.out --update
"""

from __future__ import annotations

import argparse
import re
import subprocess
import sys
from pathlib import Path

# Matches a vulture finding line:
#   app/repositories/base.py:117: unused method 'get_all' (60% confidence)
_FINDING_RE = re.compile(
    r"^(?P<file>.+?\.py):\d+: unused (?P<kind>[a-z]+) '(?P<name>[^']+)' \(\d+% confidence\)$"
)


def parse_signatures(lines: list[str]) -> set[str]:
    """Reduce raw vulture output to a set of stable ``file:kind:name`` signatures."""
    signatures: set[str] = set()
    for line in lines:
        match = _FINDING_RE.match(line.rstrip("\n"))
        if match:
            signatures.add(f"{match.group('file')}:{match.group('kind')}:{match.group('name')}")
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
        "# vulture ratchet baseline — (file:kind:name) findings tolerated today.\n"
        "# Only shrinks; a new finding fails CI.\n"
        "#\n"
        "# ADMISSION RULE: an entry belongs here only if the symbol is consumed\n"
        "# by a framework or library rather than by name from app/. In practice\n"
        "# that is one of five shapes:\n"
        "#   * Starlette `dispatch` — BaseHTTPMiddleware calls it per request.\n"
        "#   * Celery — LoggedTask's on_failure/on_success/on_retry hooks, and\n"
        "#     signal-handler kwargs the framework passes by name.\n"
        "#   * SQLAlchemy column writes — persisted by the ORM, read back out\n"
        "#     of the database, never by a Python reader in app/.\n"
        "#   * Library option objects — docling pipeline options, openpyxl\n"
        "#     worksheet properties: written here, read by the library.\n"
        "#   * AIProposalRow — consumed positionally via `dataclasses.astuple`,\n"
        "#     so no field is ever read by name (see ai_metadata.py).\n"
        "#\n"
        "# Anything that does not fit one of those is dead code: delete it,\n"
        "# then regenerate with scripts/vulture_baseline.py --update.\n"
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
        help="vulture output file (defaults to stdin)",
    )
    parser.add_argument(
        "--exec",
        dest="exec_vulture",
        action="store_true",
        help="run `vulture` itself and read its output, instead of --input. "
        "Exists so callers need no shell pipe: verify_all.sh gates must "
        "chain with `&&` only (a pipe would hide vulture's exit status).",
    )
    parser.add_argument(
        "--update",
        action="store_true",
        help="overwrite the baseline with the current signatures",
    )
    args = parser.parse_args(argv)

    if args.exec_vulture:
        # Config comes from [tool.vulture] in pyproject.toml (cwd = backend/).
        proc = subprocess.run(["vulture"], capture_output=True, text=True)
        # vulture exits 3 when findings exist — that is the ratchet's input,
        # not an error. Anything unexpected must surface, never read as clean.
        if proc.returncode not in (0, 3):
            sys.stderr.write(proc.stderr)
            print(f"::error::vulture itself failed (exit {proc.returncode})")
            return proc.returncode or 1
        lines = proc.stdout.splitlines(keepends=True)
    else:
        lines = args.input.readlines()

    current = parse_signatures(lines)

    if args.update:
        write_baseline(args.baseline, current)
        print(
            f"vulture baseline written: {len(current)} (file:kind:name) findings -> {args.baseline}"
        )
        return 0

    baseline = load_baseline(args.baseline)
    new, fixed = classify(current, baseline)

    if new:
        print(
            f"::error::vulture ratchet: {len(new)} new dead-code finding(s) "
            "introduced (repo rule: no new dead code):"
        )
        for signature in new:
            print(f"  + {signature}")
        print(
            "Delete the dead code, or — only if the symbol is genuinely "
            "framework-consumed — rerun with --update and commit the baseline "
            "in the same PR with a rationale."
        )
        return 1

    if fixed:
        print(
            f"vulture ratchet: {len(fixed)} finding(s) gone since the "
            "baseline — rerun with --update to tighten it:"
        )
        for signature in fixed:
            print(f"  - {signature}")

    print(
        f"vulture ratchet OK: {len(current)} <= {len(baseline)} tolerated "
        "(file:kind:name) findings, nothing new."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
