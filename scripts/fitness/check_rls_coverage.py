#!/usr/bin/env python3
"""check_rls_coverage.py — prumo fitness function.

For every `extraction_*` or `project_*` table declared in Alembic
(`backend/alembic/versions/`) or Supabase (`supabase/migrations/`) migration
files, asserts that at least one `CREATE POLICY ... ON <table>` exists
across the same files (in either system).

A `.baseline` file (newline-list of bare table names) grandfathers tables
known to be policy-less today. A new table without a policy fails the gate.

Exit codes: 0 (every table has policy or matches baseline) | 1 (new table
without policy) | 2 (internal error).
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import time
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
DEFAULT_REPO_ROOT = SCRIPT_DIR.parent.parent

ALEMBIC_DIR = "backend/alembic/versions"
SUPABASE_DIR = "supabase/migrations"

# Match CREATE TABLE [IF NOT EXISTS] ["public".]?["]?extraction_X|project_X["]?
# — handles quoted schema/table identifiers and case-insensitivity.
TABLE_RE = re.compile(
    r"""\bCREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?
        (?:["']?public["']?\s*\.\s*)?
        ["']?((?:extraction|project)_[a-zA-Z_]\w*)["']?""",
    re.IGNORECASE | re.VERBOSE,
)
# Match CREATE POLICY <name> ON [public.]?<table> (quoted variants too).
POLICY_RE = re.compile(
    r"""\bCREATE\s+POLICY\s+\S+\s+ON\s+
        (?:["']?public["']?\s*\.\s*)?
        ["']?((?:extraction|project)_[a-zA-Z_]\w*)["']?""",
    re.IGNORECASE | re.VERBOSE,
)


def collect(root: Path) -> tuple[set[str], set[str]]:
    """Return (tables, policied_tables) seen across Alembic + Supabase dirs."""
    tables: set[str] = set()
    policied: set[str] = set()
    for sub in (ALEMBIC_DIR, SUPABASE_DIR):
        d = root / sub
        if not d.is_dir():
            continue
        for path in d.rglob("*"):
            if not path.is_file() or path.suffix.lower() not in {".py", ".sql"}:
                continue
            if "archive" in path.parts:
                continue
            try:
                text = path.read_text(encoding="utf-8", errors="ignore")
            except OSError:
                continue
            for m in TABLE_RE.finditer(text):
                tables.add(m.group(1).lower())
            for m in POLICY_RE.finditer(text):
                policied.add(m.group(1).lower())
    return tables, policied


def load_baseline(path: Path) -> set[str]:
    if not path.is_file():
        return set()
    return {
        line.strip().lower()
        for line in path.read_text(encoding="utf-8").splitlines()
        if line.strip() and not line.strip().startswith("#")
    }


def main(argv: list[str]) -> int:
    p = argparse.ArgumentParser(description="prumo RLS-coverage fitness check")
    p.add_argument("--repo-root", default=None)
    p.add_argument("--baseline", default=None)
    p.add_argument("--emit-telemetry", default=None)
    p.add_argument("--jsonl-out", default=None)
    args = p.parse_args(argv)

    root = Path(args.repo_root).resolve() if args.repo_root else DEFAULT_REPO_ROOT
    baseline_path = (
        Path(args.baseline) if args.baseline else SCRIPT_DIR / "check_rls_coverage.baseline"
    )

    started = time.time()
    tables, policied = collect(root)
    missing = sorted(t for t in tables if t not in policied)
    duration_ms = int((time.time() - started) * 1000)

    baseline = load_baseline(baseline_path)
    new_missing = [t for t in missing if t not in baseline]
    exit_code = 1 if new_missing else 0

    if args.jsonl_out:
        rows = [
            {
                "category": "security",
                "severity": "high",
                "confidence": 1.0,
                "file": ALEMBIC_DIR,
                "line": 0,
                "evidence": f"table '{t}' has no CREATE POLICY",
                "suggested_action": "Add at least one RLS policy on this table (likely is_project_member(...) or is_project_reviewer(...)).",
                "source": "fitness:check_rls_coverage",
            }
            for t in new_missing
        ]
        Path(args.jsonl_out).write_text(
            "\n".join(json.dumps(r) for r in rows) + ("\n" if rows else "")
        )

    if args.emit_telemetry:
        line = json.dumps(
            {
                "ts": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                "phase": "fitness",
                "gate": "check_rls_coverage",
                "duration_ms": duration_ms,
                "exit_code": exit_code,
                "finding_count": len(missing),
                "new_violation_count": len(new_missing),
                "baseline_size": len(baseline),
                "table_count": len(tables),
                "policied_count": len(policied),
            }
        )
        with open(args.emit_telemetry, "a", encoding="utf-8") as fh:
            fh.write(line + "\n")

    if new_missing:
        print(
            f"check_rls_coverage.py: FAIL ({duration_ms} ms; "
            f"{len(new_missing)} new tables without policy, {len(baseline)} grandfathered)"
        )
        print("Tables missing at least one CREATE POLICY:")
        for t in new_missing:
            print(f"  - {t}")
        print(
            f"Fix: add a CREATE POLICY in an Alembic migration; or list in {baseline_path.relative_to(root)}."
        )
    else:
        msg = f"{len(tables)} tables, {len(policied)} with policies"
        if baseline:
            msg += f", {len(baseline)} grandfathered"
        print(f"check_rls_coverage.py: OK ({duration_ms} ms; {msg})")

    return exit_code


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
