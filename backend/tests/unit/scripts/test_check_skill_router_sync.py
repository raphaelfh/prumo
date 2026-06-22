"""Green-path test for scripts/fitness/check_skill_router_sync.py."""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[4]
CHECK = REPO_ROOT / "scripts" / "fitness" / "check_skill_router_sync.py"


def test_router_in_sync_with_skills() -> None:
    proc = subprocess.run([sys.executable, str(CHECK)], capture_output=True, text=True, timeout=15)
    assert proc.returncode == 0, f"dead router entry\n{proc.stdout}"
