"""Canary for the file-size ratchet in scripts/fitness/check_file_size.py."""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[4]
CHECK = REPO_ROOT / "scripts" / "fitness" / "check_file_size.py"


def _mk(root: Path, rel: str, lines: int) -> None:
    f = root / rel
    f.parent.mkdir(parents=True, exist_ok=True)
    f.write_text("x = 1\n" * lines)


def _run(root: Path, baseline: Path, max_lines: int = 50):
    return subprocess.run(
        [
            sys.executable,
            str(CHECK),
            "--repo-root",
            str(root),
            "--baseline",
            str(baseline),
            "--max-lines",
            str(max_lines),
        ],
        capture_output=True,
        text=True,
        timeout=15,
    )


def test_new_offender_fails(tmp_path: Path) -> None:
    _mk(tmp_path, "backend/app/new_god.py", 80)
    baseline = tmp_path / "bl"
    baseline.write_text("")
    proc = _run(tmp_path, baseline)
    assert proc.returncode == 1, proc.stdout
    assert "new_god.py" in proc.stdout


def test_baselined_growth_fails(tmp_path: Path) -> None:
    _mk(tmp_path, "backend/app/god.py", 90)
    baseline = tmp_path / "bl"
    baseline.write_text("backend/app/god.py:80\n")
    proc = _run(tmp_path, baseline)
    assert proc.returncode == 1, proc.stdout


def test_baselined_unchanged_passes(tmp_path: Path) -> None:
    _mk(tmp_path, "backend/app/god.py", 80)
    baseline = tmp_path / "bl"
    baseline.write_text("backend/app/god.py:80\n")
    proc = _run(tmp_path, baseline)
    assert proc.returncode == 0, proc.stdout


def test_baselined_shrink_passes(tmp_path: Path) -> None:
    _mk(tmp_path, "backend/app/god.py", 60)
    baseline = tmp_path / "bl"
    baseline.write_text("backend/app/god.py:80\n")
    proc = _run(tmp_path, baseline)
    assert proc.returncode == 0, proc.stdout
