"""Canary for scripts/fitness/check_frontend_data_path.py."""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[4]
CHECK = REPO_ROOT / "scripts" / "fitness" / "check_frontend_data_path.py"


def _run(tmp_root: Path) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, str(CHECK), "--repo-root", str(tmp_root), "--baseline", "/dev/null"],
        capture_output=True,
        text=True,
        timeout=15,
    )


def test_fires_on_supabase_from_in_component(tmp_path: Path) -> None:
    f = tmp_path / "frontend" / "components" / "x" / "Bad.tsx"
    f.parent.mkdir(parents=True, exist_ok=True)
    f.write_text("const r = await supabase.from('projects').select('*');\n")
    proc = _run(tmp_path)
    assert proc.returncode == 1, proc.stdout + proc.stderr
    assert "Bad.tsx" in proc.stdout


def test_fires_on_vite_api_url(tmp_path: Path) -> None:
    f = tmp_path / "frontend" / "hooks" / "useX.ts"
    f.parent.mkdir(parents=True, exist_ok=True)
    f.write_text("const base = import.meta.env.VITE_API_URL;\n")
    proc = _run(tmp_path)
    assert proc.returncode == 1, proc.stdout + proc.stderr


def test_integration_layer_is_allowed(tmp_path: Path) -> None:
    f = tmp_path / "frontend" / "integrations" / "supabase" / "client.ts"
    f.parent.mkdir(parents=True, exist_ok=True)
    f.write_text("export const q = () => supabase.from('x').select();\n")
    proc = _run(tmp_path)
    assert proc.returncode == 0, proc.stdout + proc.stderr


def test_baseline_grandfathers(tmp_path: Path) -> None:
    f = tmp_path / "frontend" / "services" / "legacyService.ts"
    f.parent.mkdir(parents=True, exist_ok=True)
    f.write_text("const r = supabase.from('legacy').select();\n")
    baseline = tmp_path / "bl"
    baseline.write_text("frontend/services/legacyService.ts:1\n")
    proc = subprocess.run(
        [sys.executable, str(CHECK), "--repo-root", str(tmp_path), "--baseline", str(baseline)],
        capture_output=True,
        text=True,
        timeout=15,
    )
    assert proc.returncode == 0, proc.stdout + proc.stderr
