#!/usr/bin/env python3
"""check_frontend_data_path.py — prumo fitness function.

Enforces the single read path (constitution §VI): all backend data flows
through the typed apiClient. Flags, OUTSIDE `frontend/integrations/`:
  - `supabase.from(` — direct table reads (auth/storage are allowed via
    supabase.auth/.storage, which this does not match)
  - `import.meta.env.VITE_API_URL` — ad-hoc base-URL wiring around the client

Regex-based (does not parse TS); a `.baseline` grandfathers residual sites.
Note: comments are not exempt — a line containing the pattern in a comment is
still flagged and must be baselined if intentional.

Exit codes: 0 (baseline matched) | 1 (new violation) | 2 (internal).
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
ALLOWED_PREFIX = "frontend/integrations/"
SKIP_DIRS = {
    "node_modules",
    "dist",
    "build",
    ".next",
    "coverage",
    "test-results",
    "playwright-report",
}

PATTERNS = (
    re.compile(r"\bsupabase\s*\.\s*from\s*\("),
    re.compile(r"\bimport\.meta\.env\.VITE_API_URL\b"),
)


@dataclass
class Violation:
    file: str
    line: int
    snippet: str

    def stable_id(self) -> str:
        return f"{self.file}:{self.line}"


def _walk(start: Path):
    for p in start.rglob("*"):
        if (
            p.is_file()
            and p.suffix in {".ts", ".tsx"}
            and not any(part in SKIP_DIRS for part in p.parts)
        ):
            yield p


def scan(root: Path) -> list[Violation]:
    fe = root / FRONTEND_ROOT
    if not fe.is_dir():
        return []
    out: list[Violation] = []
    for path in sorted(_walk(fe)):
        rel = path.relative_to(root).as_posix()
        if rel.startswith(ALLOWED_PREFIX):
            continue
        try:
            text = path.read_text(encoding="utf-8", errors="ignore")
        except OSError:
            continue
        for i, line in enumerate(text.splitlines(), start=1):
            if any(pat.search(line) for pat in PATTERNS):
                out.append(Violation(rel, i, line.strip()[:160]))
    return out


def load_baseline(path: Path) -> set[str]:
    if not path.is_file():
        return set()
    return {
        ln.strip()
        for ln in path.read_text(encoding="utf-8").splitlines()
        if ln.strip() and not ln.strip().startswith("#")
    }


def main(argv: list[str]) -> int:
    p = argparse.ArgumentParser(description="prumo frontend single-read-path enforcement")
    p.add_argument("--repo-root", default=None)
    p.add_argument("--baseline", default=None)
    p.add_argument("--emit-telemetry", default=None)
    p.add_argument("--jsonl-out", default=None)
    args = p.parse_args(argv)

    root = Path(args.repo_root).resolve() if args.repo_root else DEFAULT_REPO_ROOT
    baseline_path = (
        Path(args.baseline) if args.baseline else SCRIPT_DIR / "check_frontend_data_path.baseline"
    )

    started = time.time()
    violations = scan(root)
    duration_ms = int((time.time() - started) * 1000)
    baseline = load_baseline(baseline_path)
    new = [v for v in violations if v.stable_id() not in baseline]
    exit_code = 1 if new else 0

    if args.jsonl_out:
        rows = [
            {
                "category": "data-path",
                "severity": "high",
                "confidence": 0.9,
                "file": v.file,
                "line": v.line,
                "evidence": v.snippet,
                "suggested_action": "Route through apiClient (frontend/integrations/api/client.ts); supabase only for auth/storage.",
                "source": "fitness:check_frontend_data_path",
            }
            for v in new
        ]
        Path(args.jsonl_out).write_text(
            "\n".join(json.dumps(r) for r in rows) + ("\n" if rows else "")
        )

    if args.emit_telemetry:
        with open(args.emit_telemetry, "a", encoding="utf-8") as fh:
            fh.write(
                json.dumps(
                    {
                        "ts": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                        "phase": "fitness",
                        "gate": "check_frontend_data_path",
                        "duration_ms": duration_ms,
                        "exit_code": exit_code,
                        "violation_count": len(violations),
                        "new_violation_count": len(new),
                        "baseline_size": len(baseline),
                    }
                )
                + "\n"
            )

    if new:
        print(
            f"check_frontend_data_path.py: FAIL ({duration_ms} ms; {len(new)} new, {len(baseline)} grandfathered)"
        )
        print("NEW direct-data-path violations (route through apiClient):")
        for v in new[:10]:
            print(f"  {v.file}:{v.line}  {v.snippet[:100]}")
        print(f"To grandfather a known site: add 'file:line' to {baseline_path.name}.")
    else:
        print(
            f"check_frontend_data_path.py: OK ({duration_ms} ms; {len(violations)} found, {len(baseline)} grandfathered)"
        )
    return exit_code


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
