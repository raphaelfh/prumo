"""Canary for scripts/fitness/check_react_query_keys.py.

Plants a synthetic .ts file with a literal `queryKey: [...]` array and asserts
the check exits 1; verifies that a factory-call form does NOT trip the check.
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[4]
CHECK = REPO_ROOT / "scripts" / "fitness" / "check_react_query_keys.py"
FRONTEND = "frontend"


def _run(tmp_root: Path, baseline: Path | None = None) -> subprocess.CompletedProcess[str]:
    args = [sys.executable, str(CHECK), "--repo-root", str(tmp_root)]
    args.extend(["--baseline", str(baseline) if baseline else "/dev/null"])
    return subprocess.run(args, capture_output=True, text=True, timeout=15)


def test_fires_on_literal_query_key(tmp_path: Path) -> None:
    f = tmp_path / FRONTEND / "hooks" / "useFoo.ts"
    f.parent.mkdir(parents=True, exist_ok=True)
    f.write_text(
        "import { useQuery } from '@tanstack/react-query';\n"
        "export function useFoo(id: string) {\n"
        "  return useQuery({ queryKey: ['foo', id], queryFn: () => null });\n"
        "}\n"
    )
    proc = _run(tmp_path)
    assert proc.returncode == 1, proc.stdout + proc.stderr
    assert "useFoo.ts" in proc.stdout


def test_clean_on_factory_call(tmp_path: Path) -> None:
    f = tmp_path / FRONTEND / "hooks" / "useGood.ts"
    f.parent.mkdir(parents=True, exist_ok=True)
    f.write_text(
        "import { useQuery } from '@tanstack/react-query';\n"
        "import { fooKeys } from '@/lib/query-keys';\n"
        "export function useGood(id: string) {\n"
        "  return useQuery({ queryKey: fooKeys.detail(id), queryFn: () => null });\n"
        "}\n"
    )
    proc = _run(tmp_path)
    assert proc.returncode == 0, proc.stdout + proc.stderr


def test_query_keys_factories_themselves_are_ignored(tmp_path: Path) -> None:
    """frontend/lib/query-keys/<ns>.ts file legitimately contains literal `[...]`
    arrays inside factory definitions; the check must NOT flag them."""
    f = tmp_path / FRONTEND / "lib" / "query-keys" / "foo.ts"
    f.parent.mkdir(parents=True, exist_ok=True)
    f.write_text(
        "export const fooKeys = {\n"
        "  all: ['foo'] as const,\n"
        "  detail: (id: string) => [...fooKeys.all, 'detail', id] as const,\n"
        "} as const;\n"
        "const queryKey: ['foo'] = ['foo'];  // type-level literal — would otherwise match\n"
    )
    proc = _run(tmp_path)
    assert proc.returncode == 0, proc.stdout + proc.stderr


def test_baseline_grandfathers_violation(tmp_path: Path) -> None:
    f = tmp_path / FRONTEND / "hooks" / "useLegacy.ts"
    f.parent.mkdir(parents=True, exist_ok=True)
    f.write_text(
        "import { useQuery } from '@tanstack/react-query';\n"
        "export function useLegacy() {\n"
        "  return useQuery({ queryKey: ['legacy'], queryFn: () => null });\n"
        "}\n"
    )
    baseline = tmp_path / "bl"
    baseline.write_text(f"{FRONTEND}/hooks/useLegacy.ts:3\n")
    proc = subprocess.run(
        [sys.executable, str(CHECK), "--repo-root", str(tmp_path), "--baseline", str(baseline)],
        capture_output=True,
        text=True,
        timeout=15,
    )
    assert proc.returncode == 0, proc.stdout + proc.stderr


def test_node_modules_ignored(tmp_path: Path) -> None:
    """Literal queryKey deep inside node_modules must NOT be flagged."""
    f = tmp_path / FRONTEND / "node_modules" / "third-party" / "index.ts"
    f.parent.mkdir(parents=True, exist_ok=True)
    f.write_text("export const x = { queryKey: ['z'] };\n")
    proc = _run(tmp_path)
    assert proc.returncode == 0, proc.stdout + proc.stderr
