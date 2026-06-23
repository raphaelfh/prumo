"""Canary for scripts/fitness/check_skill_router_sync.py."""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[4]
CHECK = REPO_ROOT / "scripts" / "fitness" / "check_skill_router_sync.py"


def _setup(root: Path, router_skills: list[str], real_skills: list[str]) -> None:
    claude = root / "CLAUDE.md"
    lines = ["# x", "", "## Which skill to load", ""]
    lines += [f"- area → `{s}`" for s in router_skills]
    claude.write_text("\n".join(lines) + "\n")
    for s in real_skills:
        (root / ".claude" / "skills" / s).mkdir(parents=True, exist_ok=True)


def _run(root: Path):
    return subprocess.run(
        [sys.executable, str(CHECK), "--repo-root", str(root)],
        capture_output=True,
        text=True,
        timeout=15,
    )


def test_dead_router_entry_fails(tmp_path: Path) -> None:
    _setup(
        tmp_path,
        router_skills=["backend-development", "ghost-skill"],
        real_skills=["backend-development"],
    )
    proc = _run(tmp_path)
    assert proc.returncode == 1, proc.stdout
    assert "ghost-skill" in proc.stdout


def test_in_sync_passes(tmp_path: Path) -> None:
    _setup(
        tmp_path,
        router_skills=["backend-development", "code-review"],
        real_skills=["backend-development", "code-review", "debugging"],
    )
    proc = _run(tmp_path)
    assert proc.returncode == 0, proc.stdout
