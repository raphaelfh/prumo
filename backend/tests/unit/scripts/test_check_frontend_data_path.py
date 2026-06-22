"""Green-path test for scripts/fitness/check_frontend_data_path.py."""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[4]
CHECK = REPO_ROOT / "scripts" / "fitness" / "check_frontend_data_path.py"


def test_data_path_clean_or_baseline_matched() -> None:
    proc = subprocess.run([sys.executable, str(CHECK)], capture_output=True, text=True, timeout=15)
    assert proc.returncode == 0, f"new data-path violation\n{proc.stdout}"
