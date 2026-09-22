#!/usr/bin/env python3
"""check_response_descriptions.py — prumo fitness function.

AST-parses every ``.py`` under ``backend/app/`` and, for every call passing a
``responses=`` keyword (``@router.<method>(...)``, ``APIRouter(...)``,
``include_router(...)``), asserts each entry is a dict literal carrying an
explicit ``"description"``.

Why: FastAPI defaults a missing description to ``http.HTTPStatus(code).phrase``,
which varies with the generator's Python (422 is "Unprocessable Entity" on
3.11/3.12, "Unprocessable Content" on 3.13). The committed contract
(``frontend/types/api/openapi.json``) must not depend on who regenerated it.

A ``responses=`` value the AST cannot see into (a name, a ``**`` spread, a
call) is reported too: unverifiable counts as a violation. Absolute — no
baseline.

Exit codes: 0 (clean) | 1 (violation).
"""

from __future__ import annotations

import argparse
import ast
import sys
from pathlib import Path

DEFAULT_REPO_ROOT = Path(__file__).resolve().parent.parent.parent
SCAN_DIR = "backend/app"


def _check_responses(value: ast.expr) -> list[tuple[int, str]]:
    """Return ``(line, reason)`` for every entry of ``responses=`` lacking a description."""
    if not isinstance(value, ast.Dict):
        return [(value.lineno, f"responses= is not a dict literal: {ast.unparse(value)}")]
    out: list[tuple[int, str]] = []
    for key, entry in zip(value.keys, value.values, strict=True):
        if key is None:
            out.append((entry.lineno, f"**{ast.unparse(entry)} spread is not verifiable"))
            continue
        code = ast.unparse(key)
        if not isinstance(entry, ast.Dict):
            out.append((entry.lineno, f"{code}: entry is not a dict literal"))
        elif not any(isinstance(k, ast.Constant) and k.value == "description" for k in entry.keys):
            out.append((entry.lineno, f'{code}: missing explicit "description"'))
    return out


def scan(root: Path) -> list[str]:
    findings: list[str] = []
    for path in sorted((root / SCAN_DIR).rglob("*.py")):
        rel = path.relative_to(root)
        tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        for node in ast.walk(tree):
            if not isinstance(node, ast.Call):
                continue
            for kw in node.keywords:
                if kw.arg == "responses":
                    findings.extend(
                        f"{rel}:{line}  {reason}" for line, reason in _check_responses(kw.value)
                    )
    return findings


def main(argv: list[str]) -> int:
    p = argparse.ArgumentParser(description="prumo explicit OpenAPI response description check")
    p.add_argument("--repo-root", default=None)
    args = p.parse_args(argv)
    root = Path(args.repo_root).resolve() if args.repo_root else DEFAULT_REPO_ROOT

    findings = scan(root)
    if not findings:
        print("check_response_descriptions.py: OK")
        return 0
    print(f"check_response_descriptions.py: FAIL ({len(findings)} violations)")
    print('Every responses= entry needs an explicit "description" (the default is')
    print("http.HTTPStatus(code).phrase, which differs across Python versions):")
    for f in findings:
        print(f"  {f}")
    return 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
