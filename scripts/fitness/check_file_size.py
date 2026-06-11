#!/usr/bin/env python3
"""check_file_size.py — prumo fitness function (WARN-only).

Flags source files over the soft ceiling. Files >1,200 lines force
whole-file reads, raise Edit-tool uniqueness collisions, and
concentrate merge risk for agent sessions — the audit found god files
in both halves (seed.py 1,941; extraction_export_service.py 1,521;
ArticlesList.tsx 1,440). This check never fails the gate; it keeps the
outliers visible on every CI run so they shrink instead of grow.

Usage:
  python check_file_size.py [--repo-root PATH] [--max-lines N]

Exit codes: 0 (always, unless internal error) | 2 (internal error).
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
DEFAULT_REPO_ROOT = SCRIPT_DIR.parent.parent

MAX_LINES_DEFAULT = 800

SCAN_ROOTS = ("backend/app", "frontend")
SCAN_EXTS = {".py", ".ts", ".tsx"}
SKIP_DIR_NAMES = {
    "node_modules",
    "__pycache__",
    ".git",
    ".venv",
    "venv",
    "dist",
    "build",
    ".pytest_cache",
    "coverage",
}
# Generated output is allowed to be huge.
SKIP_PATH_PARTS = ("frontend/types/api/", "integrations/supabase/types.ts")


def scan(repo_root: Path, max_lines: int) -> list[tuple[str, int]]:
    offenders: list[tuple[str, int]] = []
    for root in SCAN_ROOTS:
        base = repo_root / root
        if not base.exists():
            continue
        for path in base.rglob("*"):
            if path.suffix not in SCAN_EXTS or not path.is_file():
                continue
            if any(part in SKIP_DIR_NAMES for part in path.parts):
                continue
            rel = path.relative_to(repo_root).as_posix()
            if any(skip in rel for skip in SKIP_PATH_PARTS):
                continue
            try:
                n_lines = sum(1 for _ in path.open("rb"))
            except OSError:
                continue
            if n_lines > max_lines:
                offenders.append((rel, n_lines))
    offenders.sort(key=lambda item: -item[1])
    return offenders


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo-root", type=Path, default=DEFAULT_REPO_ROOT)
    parser.add_argument("--max-lines", type=int, default=MAX_LINES_DEFAULT)
    args = parser.parse_args()

    started = time.time()
    offenders = scan(args.repo_root.resolve(), args.max_lines)

    for rel, n_lines in offenders:
        print(f"WARN file-size: {rel} has {n_lines} lines (soft ceiling {args.max_lines})")

    telemetry_out = os.environ.get("PRUMO_TELEMETRY_OUT")
    if telemetry_out:
        record = {
            "check": "check_file_size",
            "status": "warn" if offenders else "ok",
            "violations": [{"file": rel, "lines": n_lines} for rel, n_lines in offenders],
            "duration_ms": int((time.time() - started) * 1000),
        }
        with open(telemetry_out, "a", encoding="utf-8") as handle:
            handle.write(json.dumps(record) + "\n")

    print(
        f"file-size: OK ({len(offenders)} files over the {args.max_lines}-line "
        "soft ceiling; warn-only)"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
