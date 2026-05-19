"""Green-path test for scripts/fitness/run_all.sh.

Shells out to the aggregator script; asserts it exits 0 against the current tree.
This is the regression test that ensures: (a) the harness composes correctly,
(b) every check exit 0 on `dev` HEAD, (c) wiring of a new check does not break
the harness.

A failing canary belongs in its own file (`test_check_<name>_canary.py`); this
file's purpose is to confirm the *current* tree is clean.
"""

from __future__ import annotations

import subprocess
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[4]
RUN_ALL = REPO_ROOT / "scripts" / "fitness" / "run_all.sh"


def test_run_all_exits_zero_on_current_tree() -> None:
    assert RUN_ALL.is_file(), f"missing harness script: {RUN_ALL}"
    proc = subprocess.run(
        ["bash", str(RUN_ALL)],
        capture_output=True,
        text=True,
        cwd=REPO_ROOT,
        timeout=60,
    )
    assert proc.returncode == 0, (
        f"scripts/fitness/run_all.sh failed (rc={proc.returncode})\n"
        f"---STDOUT---\n{proc.stdout}\n"
        f"---STDERR---\n{proc.stderr}\n"
    )
    # Sanity: each check should have reported in stdout.
    assert "check_migration_split.sh" in proc.stdout
    assert "check_legacy_concepts.py" in proc.stdout
