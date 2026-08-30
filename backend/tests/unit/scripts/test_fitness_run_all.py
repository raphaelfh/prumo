"""Green-path test for scripts/fitness/run_all.sh.

Shells out to the aggregator script; asserts it exits 0 against the current tree.
This is the regression test that ensures: (a) the harness composes correctly,
(b) every check exit 0 on `dev` HEAD, (c) wiring of a new check does not break
the harness.

A failing canary belongs in its own file (`test_check_<name>_canary.py`); this
file's purpose is to confirm the *current* tree is clean.
"""

from __future__ import annotations

import re
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


def test_every_check_on_disk_is_wired_into_run_all() -> None:
    """A check that is not in run_all.sh does not run, and nothing else notices.

    `test_verify_all_gates.py::test_gate_roster_is_pinned` gives `verify_all.sh`
    this protection one level up; without the same here, deleting a `run_check`
    block silently disarms an architectural gate with a green suite.
    """
    fitness_dir = REPO_ROOT / "scripts" / "fitness"
    on_disk = {
        p.name
        for p in fitness_dir.iterdir()
        if p.name.startswith("check_") and p.suffix in {".py", ".sh"}
    }
    wired = set(re.findall(r"check_[a-z_]+\.(?:py|sh)", RUN_ALL.read_text(encoding="utf-8")))
    assert on_disk - wired == set(), f"checks not wired into run_all.sh: {sorted(on_disk - wired)}"
