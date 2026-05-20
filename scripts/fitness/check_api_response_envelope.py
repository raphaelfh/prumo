#!/usr/bin/env python3
"""check_api_response_envelope.py — prumo fitness function.

AST-parses every router file under `backend/app/api/v1/endpoints/`. For every
function decorated with `@router.<method>(...)` (get/post/put/patch/delete),
asserts the return annotation is `ApiResponse[<T>]` — no raw dicts, no bare
Pydantic models, no missing annotation.

A `.baseline` file (newline-list of `file:line` identifiers) grandfathers
known pre-existing violations. A new violation outside the baseline fails the
gate.

Exit codes: 0 (baseline matched) | 1 (new violation) | 2 (internal error).
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
ENDPOINTS_DIR = "backend/app/api/v1/endpoints"
ROUTER_METHODS = {"get", "post", "put", "patch", "delete", "head", "options"}


@dataclass
class Violation:
    file: str  # repo-relative
    line: int
    func_name: str
    reason: str  # "no_annotation" | "wrong_envelope:<repr>"

    def stable_id(self) -> str:
        return f"{self.file}:{self.func_name}"  # baseline key (line-independent)


def _is_router_decorator(decorator: ast.expr) -> bool:
    """Match `@router.<method>(...)` decorators."""
    call = decorator if isinstance(decorator, ast.Call) else None
    if call is None:
        return False
    func = call.func
    if isinstance(func, ast.Attribute) and isinstance(func.value, ast.Name):
        return func.value.id == "router" and func.attr in ROUTER_METHODS
    return False


def _is_api_response_annotation(node: ast.expr | None) -> bool:
    """True iff the annotation is `ApiResponse[...]` OR a Union with at least
    one `ApiResponse[...]` arm.

    Accepted shapes:
        ApiResponse[T]                            (plain envelope)
        Response | ApiResponse[T]                 (PEP 604 union; either side)
        Optional[ApiResponse[T]]                  (= ApiResponse[T] | None)
        Union[Response, ApiResponse[T]]           (legacy typing.Union)
    """
    if node is None:
        return False
    # Plain ApiResponse[T]
    if isinstance(node, ast.Subscript) and isinstance(node.value, ast.Name):
        if node.value.id == "ApiResponse":
            return True
        # typing.Union[...] — recurse on each arm of the tuple slice.
        if node.value.id == "Union":
            slice_node = node.slice
            if isinstance(slice_node, ast.Tuple):
                return any(_is_api_response_annotation(elt) for elt in slice_node.elts)
            return _is_api_response_annotation(slice_node)
        # typing.Optional[X] == X | None — recurse on the inner arg.
        if node.value.id == "Optional":
            return _is_api_response_annotation(node.slice)
    # PEP 604 union: X | Y → BinOp(BitOr). Recurse on both sides.
    if isinstance(node, ast.BinOp) and isinstance(node.op, ast.BitOr):
        return _is_api_response_annotation(node.left) or _is_api_response_annotation(node.right)
    return False


def _render(node: ast.expr) -> str:
    try:
        return ast.unparse(node)
    except Exception:
        return "<unparsable>"


def scan_file(path: Path, rel: str) -> list[Violation]:
    try:
        source = path.read_text(encoding="utf-8")
        tree = ast.parse(source, filename=str(path))
    except (OSError, SyntaxError):
        return []
    out: list[Violation] = []
    for node in ast.walk(tree):
        if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            continue
        if not any(_is_router_decorator(d) for d in node.decorator_list):
            continue
        if node.returns is None:
            out.append(Violation(rel, node.lineno, node.name, "no_annotation"))
        elif not _is_api_response_annotation(node.returns):
            out.append(
                Violation(
                    rel,
                    node.lineno,
                    node.name,
                    f"wrong_envelope:{_render(node.returns)}",
                )
            )
    return out


def scan(root: Path) -> list[Violation]:
    endpoints = root / ENDPOINTS_DIR
    if not endpoints.is_dir():
        return []
    findings: list[Violation] = []
    for path in sorted(endpoints.rglob("*.py")):
        if path.name == "__init__.py":
            continue
        rel = str(path.relative_to(root))
        findings.extend(scan_file(path, rel))
    return findings


def load_baseline(path: Path) -> set[str]:
    if not path.is_file():
        return set()
    return {
        line.strip()
        for line in path.read_text(encoding="utf-8").splitlines()
        if line.strip() and not line.strip().startswith("#")
    }


def main(argv: list[str]) -> int:
    p = argparse.ArgumentParser(description="prumo ApiResponse-envelope fitness check")
    p.add_argument("--repo-root", default=None)
    p.add_argument("--baseline", default=None)
    p.add_argument("--emit-telemetry", default=None)
    p.add_argument("--jsonl-out", default=None)
    args = p.parse_args(argv)

    root = Path(args.repo_root).resolve() if args.repo_root else DEFAULT_REPO_ROOT
    baseline_path = (
        Path(args.baseline)
        if args.baseline
        else SCRIPT_DIR / "check_api_response_envelope.baseline"
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
                "severity": "high",
                "confidence": 1.0,
                "file": v.file,
                "line": v.line,
                "evidence": f"{v.func_name}: {v.reason}",
                "suggested_action": "Return ApiResponse[T] from every router function (no raw dicts, no bare models).",
                "source": "fitness:check_api_response_envelope",
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
                "gate": "check_api_response_envelope",
                "duration_ms": duration_ms,
                "exit_code": exit_code,
                "finding_count": len(violations),
                "new_violation_count": len(new_violations),
                "baseline_size": len(baseline),
            }
        )
        with open(args.emit_telemetry, "a", encoding="utf-8") as fh:
            fh.write(line + "\n")

    if new_violations:
        print(
            f"check_api_response_envelope.py: FAIL ({duration_ms} ms; "
            f"{len(new_violations)} new violations, {len(baseline)} grandfathered)"
        )
        print("NEW violations (must return ApiResponse[T]):")
        for v in new_violations:
            print(f"  {v.file}:{v.line}  {v.func_name}  [{v.reason}]")
        print("")
        print(f"To grandfather: add 'file:func_name' to {baseline_path.relative_to(root)}")
    else:
        msg = f"baseline matched: {len(baseline)} grandfathered" if baseline else "no violations"
        print(f"check_api_response_envelope.py: OK ({duration_ms} ms; {msg})")

    return exit_code


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
