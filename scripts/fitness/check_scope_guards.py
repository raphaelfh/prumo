#!/usr/bin/env python3
"""check_scope_guards.py — prumo fitness function (ratchet).

Enforces one rule: **an ownership predicate is written once.**

An ownership predicate is the SQL that binds a client-supplied id to the
caller's scope — `ExtractionEntityType.id == x AND .project_template_id == y`,
`ProjectExtractionTemplate.id == x AND .project_id == y`, and friends. Every
BOLA incident in this repo has been a place where one of these was missing,
forgotten, or subtly different from its sibling. They are cheap to copy and
expensive to keep in sync, so the second copy is what this gate blocks.

Two detectors, one AST pass, one baseline:

  duplicate-predicate — the same (model, {columns}) signature filtered in two
      different functions. Grandfathered copies live in the baseline; a NEW
      one fails. Shrink the baseline as they are consolidated.

  membership-sql — raw `public.project_members` SQL outside
      `api/deps/security.py`. Membership must go through the `is_project_*`
      helpers, which are the SAME functions the RLS policies call; a
      hand-rolled copy is how the API and the DB drift apart.

Baseline format: one `rule::key` per line. Shrinking is always allowed.

Usage:
  python check_scope_guards.py [--repo-root P] [--baseline P]
  python check_scope_guards.py --update-baseline
  python check_scope_guards.py --report        # group duplicates, no exit code

Exit codes: 0 (no new duplication) | 1 (regression) | 2 (internal).
"""

from __future__ import annotations

import argparse
import ast
import json
import sys
import time
from collections import defaultdict
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
DEFAULT_REPO_ROOT = SCRIPT_DIR.parent.parent
DEFAULT_BASELINE = SCRIPT_DIR / "check_scope_guards.baseline"

SCAN_ROOT = "backend/app"
SKIP_DIR_NAMES = {"__pycache__", ".venv", "venv", "alembic"}

#: Columns that scope a row to a caller. A `.where()` mentioning two or more
#: of these (one of them an id) is an ownership predicate, not a plain lookup.
SCOPE_COLUMNS = {
    "project_id",
    "article_id",
    "template_id",
    "project_template_id",
    "entity_type_id",
    "user_id",
    "created_by",
    "run_id",
    "instance_id",
}

#: Raw membership SQL belongs to exactly one module — the one whose helpers
#: the RLS policies also call.
MEMBERSHIP_SQL_HOME = "backend/app/api/deps/security.py"
MEMBERSHIP_SQL_MARKERS = ("project_members",)


def _iter_py(repo_root: Path):
    base = repo_root / SCAN_ROOT
    if not base.exists():
        return
    for path in sorted(base.rglob("*.py")):
        if any(part in SKIP_DIR_NAMES for part in path.parts):
            continue
        yield path


def _predicate_signature(call: ast.Call) -> tuple[str, tuple[str, ...]] | None:
    """The (model, scope columns) a `.where(...)` binds by equality.

    An ownership predicate pins ONE row by `id` and narrows it by at least
    one owner column. That shape — and only that shape — is what "a
    client-supplied id bound to the caller's scope" means; a filter over two
    scope columns with no `id` is a list query, not a guard, and treating it
    as one made 54% of an earlier baseline noise.

    The signature deliberately ignores NON-scope columns, so adding an
    unrelated clause cannot disguise a copy: `claim_draft_lock`'s
    `config_draft_by` term does not hide its `{id, project_id}` predicate.

    Only `Model.column == <expr>` comparisons count; a `.where()` built from
    anything else is not a predicate we can reason about.
    """
    models: set[str] = set()
    columns: set[str] = set()
    for arg in call.args:
        for node in ast.walk(arg):
            if not isinstance(node, ast.Compare) or len(node.ops) != 1:
                continue
            if not isinstance(node.ops[0], ast.Eq):
                continue
            left = node.left
            if not isinstance(left, ast.Attribute) or not isinstance(left.value, ast.Name):
                continue
            models.add(left.value.id)
            columns.add(left.attr)
    scoped = columns & SCOPE_COLUMNS
    if len(models) != 1 or "id" not in columns or not scoped:
        return None
    return next(iter(models)), tuple(sorted(scoped | {"id"}))


def _function_spans(tree: ast.AST) -> list[tuple[int, int, str]]:
    """(first line, last line, name) per function, outermost first."""
    return [
        (node.lineno, node.end_lineno or node.lineno, node.name)
        for node in ast.walk(tree)
        if isinstance(node, ast.FunctionDef | ast.AsyncFunctionDef)
    ]


def scan(repo_root: Path) -> tuple[dict[str, list[str]], list[str]]:
    """Return (signature -> [sites], membership_sql_sites)."""
    by_signature: dict[str, list[str]] = defaultdict(list)
    membership: list[str] = []

    for path in _iter_py(repo_root):
        rel = path.relative_to(repo_root).as_posix()
        try:
            source = path.read_text(encoding="utf-8")
            tree = ast.parse(source)
        except (OSError, SyntaxError):
            continue

        if rel != MEMBERSHIP_SQL_HOME:
            # String literals only, via the AST: a COMMENT mentioning the
            # table (including the ones explaining this very rule) is not SQL.
            for node in ast.walk(tree):
                if not isinstance(node, ast.Constant) or not isinstance(node.value, str):
                    continue
                text_upper = node.value.upper()
                if any(m in node.value for m in MEMBERSHIP_SQL_MARKERS) and (
                    "FROM" in text_upper or "JOIN" in text_upper
                ):
                    membership.append(f"{rel}:{node.lineno}")

        spans = _function_spans(tree)
        for node in ast.walk(tree):
            if not isinstance(node, ast.Call):
                continue
            func = node.func
            if not isinstance(func, ast.Attribute) or func.attr != "where":
                continue
            sig = _predicate_signature(node)
            if sig is None:
                continue
            model, columns = sig
            key = f"{model}{{{','.join(columns)}}}"
            fn = next(
                (name for lo, hi, name in spans if lo <= node.lineno <= hi), "<module>"
            )
            site = f"{rel}::{fn}"
            if site not in by_signature[key]:
                by_signature[key].append(site)

    return by_signature, membership


