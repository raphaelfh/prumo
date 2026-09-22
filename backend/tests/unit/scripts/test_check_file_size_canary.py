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


def _update(root: Path, baseline: Path, *paths: str, max_lines: int = 50):
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
            "--update-baseline",
            *paths,
        ],
        capture_output=True,
        text=True,
        timeout=15,
    )


def _entries(baseline: Path) -> dict[str, int]:
    out: dict[str, int] = {}
    for ln in baseline.read_text().splitlines():
        if ln and not ln.startswith("#"):
            rel, _, num = ln.rpartition(":")
            out[rel] = int(num)
    return out


def test_update_baseline_touches_only_named_path(tmp_path: Path) -> None:
    # shrunk.py shrank in another PR; this PR must not tighten it.
    _mk(tmp_path, "backend/app/shrunk.py", 60)
    _mk(tmp_path, "backend/app/grew.py", 90)
    baseline = tmp_path / "bl"
    baseline.write_text("backend/app/grew.py:80\nbackend/app/shrunk.py:100\n")
    proc = _update(tmp_path, baseline, "backend/app/grew.py")
    assert proc.returncode == 0, proc.stdout + proc.stderr
    assert _entries(baseline) == {"backend/app/grew.py": 90, "backend/app/shrunk.py": 100}


def test_update_baseline_adds_named_new_offender(tmp_path: Path) -> None:
    _mk(tmp_path, "backend/app/new_god.py", 70)
    _mk(tmp_path, "backend/app/other_new.py", 70)
    baseline = tmp_path / "bl"
    baseline.write_text("")
    proc = _update(tmp_path, baseline, "backend/app/new_god.py")
    assert proc.returncode == 0, proc.stdout + proc.stderr
    assert _entries(baseline) == {"backend/app/new_god.py": 70}


def test_update_baseline_drops_named_path_now_under_ceiling(tmp_path: Path) -> None:
    _mk(tmp_path, "backend/app/split.py", 40)
    baseline = tmp_path / "bl"
    baseline.write_text("backend/app/split.py:80\nbackend/app/keep.py:90\n")
    proc = _update(tmp_path, baseline, "backend/app/split.py")
    assert proc.returncode == 0, proc.stdout + proc.stderr
    assert _entries(baseline) == {"backend/app/keep.py": 90}


def test_update_baseline_accepts_several_paths(tmp_path: Path) -> None:
    _mk(tmp_path, "backend/app/a.py", 70)
    _mk(tmp_path, "frontend/b.tsx", 75)
    baseline = tmp_path / "bl"
    baseline.write_text("backend/app/a.py:60\nbackend/app/c.py:99\n")
    proc = _update(tmp_path, baseline, "backend/app/a.py", "frontend/b.tsx")
    assert proc.returncode == 0, proc.stdout + proc.stderr
    assert _entries(baseline) == {
        "backend/app/a.py": 70,
        "backend/app/c.py": 99,
        "frontend/b.tsx": 75,
    }


def test_update_baseline_without_paths_is_rejected(tmp_path: Path) -> None:
    _mk(tmp_path, "backend/app/shrunk.py", 60)
    baseline = tmp_path / "bl"
    baseline.write_text("backend/app/shrunk.py:100\n")
    proc = _update(tmp_path, baseline)
    assert proc.returncode == 2, proc.stdout + proc.stderr
    assert _entries(baseline) == {"backend/app/shrunk.py": 100}


def test_update_baseline_unknown_path_is_rejected(tmp_path: Path) -> None:
    _mk(tmp_path, "backend/app/god.py", 70)
    baseline = tmp_path / "bl"
    baseline.write_text("backend/app/god.py:60\n")
    proc = _update(tmp_path, baseline, "backend/app/god.py", "backend/app/typo.py")
    assert proc.returncode == 2, proc.stdout + proc.stderr
    assert "backend/app/typo.py" in proc.stdout + proc.stderr
    assert _entries(baseline) == {"backend/app/god.py": 60}


def test_failure_names_file_and_per_path_command(tmp_path: Path) -> None:
    _mk(tmp_path, "backend/app/god.py", 90)
    _mk(tmp_path, "backend/app/new_god.py", 70)
    baseline = tmp_path / "bl"
    baseline.write_text("backend/app/god.py:80\n")
    proc = _run(tmp_path, baseline)
    assert proc.returncode == 1, proc.stdout
    for rel in ("backend/app/god.py", "backend/app/new_god.py"):
        assert f"--update-baseline {rel}" in proc.stdout, proc.stdout
    # The bare whole-tree rewrite must no longer be suggested.
    assert "run --update-baseline and commit" not in proc.stdout
