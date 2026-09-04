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


def _write(path: Path, lines: list[str]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(lines) + "\n")


def test_check_reference_doc_sql_fence_reports_warn(tmp_path: Path) -> None:
    """A query against a dropped table inside a ```sql fence under docs/reference/ is reported.

    Warn tier, so the gate stays green — but the finding is on stdout and in
    the JSONL, which is what the quality loop reads. Before this scan, `.md`
    was outside SCAN_EXTS and the CHARMS doc queried `extracted_values` for
    months with every gate green.
    """
    lines = [
        "# Stale reference",
        "",
        "```sql",
        "SELECT f.name, ev.value",
        "FROM extracted_values ev",
        "JOIN extraction_fields f ON f.id = ev.field_id;",
        "```",
    ]
    doc = tmp_path / "docs" / "reference" / "templates" / "stale.md"
    _write(doc, lines)
    proc = _run(tmp_path)
    assert proc.returncode == 0, (
        f"a docs finding must be warn tier, not a gate failure (rc={proc.returncode})\n"
        f"---STDOUT---\n{proc.stdout}\n---STDERR---\n{proc.stderr}\n"
    )
    hit_line = lines.index("FROM extracted_values ev") + 1
    expected = f"WARN docs/reference/templates/stale.md:{hit_line}  [extracted_values_table]"
    assert expected in proc.stdout, f"missing {expected!r}\n---STDOUT---\n{proc.stdout}\n"
    # A fence info string beyond the language (```sql title=...) is still a SQL fence.
    _write(
        tmp_path / "docs" / "reference" / "attrs.md",
        ["# Attrs", "", "```sql title=example", "DELETE FROM ai_suggestions;", "```"],
    )
    proc = _run(tmp_path)
    assert proc.returncode == 0, proc.stdout + proc.stderr
    assert "WARN docs/reference/attrs.md:4  [ai_suggestions_table]" in proc.stdout, proc.stdout


def test_check_reference_doc_scan_is_fence_and_scope_bound(tmp_path: Path) -> None:
    """Only fenced ```sql blocks count, and only under docs/reference/.

    Prose in a reference doc legitimately names the dropped tables (the
    legacy-tables section of the architecture reference does), archived and
    in-flight specs are point-in-time snapshots, and README files outside
    docs/ are not the documentation surface.
    """
    fence = ["```sql", "SELECT id FROM extracted_values;", "```"]
    _write(
        tmp_path / "docs" / "reference" / "prose.md",
        ["# Prose", "", "Run `SELECT * FROM extracted_values` on an old dump.", ""],
    )
    _write(
        tmp_path / "docs" / "reference" / "other-fence.md",
        ["# Other fence", "", "```python", "q = 'SELECT id FROM extracted_values'", "```"],
    )
    _write(tmp_path / "docs" / "superpowers" / "specs" / "snapshot.md", ["# Spec", "", *fence])
    _write(tmp_path / "backend" / "README.md", ["# Backend", "", *fence])
    proc = _run(tmp_path)
    assert proc.returncode == 0, proc.stdout + proc.stderr
    assert "WARN" not in proc.stdout, f"unexpected finding\n---STDOUT---\n{proc.stdout}\n"
