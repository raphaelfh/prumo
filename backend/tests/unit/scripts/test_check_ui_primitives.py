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


BASELINE = REPO_ROOT / "scripts" / "fitness" / "check_ui_primitives.baseline"


def test_tree_is_clean_with_no_baseline() -> None:
    proc = subprocess.run(
        [sys.executable, str(CHECK), "--baseline", "/dev/null"],
        capture_output=True,
        text=True,
        timeout=60,
    )
    assert proc.returncode == 0, proc.stdout
    assert "OK (0 " in proc.stdout


def test_baseline_file_is_gone() -> None:
    """The migration finished. A baseline file would let a violation back in unnoticed."""
    assert not BASELINE.exists(), "re-adding check_ui_primitives.baseline re-opens the ratchet"
