"""Green-path test for scripts/fitness/check_scope_guards.py.

Asserts the current tree adds no ownership predicate beyond the baselined
set, and that the baseline itself stays honest.
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[4]
CHECK = REPO_ROOT / "scripts" / "fitness" / "check_scope_guards.py"
BASELINE = REPO_ROOT / "scripts" / "fitness" / "check_scope_guards.baseline"


def test_scope_guards_clean_or_baseline_matched() -> None:
    proc = subprocess.run(
        [sys.executable, str(CHECK)],
        capture_output=True,
        text=True,
        timeout=30,
    )
    assert proc.returncode == 0, (
        f"new duplicated ownership predicate (rc={proc.returncode})\n---STDOUT---\n{proc.stdout}\n"
    )


def test_baseline_has_no_stale_entries() -> None:
    """A ratchet only shrinks if stale lines are noticed.

    The check passes silently when a baselined site disappears, so the
    baseline would keep entries for guards that were already consolidated.
    """
    proc = subprocess.run(
        [sys.executable, str(CHECK), "--report"],
        capture_output=True,
        text=True,
        timeout=30,
    )
    assert proc.returncode == 0, proc.stdout + proc.stderr

    live = {f"{fn.strip()}" for fn in proc.stdout.splitlines() if fn.startswith("    backend/")}
    baselined = {
        ln.split("#", 1)[0].strip().split("::")[-2]
        + "::"
        + ln.split("#", 1)[0].strip().split("::")[-1]
        for ln in BASELINE.read_text().splitlines()
        if ln.strip() and not ln.startswith("#") and ln.startswith("duplicate-predicate")
    }
    stale = sorted(baselined - live)
    assert not stale, (
        "these baseline entries no longer exist — the predicate was consolidated, "
        f"so tighten the baseline: {stale}"
    )
