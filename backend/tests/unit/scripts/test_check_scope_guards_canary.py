"""Canary for scripts/fitness/check_scope_guards.py.

Plants synthetic ownership predicates and asserts the check exits 1. Without
this the detector could silently stop matching and the gate would lie green —
the worst failure mode for a check that guards a security invariant.

The negative cases matter as much as the positive ones here: an earlier
revision of the detector keyed on the FULL column set, which made 54% of its
findings unrelated list queries and let one extra clause hide a real copy.
Both of those regressions are pinned below.
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[4]
CHECK = REPO_ROOT / "scripts" / "fitness" / "check_scope_guards.py"
APP = "backend/app"

_GUARD = """from sqlalchemy import select
from app.models.extraction import ProjectExtractionTemplate


async def {name}(db, template_id, project_id):
    return (await db.execute(
        select(ProjectExtractionTemplate).where(
            ProjectExtractionTemplate.id == template_id,
            ProjectExtractionTemplate.project_id == project_id,{extra}
        )
    )).scalar_one_or_none()
"""


def _plant(tmp_root: Path, rel: str, body: str) -> None:
    f = tmp_root / APP / rel
    f.parent.mkdir(parents=True, exist_ok=True)
    f.write_text(body)


def _run(tmp_root: Path, baseline: str = "/dev/null") -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [
            sys.executable,
            str(CHECK),
            "--repo-root",
            str(tmp_root),
            "--baseline",
            baseline,
        ],
        capture_output=True,
        text=True,
        timeout=30,
    )


def test_fires_on_a_second_copy_of_an_ownership_predicate(tmp_path: Path) -> None:
    """Two functions filtering {id, project_id} on the same model."""
    _plant(tmp_path, "services/a_service.py", _GUARD.format(name="owned_a", extra=""))
    _plant(tmp_path, "services/b_service.py", _GUARD.format(name="owned_b", extra=""))

    proc = _run(tmp_path)

    assert proc.returncode == 1, proc.stdout + proc.stderr
    assert "ProjectExtractionTemplate{id,project_id}" in proc.stdout
    assert "owned_a" in proc.stdout and "owned_b" in proc.stdout


def test_an_extra_clause_cannot_hide_the_copy(tmp_path: Path) -> None:
    """The signature keys on SCOPE columns only.

    Keying on the full column set let a copy escape by carrying one unrelated
    term — exactly what ``claim_draft_lock``'s ``config_draft_by`` clause did.
    """
    _plant(tmp_path, "services/a_service.py", _GUARD.format(name="owned_a", extra=""))
    _plant(
        tmp_path,
        "services/b_service.py",
        _GUARD.format(name="owned_b", extra="\n            ProjectExtractionTemplate.name == 'x',"),
    )

    proc = _run(tmp_path)

    assert proc.returncode == 1, proc.stdout + proc.stderr
    assert "owned_b" in proc.stdout


def test_quiet_on_a_single_implementation(tmp_path: Path) -> None:
    """One guard is the goal, not a violation."""
    _plant(tmp_path, "services/a_service.py", _GUARD.format(name="owned_a", extra=""))

    assert _run(tmp_path).returncode == 0


def test_quiet_on_list_queries_that_merely_share_columns(tmp_path: Path) -> None:
    """No ``id`` term means it selects a SET, not a row: not an ownership guard.

    This is the false-positive class that made an earlier baseline 54% noise.
    """
    body = """from sqlalchemy import select
from app.models.extraction import ExtractionInstance


async def {name}(db, article_id, template_id):
    return (await db.execute(
        select(ExtractionInstance).where(
            ExtractionInstance.article_id == article_id,
            ExtractionInstance.template_id == template_id,
        )
    )).scalars().all()
"""
    _plant(tmp_path, "services/a_service.py", body.format(name="list_a"))
    _plant(tmp_path, "services/b_service.py", body.format(name="list_b"))

    proc = _run(tmp_path)

    assert proc.returncode == 0, proc.stdout + proc.stderr


def test_fires_on_hand_rolled_membership_sql(tmp_path: Path) -> None:
    """Membership must go through the helpers the RLS policies call."""
    _plant(
        tmp_path,
        "services/rogue_service.py",
        "from sqlalchemy import text\n\n"
        'STMT = text("SELECT 1 FROM public.project_members WHERE project_id = :p")\n',
    )

    proc = _run(tmp_path)

    assert proc.returncode == 1, proc.stdout + proc.stderr
    assert "membership-sql" in proc.stdout


def test_a_comment_mentioning_the_table_is_not_sql(tmp_path: Path) -> None:
    """Comments are not in the AST — including the ones explaining this rule."""
    _plant(
        tmp_path,
        "services/documented_service.py",
        "# A hand-rolled SELECT FROM public.project_members here would be drift.\nVALUE = 1\n",
    )

    assert _run(tmp_path).returncode == 0


def test_baseline_grandfathers_a_known_pair(tmp_path: Path) -> None:
    _plant(tmp_path, "services/a_service.py", _GUARD.format(name="owned_a", extra=""))
    _plant(tmp_path, "services/b_service.py", _GUARD.format(name="owned_b", extra=""))
    baseline = tmp_path / "bl"
    sig = "duplicate-predicate::ProjectExtractionTemplate{id,project_id}"
    baseline.write_text(
        f"{sig}::{APP}/services/a_service.py::owned_a  # legacy, being consolidated\n"
        f"{sig}::{APP}/services/b_service.py::owned_b\n"
    )

    proc = _run(tmp_path, baseline=str(baseline))

    assert proc.returncode == 0, proc.stdout + proc.stderr
