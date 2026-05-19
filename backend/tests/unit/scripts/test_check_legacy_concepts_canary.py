"""Canary test for scripts/fitness/check_legacy_concepts.py.

Plants a deliberate violation (the canonical `name == 'prediction_models'`
equality check) in a temporary mini-repo and asserts the fitness function
returns exit 1. Without this test, the check could silently break and the
gate would lie green forever — that is the precise failure mode this canary
exists to prevent.

A SECOND canary verifies that a violation inside the allowlist (e.g. seed.py)
does NOT trip the check — proving the allowlist is honored.
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[4]
CHECK = REPO_ROOT / "scripts" / "fitness" / "check_legacy_concepts.py"


def _run(repo_root: Path) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, str(CHECK), "--repo-root", str(repo_root)],
        capture_output=True,
        text=True,
        timeout=30,
    )


def test_check_fires_on_planted_violation(tmp_path: Path) -> None:
    """A `name == 'prediction_models'` line outside the allowlist must fail."""
    bad = tmp_path / "backend" / "app" / "services" / "synthetic_service.py"
    bad.parent.mkdir(parents=True, exist_ok=True)
    bad.write_text(
        "def classify(entity):\n"
        "    if entity.name == 'prediction_models':\n"
        "        return 'predictions'\n"
        "    return 'other'\n"
    )
    proc = _run(tmp_path)
    assert proc.returncode == 1, (
        f"canary FAILED to detect planted violation (rc={proc.returncode})\n"
        f"---STDOUT---\n{proc.stdout}\n"
        f"---STDERR---\n{proc.stderr}\n"
    )
    assert "prediction_models_eq_py" in proc.stdout
    assert "synthetic_service.py" in proc.stdout


def test_check_respects_allowlist(tmp_path: Path) -> None:
    """An identical pattern inside an allowlisted path (seed.py) must NOT fail."""
    ok = tmp_path / "backend" / "app" / "seed.py"
    ok.parent.mkdir(parents=True, exist_ok=True)
    ok.write_text(
        "# legitimate use: seed file references the legacy string as data value\n"
        "DEFAULT_ROLES = [\n"
        "    {'name': 'prediction_models', 'role': 'model_container'},\n"
        "]\n"
        "if entity.name == 'prediction_models':\n"
        "    pass\n"
    )
    proc = _run(tmp_path)
    assert proc.returncode == 0, (
        f"allowlist NOT honored — seed.py false-positive (rc={proc.returncode})\n"
        f"---STDOUT---\n{proc.stdout}\n"
    )


def test_check_ts_variant_fires(tmp_path: Path) -> None:
    """Triple-equals form in a .ts file outside allowlist must fail."""
    bad = tmp_path / "frontend" / "components" / "Bad.ts"
    bad.parent.mkdir(parents=True, exist_ok=True)
    bad.write_text(
        "export function partition(name: string) {\n"
        "  if (name === 'prediction_models') return 'models';\n"
        "  return 'other';\n"
        "}\n"
    )
    proc = _run(tmp_path)
    assert proc.returncode == 1, proc.stdout + proc.stderr
    assert "prediction_models_eq_ts" in proc.stdout


def test_check_extracted_values_sql_fires(tmp_path: Path) -> None:
    """SQL FROM extracted_values must fail (the dropped table)."""
    bad = tmp_path / "backend" / "app" / "services" / "broken.py"
    bad.parent.mkdir(parents=True, exist_ok=True)
    bad.write_text('QUERY = """\n    SELECT id FROM extracted_values WHERE run_id = :rid\n"""\n')
    proc = _run(tmp_path)
    assert proc.returncode == 1, proc.stdout + proc.stderr
    assert "extracted_values_table" in proc.stdout


def test_check_ignores_camelcase_ai_suggestion(tmp_path: Path) -> None:
    """aiSuggestionService (live frontend service) must NOT fail."""
    ok = tmp_path / "frontend" / "services" / "aiSuggestionService.ts"
    ok.parent.mkdir(parents=True, exist_ok=True)
    ok.write_text(
        "export const aiSuggestionService = {\n  fetchAiSuggestions: async () => []\n};\n"
    )
    proc = _run(tmp_path)
    assert proc.returncode == 0, (
        f"camelCase aiSuggestion identifier was incorrectly flagged\n---STDOUT---\n{proc.stdout}\n"
    )
