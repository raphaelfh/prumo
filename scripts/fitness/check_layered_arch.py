#!/usr/bin/env python3
"""check_layered_arch.py — prumo fitness function.

AST-parses every `.py` under `backend/app/{api,services,repositories,models}/`
and builds an import graph. Enforces the layering DAG from
`.specify/memory/constitution.md` Principle I:

    api -> services, schemas, core, utils, exceptions, domain   (NEVER repositories or models)
    services -> repositories, schemas, models, core, utils, exceptions, domain, services
    repositories -> models, schemas, core, utils, exceptions    (NEVER services or api)
    models -> (data only; no business logic enforced here — see check_layered_arch_models.py)

Cross-cutting allowed everywhere: `app.core`, `app.utils`, `app.config`,
`app.exceptions`, `app.domain`.

A `.baseline` file (newline-list of `file:imported_module`) grandfathers
known pre-existing violations.

Exit codes: 0 | 1 | 2.
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

# Layer source dirs (under backend/app/) we care about; everything else is a
# "support" prefix (allowed import target from any layer).
LAYERS = ("api", "services", "repositories", "models")
SUPPORT_PREFIXES = (
    "app.core",
    "app.utils",
    "app.config",
    "app.exceptions",
    "app.domain",
    "app.schemas",
)

# Allowed outbound edges from each layer to other layers.
ALLOWED: dict[str, set[str]] = {
    "api": {"services"},  # NOT repositories or models
    "services": {"repositories", "models", "services"},
    "repositories": {"models"},  # NOT services or api
    "models": set(),  # leaf
}


@dataclass
class Edge:
    file: str  # repo-relative
    line: int
    from_layer: str
    to_module: str  # full module path, e.g. "app.repositories.foo"
    to_layer: str  # one of LAYERS

    def stable_id(self) -> str:
        return f"{self.file}:{self.to_module}"


def _layer_of(rel_path: str) -> str | None:
    """Return the layer this file lives in, or None if not in a tracked layer."""
    parts = Path(rel_path).parts
    try:
        i = parts.index("app")
    except ValueError:
        return None
    if i + 1 < len(parts) and parts[i + 1] in LAYERS:
        return parts[i + 1]
    return None


def _layer_of_module(module: str) -> str | None:
    """Map an import target like `app.services.foo` to layer `services`."""
    if not module.startswith("app."):
        return None
    parts = module.split(".")
    if len(parts) >= 2 and parts[1] in LAYERS:
        return parts[1]
    return None


def _is_support(module: str) -> bool:
    return any(module == p or module.startswith(p + ".") for p in SUPPORT_PREFIXES)


def scan_file(path: Path, rel: str) -> list[Edge]:
    layer = _layer_of(rel)
    if layer is None:
        return []
    try:
        tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
    except (OSError, SyntaxError):
        return []
    edges: list[Edge] = []
    for node in ast.walk(tree):
        modules: list[tuple[str, int]] = []
        if isinstance(node, ast.ImportFrom) and node.module:
            modules.append((node.module, node.lineno))
        elif isinstance(node, ast.Import):
            for alias in node.names:
                modules.append((alias.name, node.lineno))
        for module, lineno in modules:
            if _is_support(module):
                continue
            tgt = _layer_of_module(module)
            if tgt is None:
                continue
            if tgt == layer:
                continue  # same-layer is allowed
            if tgt in ALLOWED[layer]:
                continue
            edges.append(Edge(rel, lineno, layer, module, tgt))
    return edges


def scan(root: Path) -> list[Edge]:
    base = root / APP_ROOT
    if not base.is_dir():
        return []
    edges: list[Edge] = []
    for path in sorted(base.rglob("*.py")):
        if path.name == "__init__.py":
            continue
        rel = str(path.relative_to(root))
        edges.extend(scan_file(path, rel))
    return edges


def load_baseline(path: Path) -> set[str]:
    if not path.is_file():
        return set()
    return {
        line.strip()
        for line in path.read_text(encoding="utf-8").splitlines()
        if line.strip() and not line.strip().startswith("#")
    }


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
    edges = scan(root)
    duration_ms = int((time.time() - started) * 1000)

    baseline = load_baseline(baseline_path)
    new_violations = [e for e in edges if e.stable_id() not in baseline]
    exit_code = 1 if new_violations else 0

    if args.jsonl_out:
        rows = [
            {
                "category": "layered-arch",
                "severity": "high",
                "confidence": 1.0,
                "file": e.file,
                "line": e.line,
                "evidence": f"{e.from_layer} imports from {e.to_module} ({e.to_layer})",
                "suggested_action": f"Move the call behind a {' or '.join(sorted(ALLOWED[e.from_layer])) or '<none>'} boundary.",
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
                "edge_count": len(edges),
                "new_violation_count": len(new_violations),
                "baseline_size": len(baseline),
            }
        )
        with open(args.emit_telemetry, "a", encoding="utf-8") as fh:
            fh.write(line + "\n")

    if new_violations:
        print(
            f"check_layered_arch.py: FAIL ({duration_ms} ms; "
            f"{len(new_violations)} forbidden edges, {len(baseline)} grandfathered)"
        )
        print("Forbidden edges (file:line → imported_module):")
        for e in new_violations:
            print(f"  {e.file}:{e.line} [{e.from_layer}] -> {e.to_module} [{e.to_layer}]")
        print(f"To grandfather: add 'file:imported_module' to {baseline_path.relative_to(root)}")
    else:
        msg = f"{len(edges)} edges checked"
        if baseline:
            msg += f", {len(baseline)} grandfathered"
        print(f"check_layered_arch.py: OK ({duration_ms} ms; {msg})")

    return exit_code


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
