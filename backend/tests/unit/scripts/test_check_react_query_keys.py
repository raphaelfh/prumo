"""Green-path test for scripts/fitness/check_react_query_keys.py.

Asserts the script exits 0 on the current tree (baseline matched). New
literal-queryKey violations beyond the baseline would fail this test.
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[4]
CHECK = REPO_ROOT / "scripts" / "fitness" / "check_react_query_keys.py"


def test_query_keys_clean_or_baseline_matched() -> None:
    proc = subprocess.run(
        [sys.executable, str(CHECK)],
        capture_output=True,
        text=True,
        timeout=15,
    )
    assert proc.returncode == 0, (
        f"new literal queryKey violation (rc={proc.returncode})\n---STDOUT---\n{proc.stdout}\n"
    )
