"""Green-path test for the copy-key ratchet.

Runs the check with NO flags, so it exercises the default `--repo-root` and
`--baseline` wiring the canary never touches. It also asserts the scanner
actually sees the real tree: this gate's characteristic failure is silence — a
parser that stops finding namespaces reports zero dead keys and stays green
forever, which reads as assurance while protecting nothing. `returncode == 0`
alone cannot tell that apart from a passing gate.
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[4]
CHECK = REPO_ROOT / "scripts" / "fitness" / "check_copy_keys.py"
COPY_DIR = REPO_ROOT / "frontend" / "lib" / "copy"


def test_current_tree_matches_baseline() -> None:
    proc = subprocess.run([sys.executable, str(CHECK)], capture_output=True, text=True, timeout=60)
    assert proc.returncode == 0, f"a copy key went unreferenced\n{proc.stdout}"


def test_scanner_sees_real_dead_keys_without_a_baseline() -> None:
    """Positive proof the parser works on real source, not just fixtures."""
    proc = subprocess.run(
        [sys.executable, str(CHECK), "--baseline", "/dev/null"],
        capture_output=True,
        text=True,
        timeout=60,
    )
    assert proc.returncode == 1, (
        "scanning the real tree with no baseline found nothing — the parser is broken"
    )
    assert "frontend/lib/copy/" in proc.stdout


def test_every_namespace_file_is_parsed() -> None:
    """Guards the silent-skip failure: one unparsed namespace = one ungated file.

    The expectation is built from `export const` headers found by an INDEPENDENT
    recursive walk, deliberately not from `namespace_files()`'s own glob — an
    earlier version of this test compared that glob against itself and therefore
    asserted nothing at all.
    """
    import importlib.util

    spec = importlib.util.spec_from_file_location("check_copy_keys", CHECK)
    assert spec is not None and spec.loader is not None
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)

    on_disk = {
        p
        for p in COPY_DIR.rglob("*")
        if p.is_file()
        and p.suffix in {".ts", ".tsx"}
        and "export const" in p.read_text(encoding="utf-8")
        and "__tests__" not in p.parts
        and p.name != "index.ts"
    }
    parsed = set(mod.namespace_files(REPO_ROOT))
    assert parsed == on_disk, f"namespaces missed by the parser: {on_disk - parsed}"

    total = 0
    for path in parsed:
        keys = mod.parse_namespace(path)
        assert keys, f"{path.name} parsed to zero keys"
        total += len(keys)
    assert total > 1500, (
        f"only {total} keys parsed across {len(parsed)} namespaces — the parser has "
        "gone partially blind"
    )
