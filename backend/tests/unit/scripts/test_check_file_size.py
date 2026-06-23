"""Green-path test for the file-size ratchet."""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[4]
CHECK = REPO_ROOT / "scripts" / "fitness" / "check_file_size.py"


def test_current_tree_matches_baseline() -> None:
    proc = subprocess.run([sys.executable, str(CHECK)], capture_output=True, text=True, timeout=20)
    assert proc.returncode == 0, f"a file grew past its baseline\n{proc.stdout}"
