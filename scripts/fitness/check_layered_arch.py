#!/usr/bin/env python3
"""check_layered_arch.py — prumo fitness function.

AST-parses every `.py` under `backend/app/` (package `__init__.py` files
included), resolves each import — absolute, relative, and `from app import x`
— to an `app.*` module, and checks every edge against the layering DAG of
`docs/reference/constitution.md` Principle I:

    api          -> services, support, entrypoints   (NEVER repositories or models)
    services     -> repositories, models, support, entrypoints
    repositories -> models, support                   (NEVER services or api)
    models       -> support                           (leaf)
    support      -> support                           (NEVER a layer)

Edges inside one kind are always allowed. Support packages are importable from
every layer, which is exactly why they may not import a layer back: otherwise
`api -> app.schemas -> app.models` launders the edge the api rule forbids.
Entrypoints (`worker`, `main`, the seed scripts) are composition roots and are
not checked as importers.

A `.baseline` file (one `file:imported_module` per line, `# reason` after it)
grandfathers known pre-existing violations. It may shrink, never grow.

Exit codes: 0 clean | 1 new forbidden edges | 2 the scan cannot be trusted —
no files or no import edges collected, an unparsable file, or a top-level
`app` package no rule classifies. A gate that inspected nothing must not
print OK.
"""

from __future__ import annotations

import argparse
import ast
import json
import sys
import time
from dataclasses import dataclass
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
DEFAULT_REPO_ROOT = SCRIPT_DIR.parent.parent
APP_ROOT = "backend/app"

# Every top-level member of backend/app must be classified here; an
# unclassified one fails the scan (exit 2) instead of going unchecked.
LAYERS = ("api", "services", "repositories", "models")
SUPPORT = frozenset({"core", "domain", "infrastructure", "llm", "schemas", "utils"})
ENTRYPOINTS = frozenset({"main", "seed", "seed_probast_ai", "seed_probast_ai_data", "worker"})

# Allowed outbound edges per importer kind, besides edges within the same kind.
ALLOWED: dict[str, set[str]] = {
    "api": {"services", "support", "entrypoint"},
    "services": {"repositories", "models", "support", "entrypoint"},
    "repositories": {"models", "support"},
    "models": {"support"},
    "support": set(),
}


class ScanError(Exception):
    """The scan result cannot be trusted (exit 2)."""


@dataclass
class Edge:
    file: str  # repo-relative
    line: int
    from_kind: str
    to_module: str  # full module path, e.g. "app.repositories.foo"
    to_kind: str

    def stable_id(self) -> str:
        return f"{self.file}:{self.to_module}"


def _kind(top: str) -> str | None:
    if top in LAYERS:
        return top
    if top in SUPPORT:
        return "support"
    if top in ENTRYPOINTS:
        return "entrypoint"
    return None


def _targets(node: ast.Import | ast.ImportFrom, module: list[str], is_package: bool) -> list[str]:
    """Absolute module names an import statement reaches."""
    if isinstance(node, ast.Import):
        return [alias.name for alias in node.names]
    if node.level:
        package = module if is_package else module[:-1]
        keep = len(package) - (node.level - 1)
        if keep < 1:
            return []  # beyond the top-level package; Python rejects it too
        resolved = ".".join(package[:keep] + ([node.module] if node.module else []))
    else:
        resolved = node.module or ""
    if resolved == "app":  # `from app import services` reaches app.services
        return [f"app.{alias.name}" for alias in node.names]
    return [resolved]


def scan(root: Path) -> tuple[int, int, list[Edge]]:
    """Return (files scanned, app.* edges checked, forbidden edges)."""
    base = root / APP_ROOT
    files = sorted(base.rglob("*.py")) if base.is_dir() else []
    if not files:
        raise ScanError(f"no .py files under {base}")

    edge_count = 0
    violations: list[Edge] = []
    for path in files:
        rel = path.relative_to(root).as_posix()
        module = list(path.relative_to(base.parent).with_suffix("").parts)
        is_package = module[-1] == "__init__"
        if is_package:
            module.pop()
        if len(module) < 2:
            continue  # backend/app/__init__.py, the package root
        src = _kind(module[1])
        if src is None:
            raise ScanError(
                f"{rel}: top-level package 'app.{module[1]}' is unclassified — "
                "add it to LAYERS, SUPPORT or ENTRYPOINTS"
            )
        if src == "entrypoint":
            continue
        try:
            tree = ast.parse(path.read_text(encoding="utf-8"), filename=rel)
        except (OSError, SyntaxError, ValueError) as exc:
            raise ScanError(f"{rel}: cannot parse ({exc})") from exc

        for node in ast.walk(tree):
            if not isinstance(node, (ast.Import, ast.ImportFrom)):
                continue
            for target in _targets(node, module, is_package):
                parts = target.split(".")
                if parts[0] != "app" or len(parts) < 2:
                    continue
                tgt = _kind(parts[1])
                if tgt is None:
                    raise ScanError(
                        f"{rel}:{node.lineno}: imports unclassified package 'app.{parts[1]}'"
                    )
                edge_count += 1
                if tgt != src and tgt not in ALLOWED[src]:
                    violations.append(Edge(rel, node.lineno, src, target, tgt))

    if edge_count == 0:
        raise ScanError(
            f"{len(files)} files scanned but 0 app.* import edges resolved — "
            "the collector is not seeing the imports"
        )
    return len(files), edge_count, violations


