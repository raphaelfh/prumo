"""Green-path test for scripts/fitness/check_glossary_sync.py.

Asserts the skill's glossary mirror and the canonical architecture doc are
in sync on the current tree.
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[4]
CHECK = REPO_ROOT / "scripts" / "fitness" / "check_glossary_sync.py"


def test_glossary_sync_clean_on_current_tree() -> None:
    proc = subprocess.run(
        [sys.executable, str(CHECK)],
        capture_output=True,
        text=True,
        timeout=15,
    )
    assert proc.returncode == 0, (
        f"glossary drift detected on current tree (rc={proc.returncode})\n"
        f"---STDOUT---\n{proc.stdout}\n"
    )
    assert "in sync" in proc.stdout
