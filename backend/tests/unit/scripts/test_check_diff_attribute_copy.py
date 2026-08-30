"""Green-path test for scripts/fitness/check_diff_attribute_copy.py."""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[4]
CHECK = REPO_ROOT / "scripts" / "fitness" / "check_diff_attribute_copy.py"


def test_every_diff_attribute_has_a_human_label() -> None:
    proc = subprocess.run([sys.executable, str(CHECK)], capture_output=True, text=True, timeout=15)
    assert proc.returncode == 0, f"unlabelled diff attribute\n{proc.stdout}"
