"""Green-path test for scripts/fitness/check_layered_arch.py.

Asserts the backend layering DAG has no new violations on the current tree
(baseline-grandfathered ones are not counted as new).
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[4]
CHECK = REPO_ROOT / "scripts" / "fitness" / "check_layered_arch.py"


def test_layered_arch_clean_or_baseline_matched() -> None:
    proc = subprocess.run(
        [sys.executable, str(CHECK)],
        capture_output=True,
        text=True,
        timeout=15,
    )
    assert proc.returncode == 0, (
        f"new layered-arch violation (rc={proc.returncode})\n---STDOUT---\n{proc.stdout}\n"
    )