def _findings(by_signature: dict[str, list[str]], membership: list[str]) -> list[str]:
    out: list[str] = []
    for key, sites in sorted(by_signature.items()):
        if len(sites) < 2:
            continue
        for site in sites:
            out.append(f"duplicate-predicate::{key}::{site}")
    out.extend(f"membership-sql::{site}" for site in membership)
    return sorted(out)


def load_baseline(path: Path) -> set[str]:
    if not path.is_file():
        return set()
    entries: set[str] = set()
    for raw in path.read_text(encoding="utf-8").splitlines():
        ln = raw.strip()
        if not ln or ln.startswith("#"):
            continue
        # "key  # why it is grandfathered" — the reason is documentation,
        # not part of the key.
        entries.add(ln.split("#", 1)[0].strip())
    return entries


def write_baseline(path: Path, findings: list[str]) -> None:
    """Rewrite the baseline, PRESERVING each line's `# reason` annotation.

    The rules file requires a reason when grandfathering, so regenerating
    must not silently delete the ones already written.
    """
    reasons: dict[str, str] = {}
    if path.is_file():
        for raw in path.read_text(encoding="utf-8").splitlines():
            ln = raw.strip()
            if not ln or ln.startswith("#") or "#" not in ln:
                continue
            key, _, why = ln.partition("#")
            reasons[key.strip()] = why.strip()

    header = (
        "# scope-guard ratchet baseline — ownership predicates implemented more\n"
        "# than once, frozen at today's set. May shrink, never grow.\n"
        "# Each line is rule::predicate::file::function, optionally followed by\n"
        "#   # why it is grandfathered\n"
        "# Consolidating a group onto one guard removes its lines; see\n"
        "# .claude/rules/backend.md.\n"
    )
    body = "\n".join(f"{f}  # {reasons[f]}" if f in reasons else f for f in findings)
    path.write_text(header + body + ("\n" if body else ""))


def main() -> int:
    parser = argparse.ArgumentParser(description="prumo scope-guard fitness check")
    parser.add_argument("--repo-root", type=Path, default=DEFAULT_REPO_ROOT)
    parser.add_argument("--baseline", type=Path, default=DEFAULT_BASELINE)
    parser.add_argument("--update-baseline", action="store_true")
    parser.add_argument("--report", action="store_true")
    parser.add_argument("--emit-telemetry", default=None)
    parser.add_argument("--jsonl-out", default=None)
    args = parser.parse_args()

    started = time.time()
    by_signature, membership = scan(args.repo_root.resolve())
    findings = _findings(by_signature, membership)

    if args.report:
        for key, sites in sorted(by_signature.items()):
            if len(sites) < 2:
                continue
            print(f"\n{key}  ({len(sites)} sites)")
            for site in sites:
                print(f"    {site}")
        print(f"\nmembership-sql: {len(membership)} site(s)")
        for site in membership:
            print(f"    {site}")
        return 0

    if args.update_baseline:
        write_baseline(args.baseline, findings)
        print(f"scope-guard baseline written: {len(findings)} entries -> {args.baseline}")
        return 0

    baseline = load_baseline(args.baseline)
    regressions = sorted(set(findings) - baseline)
    duration_ms = int((time.time() - started) * 1000)

    if args.jsonl_out:
        rows = [
            {
                "category": "scope-guard",
                "severity": "high",
                "confidence": 1.0,
                "file": r.split("::")[-2] if "::" in r else r.split(":")[0],
                "line": 0,
                "evidence": r,
                "suggested_action": (
                    "Import the existing guard instead of re-typing its WHERE."
                ),
                "source": f"fitness:check_scope_guards:{r.split('::')[0]}",
            }
            for r in regressions
        ]
        Path(args.jsonl_out).write_text(
            "\n".join(json.dumps(row) for row in rows) + ("\n" if rows else "")
        )

    if args.emit_telemetry:
        with open(args.emit_telemetry, "a", encoding="utf-8") as handle:
            handle.write(
                json.dumps(
                    {
                        "ts": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                        "phase": "fitness",
                        "gate": "check_scope_guards",
                        "duration_ms": duration_ms,
                        "exit_code": 1 if regressions else 0,
                        "finding_count": len(findings),
                    }
                )
                + "\n"
            )

    if regressions:
        print("check_scope_guards.py: FAIL — a new duplicated ownership predicate")
        for r in regressions:
            print(f"  {r}")
        print(
            "\nAn ownership predicate is written ONCE. Import the existing guard "
            "(app/services/project_template_active_service.owned_template, "
            "template_section_service.owned_section, "
            "repositories/extraction_repository.get_in_coordinate) instead of "
            "re-typing its WHERE. If this really is a new pair, add the guard in "
            "one place and baseline it with a reason."
        )
        return 1

    print(
        f"check_scope_guards: OK ({duration_ms} ms; {len(findings)} baselined "
        f"duplication sites, none new)"
    )
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as exc:  # pragma: no cover - internal failure path
        print(f"check_scope_guards.py: internal error: {exc}", file=sys.stderr)
        sys.exit(2)
