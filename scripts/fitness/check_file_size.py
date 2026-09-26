#!/usr/bin/env python3
"""check_file_size.py — prumo fitness function (ratchet).

Freezes file-size drift: a baselined oversized file may not GROW, and no new
file may cross the soft ceiling. Shrinking is always allowed (and lets you
tighten the baseline with --update-baseline). The actual splitting of the
current god files is a separate cleanup effort.

Baseline format: one `path:max_lines` per currently-oversized file.

Re-baselining is per path: only the named entries are rewritten (set to the
current size, or dropped once under the ceiling). A whole-tree rewrite would
also tighten files other PRs shrank and break those PRs when they rebase.

Usage:
  python check_file_size.py [--repo-root P] [--max-lines N] [--baseline P]
  python check_file_size.py --update-baseline PATH [PATH ...]

Exit codes: 0 (no growth, no new offender) | 1 (regression) | 2 (internal).
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
DEFAULT_BASELINE = SCRIPT_DIR / "check_file_size.baseline"
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
SKIP_PATH_PARTS = ("frontend/types/api/", "integrations/supabase/types.ts")


def scan(repo_root: Path, max_lines: int) -> dict[str, int]:
    offenders: dict[str, int] = {}
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
                n = sum(1 for _ in path.open("rb"))
            except OSError:
                continue
            if n > max_lines:
                offenders[rel] = n
    return offenders


def load_baseline(path: Path) -> dict[str, int]:
    if not path.is_file():
        return {}
    out: dict[str, int] = {}
    for ln in path.read_text(encoding="utf-8").splitlines():
        ln = ln.strip()
        if not ln or ln.startswith("#"):
            continue
        rel, _, num = ln.rpartition(":")
        if rel and num.isdigit():
            out[rel] = int(num)
    return out


def write_baseline(path: Path, entries: dict[str, int]) -> None:
    header = "# file-size ratchet baseline — oversized files frozen at current size.\n# May shrink (re-run --update-baseline <path> to tighten), never grow. Cleanup is a separate effort.\n"
    body = "\n".join(f"{rel}:{n}" for rel, n in sorted(entries.items()))
    path.write_text(header + body + ("\n" if body else ""))


def update_baseline(
    repo_root: Path, baseline_path: Path, offenders: dict[str, int], paths: list[str]
) -> int:
    baseline = load_baseline(baseline_path)
    rels: list[str] = []
    for raw in paths:
        p = Path(raw)
        rel = (p.resolve().relative_to(repo_root) if p.is_absolute() else p).as_posix()
        if rel not in offenders and rel not in baseline and not (repo_root / rel).is_file():
            print(
                f"check_file_size.py: {rel} is neither a file nor a baseline entry; nothing written"
            )
            return 2
        rels.append(rel)
    for rel in rels:
        if rel in offenders:
            baseline[rel] = offenders[rel]
            print(f"  {rel}: baselined at {offenders[rel]} lines")
        elif baseline.pop(rel, None) is not None:
            print(f"  {rel}: under the ceiling, entry removed")
        else:
            print(f"  {rel}: under the ceiling and not baselined, nothing to do")
    write_baseline(baseline_path, baseline)
    print(f"file-size baseline updated for {len(rels)} path(s) -> {baseline_path}")
    return 0


def update_command(rel: str, args: argparse.Namespace) -> str:
    cmd = "python3 scripts/fitness/check_file_size.py"
    if args.repo_root.resolve() != DEFAULT_REPO_ROOT:
        cmd += f" --repo-root {args.repo_root}"
    if args.baseline.resolve() != DEFAULT_BASELINE:
        cmd += f" --baseline {args.baseline}"
    if args.max_lines != MAX_LINES_DEFAULT:
        cmd += f" --max-lines {args.max_lines}"
    return f"{cmd} --update-baseline {rel}"


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo-root", type=Path, default=DEFAULT_REPO_ROOT)
    parser.add_argument("--max-lines", type=int, default=MAX_LINES_DEFAULT)
    parser.add_argument("--baseline", type=Path, default=DEFAULT_BASELINE)
    parser.add_argument(
        "--update-baseline",
        nargs="+",
        metavar="PATH",
        help="re-baseline only these repo-relative paths; other entries are left untouched",
    )
    args = parser.parse_args()

    started = time.time()
    repo_root = args.repo_root.resolve()
    offenders = scan(repo_root, args.max_lines)

    if args.update_baseline:
        return update_baseline(repo_root, args.baseline, offenders, args.update_baseline)

    baseline = load_baseline(args.baseline)
    regressions: list[str] = []
    offending: list[str] = []
    for rel, n in sorted(offenders.items(), key=lambda kv: -kv[1]):
        cap = baseline.get(rel)
        if cap is None:
            regressions.append(f"NEW over-ceiling file: {rel} has {n} lines (> {args.max_lines})")
        elif n > cap:
            regressions.append(f"GREW: {rel} has {n} lines (baseline cap {cap})")
        else:
            continue
        offending.append(rel)

    duration_ms = int((time.time() - started) * 1000)
    exit_code = 1 if regressions else 0

    telemetry_out = os.environ.get("PRUMO_TELEMETRY_OUT")
    if telemetry_out:
        with open(telemetry_out, "a", encoding="utf-8") as handle:
            handle.write(
                json.dumps(
                    {
                        "check": "check_file_size",
                        "status": "fail" if regressions else "ok",
                        "regressions": regressions,
                        "offender_count": len(offenders),
                        "duration_ms": duration_ms,
                    }
                )
                + "\n"
            )

    if regressions:
        print(f"check_file_size.py: FAIL ({duration_ms} ms; {len(regressions)} regression(s))")
        for r in regressions:
            print(f"  {r}")
        print(
            f"Shrink the file(s). Only if the growth is intentional, re-baseline just that file"
            f" and commit {args.baseline.name} (other entries stay untouched):"
        )
        for rel in offending:
            print(f"  {update_command(rel, args)}")
    else:
        print(
            f"file-size: OK ({duration_ms} ms; {len(offenders)} oversized, none grew, no new offenders)"
        )
    return exit_code


if __name__ == "__main__":
    sys.exit(main())
