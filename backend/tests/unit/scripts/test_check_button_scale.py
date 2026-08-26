"""Green-path test for the button-scale ratchet.

Runs the check with NO flags, so it exercises the default `--repo-root` and
`--baseline` wiring the canary never touches. It also asserts the committed
baseline is non-empty and that the scanner actually sees the real tree: a
checker whose paths silently resolve to nothing would exit 0 forever, and
`returncode == 0` alone cannot tell that apart from a passing gate.
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[4]
CHECK = REPO_ROOT / "scripts" / "fitness" / "check_button_scale.py"
BASELINE = REPO_ROOT / "scripts" / "fitness" / "check_button_scale.baseline"


def test_current_tree_matches_baseline() -> None:
    proc = subprocess.run([sys.executable, str(CHECK)], capture_output=True, text=True, timeout=30)
    assert proc.returncode == 0, f"a file grew past its baseline\n{proc.stdout}"


def test_baseline_is_not_empty() -> None:
    """The migration is incomplete by design, so the baseline holds the rest.

    An empty baseline here means either the ratchet finished (tighten this
    test and delete it) or — far more likely — the scanner stopped seeing the
    tree and the gate has silently become a no-op.
    """
    entries = [
        line
        for line in BASELINE.read_text().splitlines()
        if line.strip() and not line.startswith("#")
    ]
    assert len(entries) > 20, (
        f"baseline collapsed to {len(entries)} entries — is the scanner still seeing frontend/?"
    )


def test_scanner_sees_real_offenders_without_a_baseline() -> None:
    """Positive proof the parser works on real source, not just fixtures."""
    proc = subprocess.run(
        [sys.executable, str(CHECK), "--baseline", "/dev/null"],
        capture_output=True,
        text=True,
        timeout=30,
    )
    assert proc.returncode == 1, (
        "scanning the real tree with no baseline found nothing — the parser is broken"
    )
    assert "frontend/" in proc.stdout