def load_baseline(path: Path) -> set[str]:
    """Entries are `file:module`, optionally followed by `# reason`."""
    if not path.is_file():
        return set()
    entries = (
        line.split("#", 1)[0].strip() for line in path.read_text(encoding="utf-8").splitlines()
    )
    return {entry for entry in entries if entry}


def _display(path: Path) -> str:
    try:
        return path.resolve().relative_to(DEFAULT_REPO_ROOT).as_posix()
    except ValueError:
        return str(path)


def main(argv: list[str]) -> int:
    p = argparse.ArgumentParser(description="prumo layered-arch fitness check")
    p.add_argument("--repo-root", default=None)
    p.add_argument("--baseline", default=None)
    p.add_argument("--emit-telemetry", default=None)
    p.add_argument("--jsonl-out", default=None)
    args = p.parse_args(argv)

    root = Path(args.repo_root).resolve() if args.repo_root else DEFAULT_REPO_ROOT
    baseline_path = (
        Path(args.baseline) if args.baseline else SCRIPT_DIR / "check_layered_arch.baseline"
    )

    started = time.time()
    try:
        file_count, edge_count, edges = scan(root)
    except ScanError as exc:
        print(f"check_layered_arch.py: ERROR — {exc}", file=sys.stderr)
        return 2
    duration_ms = int((time.time() - started) * 1000)

    baseline = load_baseline(baseline_path)
    new_violations = [e for e in edges if e.stable_id() not in baseline]
    stale = sorted(baseline - {e.stable_id() for e in edges})
    exit_code = 1 if new_violations else 0

    if args.jsonl_out:
        rows = [
            {
                "category": "layered-arch",
                "severity": "high",
                "confidence": 1.0,
                "file": e.file,
                "line": e.line,
                "evidence": f"{e.from_kind} imports from {e.to_module} ({e.to_kind})",
                "suggested_action": f"Move the call behind a {' or '.join(sorted(ALLOWED[e.from_kind])) or '<none>'} boundary.",
                "source": "fitness:check_layered_arch",
            }
            for e in new_violations
        ]
        Path(args.jsonl_out).write_text(
            "\n".join(json.dumps(r) for r in rows) + ("\n" if rows else "")
        )

    if args.emit_telemetry:
        line = json.dumps(
            {
                "ts": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                "phase": "fitness",
                "gate": "check_layered_arch",
                "duration_ms": duration_ms,
                "exit_code": exit_code,
                "file_count": file_count,
                "edge_count": edge_count,
                "new_violation_count": len(new_violations),
                "baseline_size": len(baseline),
            }
        )
        with open(args.emit_telemetry, "a", encoding="utf-8") as fh:
            fh.write(line + "\n")

    summary = f"{file_count} files, {edge_count} edges checked"
    if new_violations:
        print(
            f"check_layered_arch.py: FAIL ({duration_ms} ms; {summary}; "
            f"{len(new_violations)} forbidden, {len(baseline)} grandfathered)"
        )
        print("Forbidden edges (file:line → imported_module):")
        for e in new_violations:
            print(f"  {e.file}:{e.line} [{e.from_kind}] -> {e.to_module} [{e.to_kind}]")
        print(
            f"Fix the edge. Grandfathering needs 'file:imported_module  # reason' "
            f"in {_display(baseline_path)}."
        )
    else:
        if baseline:
            summary += f", {len(baseline)} grandfathered"
        print(f"check_layered_arch.py: OK ({duration_ms} ms; {summary})")
    if stale:
        print(f"Stale baseline entries (edge is gone — delete the line): {', '.join(stale)}")

    return exit_code


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
