"""Canary for scripts/fitness/check_frontend_data_path.py."""

from __future__ import annotations

import re
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[4]
CHECK = REPO_ROOT / "scripts" / "fitness" / "check_frontend_data_path.py"

# The per-line regex the gate used before it scanned whole files.
LINE_REGEX = re.compile(r"\bsupabase\s*\.\s*from\s*\(")

MULTI_LINE_READ = "const { data } = await supabase\n  .from('projects')\n  .select('*');\n"


def _write(root: Path, rel: str, text: str) -> None:
    path = root / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text)


def _run(root: Path, baseline: str = "", *args: str) -> subprocess.CompletedProcess[str]:
    baseline_path = root / "data_path.baseline"
    if not baseline_path.exists():
        baseline_path.write_text(baseline)
    return subprocess.run(
        [
            sys.executable,
            str(CHECK),
            "--repo-root",
            str(root),
            "--baseline",
            str(baseline_path),
            *args,
        ],
        capture_output=True,
        text=True,
        timeout=15,
    )


def test_fires_on_supabase_from_in_component(tmp_path: Path) -> None:
    _write(
        tmp_path,
        "frontend/components/x/Bad.tsx",
        "const r = await supabase.from('projects').select('*');\n",
    )
    proc = _run(tmp_path)
    assert proc.returncode == 1, proc.stdout + proc.stderr
    assert "frontend/components/x/Bad.tsx|projects" in proc.stdout


def test_fires_on_a_chain_split_across_lines(tmp_path: Path) -> None:
    assert not any(LINE_REGEX.search(line) for line in MULTI_LINE_READ.splitlines())
    _write(tmp_path, "frontend/services/projectsService.ts", MULTI_LINE_READ)
    proc = _run(tmp_path)
    assert proc.returncode == 1, proc.stdout + proc.stderr
    assert "frontend/services/projectsService.ts:2" in proc.stdout


def test_fires_through_a_comment_between_the_tokens(tmp_path: Path) -> None:
    _write(
        tmp_path,
        "frontend/services/x.ts",
        "await supabase // why\n  /* note */ .from('projects');\n",
    )
    proc = _run(tmp_path)
    assert proc.returncode == 1, proc.stdout + proc.stderr


def test_a_mention_in_a_comment_is_not_a_read(tmp_path: Path) -> None:
    _write(
        tmp_path,
        "frontend/services/x.ts",
        "// supabase.from('projects')\n/** supabase\n * .from('projects') */\nconst url = 'https://x//y';\n",
    )
    proc = _run(tmp_path)
    assert proc.returncode == 0, proc.stdout + proc.stderr


def test_storage_from_across_lines_is_not_a_read(tmp_path: Path) -> None:
    _write(tmp_path, "frontend/services/x.ts", "await supabase\n  .storage\n  .from('articles');\n")
    proc = _run(tmp_path)
    assert proc.returncode == 0, proc.stdout + proc.stderr


def test_fires_on_vite_api_url(tmp_path: Path) -> None:
    _write(tmp_path, "frontend/hooks/useX.ts", "const base = import.meta.env.VITE_API_URL;\n")
    proc = _run(tmp_path)
    assert proc.returncode == 1, proc.stdout + proc.stderr
    assert "frontend/hooks/useX.ts|VITE_API_URL" in proc.stdout


def test_integration_layer_is_allowed(tmp_path: Path) -> None:
    _write(
        tmp_path,
        "frontend/integrations/supabase/client.ts",
        "export const q = () => supabase.from('x').select();\n",
    )
    proc = _run(tmp_path)
    assert proc.returncode == 0, proc.stdout + proc.stderr


def test_test_files_are_not_browser_code(tmp_path: Path) -> None:
    for rel in (
        "frontend/services/x.test.ts",
        "frontend/components/y.spec.tsx",
        "frontend/test/helpers/mocks.tsx",
        "frontend/e2e/flows/z.e2e.ts",
    ):
        _write(tmp_path, rel, MULTI_LINE_READ)
    proc = _run(tmp_path)
    assert proc.returncode == 0, proc.stdout + proc.stderr


def test_a_variable_table_name_is_its_own_key(tmp_path: Path) -> None:
    _write(tmp_path, "frontend/lib/repo.ts", "const r = supabase.from(table as any);\n")
    proc = _run(tmp_path)
    assert proc.returncode == 1, proc.stdout + proc.stderr
    assert "frontend/lib/repo.ts|<dynamic>" in proc.stdout


def test_baseline_grandfathers_reads_by_file_and_table(tmp_path: Path) -> None:
    _write(tmp_path, "frontend/services/legacyService.ts", MULTI_LINE_READ + MULTI_LINE_READ)
    proc = _run(tmp_path, "frontend/services/legacyService.ts|projects:2\n")
    assert proc.returncode == 0, proc.stdout + proc.stderr


def test_a_new_table_in_a_baselined_file_fails(tmp_path: Path) -> None:
    _write(
        tmp_path,
        "frontend/services/legacyService.ts",
        MULTI_LINE_READ + "supabase.from('profiles');\n",
    )
    proc = _run(tmp_path, "frontend/services/legacyService.ts|projects:1\n")
    assert proc.returncode == 1, proc.stdout + proc.stderr
    assert "frontend/services/legacyService.ts|profiles" in proc.stdout


def test_a_grown_count_fails(tmp_path: Path) -> None:
    _write(tmp_path, "frontend/services/legacyService.ts", MULTI_LINE_READ + MULTI_LINE_READ)
    proc = _run(tmp_path, "frontend/services/legacyService.ts|projects:1\n")
    assert proc.returncode == 1, proc.stdout + proc.stderr


def test_a_read_moved_to_another_file_fails(tmp_path: Path) -> None:
    _write(tmp_path, "frontend/services/newHome.ts", MULTI_LINE_READ)
    proc = _run(tmp_path, "frontend/services/oldHome.ts|projects:1\n")
    assert proc.returncode == 1, proc.stdout + proc.stderr
    assert "frontend/services/newHome.ts|projects" in proc.stdout


def test_a_shrunk_count_passes_and_asks_to_tighten(tmp_path: Path) -> None:
    _write(tmp_path, "frontend/services/legacyService.ts", MULTI_LINE_READ)
    proc = _run(tmp_path, "frontend/services/legacyService.ts|projects:3\n")
    assert proc.returncode == 0, proc.stdout + proc.stderr
    assert "--update-baseline" in proc.stdout


def test_update_baseline_lowers_counts_and_drops_fixed_keys(tmp_path: Path) -> None:
    _write(tmp_path, "frontend/services/legacyService.ts", MULTI_LINE_READ)
    proc = _run(
        tmp_path,
        "frontend/services/legacyService.ts|projects:3\nfrontend/services/gone.ts|articles:1\n",
        "--update-baseline",
    )
    assert proc.returncode == 0, proc.stdout + proc.stderr
    entries = [
        line
        for line in (tmp_path / "data_path.baseline").read_text().splitlines()
        if line and not line.startswith("#")
    ]
    assert entries == ["frontend/services/legacyService.ts|projects:1"]


def test_update_baseline_refuses_to_raise_a_count(tmp_path: Path) -> None:
    _write(tmp_path, "frontend/services/legacyService.ts", MULTI_LINE_READ + MULTI_LINE_READ)
    before = "frontend/services/legacyService.ts|projects:1\n"
    proc = _run(tmp_path, before, "--update-baseline")
    assert proc.returncode == 1, proc.stdout + proc.stderr
    assert (tmp_path / "data_path.baseline").read_text() == before
