"""Canary for scripts/fitness/check_response_descriptions.py.

Plants a synthetic router whose ``responses=`` entry omits ``description`` in a
temp repo root and asserts the check exits 1. Without this, a future change
that breaks the AST walker would lie green.
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[4]
CHECK = REPO_ROOT / "scripts" / "fitness" / "check_response_descriptions.py"
ENDPOINTS_REL = "backend/app/api/v1/endpoints"


def _plant(tmp_root: Path, body: str) -> None:
    f = tmp_root / ENDPOINTS_REL / "planted.py"
    f.parent.mkdir(parents=True, exist_ok=True)
    f.write_text("from fastapi import APIRouter, status\nrouter = APIRouter()\n\n" + body)


def _run(tmp_root: Path) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, str(CHECK), "--repo-root", str(tmp_root)],
        capture_output=True,
        text=True,
        timeout=15,
    )


def test_fires_on_route_response_without_description(tmp_path: Path) -> None:
    _plant(
        tmp_path,
        "@router.post('/x', responses={status.HTTP_422_UNPROCESSABLE_CONTENT: {'model': M}})\n"
        "async def x() -> None: ...\n",
    )
    proc = _run(tmp_path)
    assert proc.returncode == 1, proc.stdout + proc.stderr
    assert "planted.py:4" in proc.stdout
    assert "HTTP_422_UNPROCESSABLE_CONTENT" in proc.stdout


def test_fires_on_router_level_responses(tmp_path: Path) -> None:
    """``APIRouter(responses=...)`` / ``include_router(responses=...)`` default the same way."""
    _plant(tmp_path, "other = APIRouter(responses={404: {'model': M}})\n")
    proc = _run(tmp_path)
    assert proc.returncode == 1, proc.stdout + proc.stderr


def test_fires_on_non_literal_responses(tmp_path: Path) -> None:
    """A ``responses=`` the AST cannot see into is unverifiable — fail, don't pass."""
    _plant(
        tmp_path,
        "R = {409: {'model': M}}\n@router.get('/x', responses=R)\nasync def x() -> None: ...\n",
    )
    proc = _run(tmp_path)
    assert proc.returncode == 1, proc.stdout + proc.stderr
    assert "not a dict literal" in proc.stdout


def test_clean_when_every_response_has_description(tmp_path: Path) -> None:
    _plant(
        tmp_path,
        "@router.get('/x', responses={409: {'model': M, 'description': 'Refused'}})\n"
        "async def x() -> None: ...\n",
    )
    proc = _run(tmp_path)
    assert proc.returncode == 0, proc.stdout + proc.stderr


def test_live_tree_clean() -> None:
    proc = subprocess.run([sys.executable, str(CHECK)], capture_output=True, text=True, timeout=15)
    assert proc.returncode == 0, proc.stdout + proc.stderr
