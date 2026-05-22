"""Green-path test for scripts/fitness/check_rls_coverage.py.

Asserts every `extraction_*` and `project_*` table has at least one
CREATE POLICY on the current tree (or matches the baseline).
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[4]
CHECK = REPO_ROOT / "scripts" / "fitness" / "check_rls_coverage.py"


def test_rls_clean_on_current_tree() -> None:
    proc = subprocess.run(
        [sys.executable, str(CHECK)],
        capture_output=True,
        text=True,
        timeout=15,
    )
    assert proc.returncode == 0, (
        f"new RLS-coverage violation (rc={proc.returncode})\n---STDOUT---\n{proc.stdout}\n"
    )
