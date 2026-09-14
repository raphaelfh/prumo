#!/usr/bin/env python3
"""check_frontend_data_path.py — prumo fitness function (ratchet).

Enforces the single read path (constitution §VI): browser code reads backend
data through the typed apiClient. Outside `frontend/integrations/` and test
code, it counts per file:
  - `supabase.from(<table>)` — a direct table read, keyed by the literal table
    name, or `<dynamic>` when the argument is not a literal
    (`supabase.auth` and `supabase.storage.from` do not match);
  - `import.meta.env.VITE_API_URL` — ad-hoc base-URL wiring around the client.

The scan runs over whole files with comments blanked out, so a chain split
across lines counts and a mention in a comment does not.

Baseline format: one `file|key:count` line per grandfathered group. A new key
or a higher count fails. A lower count passes and asks for `--update-baseline`,
which only ever lowers counts. A read moved to another file is a new key.

Exit codes: 0 (no new key, no growth) | 1 (regression) | 2 (internal).
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import time
from dataclasses import dataclass
from pathlib import Path

from _ts_source import strip_comments

SCRIPT_DIR = Path(__file__).resolve().parent
DEFAULT_REPO_ROOT = SCRIPT_DIR.parent.parent
DEFAULT_BASELINE = SCRIPT_DIR / "check_frontend_data_path.baseline"

FRONTEND_ROOT = "frontend"
# The integration layer owns the clients; tests and e2e never ship to the browser.
EXEMPT_PREFIXES = ("frontend/integrations/", "frontend/test/", "frontend/e2e/")
EXEMPT_NAME_MARKERS = (".test.", ".spec.")
SKIP_DIRS = {
    "node_modules",
    "dist",
    "build",
    ".next",
    "coverage",
    "test-results",
    "playwright-report",
}

TABLE_READ = re.compile(r"\bsupabase\s*\.\s*(from)\s*\(\s*(?:(['\"`])([\w.-]+)\2)?")
API_URL = re.compile(r"\bimport\.meta\.env\.VITE_API_URL\b")
DYNAMIC = "<dynamic>"


@dataclass(frozen=True)
class Site:
    file: str
    key: str
    line: int

    @property
    def group(self) -> str:
        return f"{self.file}|{self.key}"


def _line_of(text: str, offset: int) -> int:
    return text.count("\n", 0, offset) + 1


def scan_text(rel: str, text: str) -> list[Site]:
    src = strip_comments(text)
    sites = [
        Site(rel, m.group(3) or DYNAMIC, _line_of(src, m.start(1)))
        for m in TABLE_READ.finditer(src)
    ]
    sites += [Site(rel, "VITE_API_URL", _line_of(src, m.start())) for m in API_URL.finditer(src)]
    return sites


def _in_scope(rel: str, path: Path) -> bool:
    if path.suffix not in {".ts", ".tsx"} or any(part in SKIP_DIRS for part in path.parts):
        return False
    if rel.startswith(EXEMPT_PREFIXES):
        return False
    return not any(marker in path.name for marker in EXEMPT_NAME_MARKERS)


def scan(root: Path) -> list[Site]:
    fe = root / FRONTEND_ROOT
    if not fe.is_dir():
        return []
    sites: list[Site] = []
    for path in sorted(fe.rglob("*")):
        rel = path.relative_to(root).as_posix()
        if path.is_file() and _in_scope(rel, path):
            sites += scan_text(rel, path.read_text(encoding="utf-8", errors="replace"))
    return sites


def count_groups(sites: list[Site]) -> dict[str, int]:
    counts: dict[str, int] = {}
    for site in sites:
        counts[site.group] = counts.get(site.group, 0) + 1
    return counts


def read_baseline(path: Path) -> dict[str, int]:
    if not path.is_file():
        return {}
    out: dict[str, int] = {}
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        group, _, count = line.rpartition(":")
        if group and count.isdigit():
            out[group] = int(count)
    return out


def write_baseline(path: Path, counts: dict[str, int]) -> None:
    lines = [
        "# Frontend data-path ratchet (constitution §VI): direct supabase.from reads",
        "# and VITE_API_URL wiring still in browser code, as `file|table:count`.",
        "# May shrink (run --update-baseline to tighten), never grow. A read moved",
        "# to another file is a new key.",
    ]
    lines += [f"{group}:{n}" for group, n in sorted(counts.items())]
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def regressions(
    counts: dict[str, int], baseline: dict[str, int]
) -> list[tuple[str, str, int, int]]:
    """(group, label, found, allowed) for every new group or grown count."""
    out = []
    for group, n in sorted(counts.items()):
        allowed = baseline.get(group, 0)
        if n > allowed:
            out.append((group, "NEW " if group not in baseline else "GREW", n, allowed))
    return out


def report_regressions(found: list[tuple[str, str, int, int]], sites: list[Site]) -> None:
    lines_by_group: dict[str, list[Site]] = {}
    for site in sites:
        lines_by_group.setdefault(site.group, []).append(site)
    for group, label, n, allowed in found:
        print(f"  {label} {group}: {n} (baseline {allowed})")
        for site in lines_by_group[group]:
            print(f"         {site.file}:{site.line}")


def main(argv: list[str]) -> int:
    p = argparse.ArgumentParser(description="prumo frontend single-read-path ratchet")
    p.add_argument("--repo-root", type=Path, default=DEFAULT_REPO_ROOT)
    p.add_argument("--baseline", type=Path, default=DEFAULT_BASELINE)
    p.add_argument("--emit-telemetry", type=Path, default=None)
    p.add_argument("--jsonl-out", type=Path, default=None)
    p.add_argument("--update-baseline", action="store_true")
    args = p.parse_args(argv)

    started = time.time()
    sites = scan(args.repo_root.resolve())
    counts = count_groups(sites)
    baseline = read_baseline(args.baseline)
    found = regressions(counts, baseline)
    shrunk = sorted(g for g, allowed in baseline.items() if counts.get(g, 0) < allowed)
    exit_code = 1 if found else 0

    if args.update_baseline:
        if found:
            print("check_frontend_data_path.py: refusing to update — the baseline only shrinks:")
            report_regressions(found, sites)
            return 1
        write_baseline(args.baseline, counts)
        print(f"check_frontend_data_path.py: baseline updated ({len(counts)} group(s))")
        return 0

    if args.jsonl_out:
        offending = {group for group, *_ in found}
        rows = [
            {
                "category": "data-path",
                "severity": "high",
                "confidence": 0.9,
                "file": site.file,
                "line": site.line,
                "evidence": site.group,
                "suggested_action": "Route through apiClient (frontend/integrations/api/client.ts); supabase only for auth/storage.",
                "source": "fitness:check_frontend_data_path",
            }
            for site in sites
            if site.group in offending
        ]
        args.jsonl_out.write_text("".join(json.dumps(r) + "\n" for r in rows), encoding="utf-8")

    if args.emit_telemetry:
        with args.emit_telemetry.open("a", encoding="utf-8") as fh:
            fh.write(
                json.dumps(
                    {
                        "ts": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                        "phase": "fitness",
                        "gate": "check_frontend_data_path",
                        "duration_ms": int((time.time() - started) * 1000),
                        "exit_code": exit_code,
                        "violation_count": len(sites),
                        "new_violation_count": len(found),
                        "baseline_size": len(baseline),
                    }
                )
                + "\n"
            )

    if found:
        print("check_frontend_data_path.py: FAIL — direct data-path reads grew:")
        report_regressions(found, sites)
        print("Route the read through apiClient (frontend/integrations/api/client.ts);")
        print("supabase in browser code is for auth and storage only.")
        return 1

    print(
        f"check_frontend_data_path.py: OK ({len(sites)} site(s) in {len(counts)} baselined group(s))"
    )
    if shrunk:
        print(
            "The baseline can shrink — run `python3 scripts/fitness/check_frontend_data_path.py --update-baseline`:"
        )
        for group in shrunk:
            print(f"  {group}: {counts.get(group, 0)} (baseline {baseline[group]})")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main(sys.argv[1:]))
    except Exception as exc:  # noqa: BLE001 - the harness contract wants exit 2
        print(f"check_frontend_data_path.py: internal error: {exc}")
        sys.exit(2)
