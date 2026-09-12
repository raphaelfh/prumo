"""Green-path test for the ui-primitives ratchet.

Runs with no flags (exercising the default --repo-root/--baseline wiring) and
proves the scanner sees the real tree, so exit 0 cannot mean "saw nothing".
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[4]
CHECK = REPO_ROOT / "scripts" / "fitness" / "check_ui_primitives.py"


def test_current_tree_matches_baseline() -> None:
    proc = subprocess.run([sys.executable, str(CHECK)], capture_output=True, text=True, timeout=60)
    assert proc.returncode == 0, proc.stdout


def test_scanner_sees_real_offenders_without_a_baseline() -> None:
    """Removed in Task 15, when the tree reaches zero."""
    proc = subprocess.run(
        [sys.executable, str(CHECK), "--baseline", "/dev/null"],
        capture_output=True,
        text=True,
        timeout=60,
    )
    assert proc.returncode == 1, "no offenders found in the real tree — the parser is broken"
    assert "frontend/" in proc.stdout
