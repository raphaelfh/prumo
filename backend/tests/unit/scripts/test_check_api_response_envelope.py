"""Green-path test for scripts/fitness/check_api_response_envelope.py.

Asserts the script exits 0 on the current tree — either every endpoint returns
ApiResponse[T] or the violators are grandfathered in `.baseline`.
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[4]
CHECK = REPO_ROOT / "scripts" / "fitness" / "check_api_response_envelope.py"


def test_envelope_clean_or_baseline_matched() -> None:
    proc = subprocess.run(
        [sys.executable, str(CHECK)],
        capture_output=True,
        text=True,
        timeout=15,
    )
    assert proc.returncode == 0, (
        f"new ApiResponse envelope violation (rc={proc.returncode})\n---STDOUT---\n{proc.stdout}\n"
    )
