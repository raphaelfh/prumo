#!/usr/bin/env python3
"""check_react_query_keys.py — prumo fitness function.

Scans every `.ts` / `.tsx` file under `frontend/` for TanStack-Query call sites
that use a **literal array** as their `queryKey`:

    useQuery({ queryKey: ['projects', id], ... })   // violation

Allowed pattern (the convention introduced by `frontend/lib/query-keys/`):

    useQuery({ queryKey: projectKeys.detail(id), ... })   // OK — factory call

The check is regex-based — it does NOT parse TypeScript. False positives are
possible (and a `.baseline` file grandfathers known call sites). False
negatives are also possible (multi-line key expressions that bend the regex).
The intent is to catch the **common** case at PR time; the LLM scanner
covers the rest.

Exit codes: 0 (baseline matched) | 1 (new literal queryKey) | 2 (internal).
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import time
from dataclasses import dataclass
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
DEFAULT_REPO_ROOT = SCRIPT_DIR.parent.parent

FRONTEND_ROOT = "frontend"
SKIP_DIRS = {
    "node_modules",
    "dist",
    "build",
    ".next",
    "coverage",
    "test-results",
    "playwright-report",
}

# Match `queryKey: [` — the literal-array pattern. Allows whitespace + optional
# leading 'as const' qualifiers. NOTE: this is intentionally a coarse regex; it
# flags any `queryKey: [`. Multi-line factory calls span multiple lines and are
# NOT flagged because they start with `(` not `[`.
QUERYKEY_LITERAL_RE = re.compile(r"\bqueryKey\s*:\s*\[", re.MULTILINE)


@dataclass
class Violation:
    file: str  # repo-relative
    line: int
    snippet: str

    def stable_id(self) -> str:
        return f"{self.file}:{self.line}"


def _walk(start: Path):
    for p in start.rglob("*"):
        if not p.is_file():
            continue
        if p.suffix not in {".ts", ".tsx"}:
            continue
        if any(part in SKIP_DIRS for part in p.parts):
            continue
        yield p


def scan(root: Path) -> list[Violation]:
    fe = root / FRONTEND_ROOT
    if not fe.is_dir():
        return []
    out: list[Violation] = []
    for path in sorted(_walk(fe)):
        try:
            text = path.read_text(encoding="utf-8", errors="ignore")
        except OSError:
            continue
        # Skip the query-keys factories themselves — they LEGITIMATELY contain
        # literal arrays as the base case (`all: ['projects'] as const`).
        rel = str(path.relative_to(root))
        if rel.startswith(f"{FRONTEND_ROOT}/lib/query-keys/"):
            continue
        for m in QUERYKEY_LITERAL_RE.finditer(text):
            line_no = text.count("\n", 0, m.start()) + 1
            line_start = text.rfind("\n", 0, m.start()) + 1
            line_end = text.find("\n", m.end())
            snippet = text[line_start : (line_end if line_end != -1 else len(text))].strip()
            out.append(Violation(rel, line_no, snippet[:160]))
    return out


def load_baseline(path: Path) -> set[str]:
    if not path.is_file():
        return set()
    return {
        line.strip()
        for line in path.read_text(encoding="utf-8").splitlines()
        if line.strip() and not line.strip().startswith("#")
    }


def main(argv: list[str]) -> int:
    p = argparse.ArgumentParser(description="prumo TanStack-Query key factory enforcement")
    p.add_argument("--repo-root", default=None)
    p.add_argument("--baseline", default=None)
    p.add_argument("--emit-telemetry", default=None)
    p.add_argument("--jsonl-out", default=None)
    args = p.parse_args(argv)

    root = Path(args.repo_root).resolve() if args.repo_root else DEFAULT_REPO_ROOT
    baseline_path = (
        Path(args.baseline) if args.baseline else SCRIPT_DIR / "check_react_query_keys.baseline"
    )

    started = time.time()
    violations = scan(root)
    duration_ms = int((time.time() - started) * 1000)

    baseline = load_baseline(baseline_path)
    new_violations = [v for v in violations if v.stable_id() not in baseline]
    exit_code = 1 if new_violations else 0

    if args.jsonl_out:
        rows = [
            {
                "category": "layered-arch",
                "severity": "medium",
                "confidence": 0.9,
                "file": v.file,
                "line": v.line,
                "evidence": v.snippet,
                "suggested_action": "Route the queryKey through a factory in frontend/lib/query-keys/ — see that dir's README.",
                "source": "fitness:check_react_query_keys",
            }
            for v in new_violations
        ]
        Path(args.jsonl_out).write_text(
            "\n".join(json.dumps(r) for r in rows) + ("\n" if rows else "")
        )

    if args.emit_telemetry:
        line = json.dumps(
            {
                "ts": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                "phase": "fitness",
                "gate": "check_react_query_keys",
                "duration_ms": duration_ms,
                "exit_code": exit_code,
                "violation_count": len(violations),
                "new_violation_count": len(new_violations),
                "baseline_size": len(baseline),
            }
        )
        with open(args.emit_telemetry, "a", encoding="utf-8") as fh:
            fh.write(line + "\n")

    if new_violations:
        print(
            f"check_react_query_keys.py: FAIL ({duration_ms} ms; "
            f"{len(new_violations)} new literal queryKeys, {len(baseline)} grandfathered)"
        )
        print("NEW literal queryKey violations (route through frontend/lib/query-keys/<ns>):")
        for v in new_violations[:10]:
            print(f"  {v.file}:{v.line}  {v.snippet[:100]}")
        if len(new_violations) > 10:
            print(f"  ... ({len(new_violations) - 10} more; use --jsonl-out to capture all)")
        print(f"To grandfather a known site: add 'file:line' to {baseline_path.relative_to(root)}.")
    else:
        msg = f"{len(violations)} literal queryKeys found"
        if baseline:
            msg += f", {len(baseline)} grandfathered"
        print(f"check_react_query_keys.py: OK ({duration_ms} ms; {msg})")

    return exit_code


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
