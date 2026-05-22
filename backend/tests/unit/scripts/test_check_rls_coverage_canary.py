"""Canary for scripts/fitness/check_rls_coverage.py.

Plants a synthetic migration with a `extraction_foo` table and no
matching CREATE POLICY — asserts the check exits 1. Also verifies the
positive case (table with policy in either Alembic or Supabase).
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[4]
CHECK = REPO_ROOT / "scripts" / "fitness" / "check_rls_coverage.py"

ALEMBIC_REL = "backend/alembic/versions"
SUPABASE_REL = "supabase/migrations"


def _run(tmp_root: Path, baseline: Path | None = None) -> subprocess.CompletedProcess[str]:
    args = [sys.executable, str(CHECK), "--repo-root", str(tmp_root)]
    if baseline:
        args.extend(["--baseline", str(baseline)])
    else:
        args.extend(["--baseline", "/dev/null"])
    return subprocess.run(args, capture_output=True, text=True, timeout=15)


def test_fires_on_table_without_policy(tmp_path: Path) -> None:
    """extraction_foo without CREATE POLICY must fail."""
    f = tmp_path / ALEMBIC_REL / "0099_test.sql"
    f.parent.mkdir(parents=True, exist_ok=True)
    f.write_text('CREATE TABLE IF NOT EXISTS "public"."extraction_foo" (id uuid);\n')
    proc = _run(tmp_path)
    assert proc.returncode == 1, proc.stdout + proc.stderr
    assert "extraction_foo" in proc.stdout


def test_clean_when_policy_in_same_file(tmp_path: Path) -> None:
    """Same file CREATE TABLE + CREATE POLICY → exit 0."""
    f = tmp_path / ALEMBIC_REL / "0099_test.sql"
    f.parent.mkdir(parents=True, exist_ok=True)
    f.write_text(
        'CREATE TABLE "public"."extraction_bar" (id uuid);\n'
        'CREATE POLICY allow_all ON "public"."extraction_bar" USING (true);\n'
    )
    proc = _run(tmp_path)
    assert proc.returncode == 0, proc.stdout + proc.stderr


def test_clean_when_policy_in_supabase_migration(tmp_path: Path) -> None:
    """Table in Alembic, policy in Supabase (cross-system) → exit 0."""
    a = tmp_path / ALEMBIC_REL / "0099_test.sql"
    a.parent.mkdir(parents=True, exist_ok=True)
    a.write_text("CREATE TABLE project_baz (id uuid);\n")
    s = tmp_path / SUPABASE_REL / "20260519_policies.sql"
    s.parent.mkdir(parents=True, exist_ok=True)
    s.write_text("CREATE POLICY allow_all ON project_baz USING (true);\n")
    proc = _run(tmp_path)
    assert proc.returncode == 0, proc.stdout + proc.stderr


def test_baseline_grandfathers_missing_policy(tmp_path: Path) -> None:
    f = tmp_path / ALEMBIC_REL / "0099_test.sql"
    f.parent.mkdir(parents=True, exist_ok=True)
    f.write_text("CREATE TABLE extraction_legacy (id uuid);\n")
    baseline = tmp_path / "bl"
    baseline.write_text("extraction_legacy\n")
    proc = _run(tmp_path, baseline=baseline)
    assert proc.returncode == 0, proc.stdout + proc.stderr


def test_archive_subdir_ignored(tmp_path: Path) -> None:
    """Files under archive/ should not contribute either tables or policies."""
    f = tmp_path / ALEMBIC_REL / "archive" / "old.sql"
    f.parent.mkdir(parents=True, exist_ok=True)
    f.write_text("CREATE TABLE extraction_archived (id uuid);\n")
    proc = _run(tmp_path)
    assert proc.returncode == 0, proc.stdout + proc.stderr
