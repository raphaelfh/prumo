"""Canary for scripts/fitness/check_glossary_sync.py.

Builds a synthetic mini-repo where the skill mirror defines a term that is
*not* in the canonical doc — asserts the check fires (exit 1). Without this,
a broken extract_terms() regex would lie green forever.
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[4]
CHECK = REPO_ROOT / "scripts" / "fitness" / "check_glossary_sync.py"

MIRROR_REL = ".claude/skills/architectural-quality-loop/references/concept-glossary.md"
CANONICAL_REL = "docs/architecture/extraction-hitl-architecture.md"


def _write(tmp_root: Path, mirror_terms: list[str], canonical_terms: list[str]) -> None:
    mirror_path = tmp_root / MIRROR_REL
    canonical_path = tmp_root / CANONICAL_REL
    mirror_path.parent.mkdir(parents=True, exist_ok=True)
    canonical_path.parent.mkdir(parents=True, exist_ok=True)

    mirror_path.write_text(
        "# Glossary\n\n## Modeling primitives\n\n"
        + "\n".join(f"- **{t}** — definition." for t in mirror_terms)
        + "\n"
    )
    canonical_path.write_text(
        "# Architecture\n\n## 6. Glossary\n\n"
        + "\n".join(f"- **{t}** — definition." for t in canonical_terms)
        + "\n"
    )


def _run(tmp_root: Path) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, str(CHECK), "--repo-root", str(tmp_root)],
        capture_output=True,
        text=True,
        timeout=15,
    )


def test_fires_when_mirror_term_missing_from_canonical(tmp_path: Path) -> None:
    """Mirror has 'Phantom' which the canonical doc does not — must fail."""
    _write(tmp_path, mirror_terms=["Template", "Phantom"], canonical_terms=["Template"])
    proc = _run(tmp_path)
    assert proc.returncode == 1, (
        f"canary failed to detect glossary drift (rc={proc.returncode})\n"
        f"---STDOUT---\n{proc.stdout}\n"
    )
    assert "Phantom" in proc.stdout


def test_clean_when_terms_match(tmp_path: Path) -> None:
    _write(tmp_path, mirror_terms=["Template", "Run"], canonical_terms=["Template", "Run"])
    proc = _run(tmp_path)
    assert proc.returncode == 0, proc.stdout + proc.stderr


def test_clean_when_canonical_is_superset(tmp_path: Path) -> None:
    """Canonical doc may define more terms than the mirror (mirror is a subset)."""
    _write(
        tmp_path,
        mirror_terms=["Template"],
        canonical_terms=["Template", "ExtraTerm"],
    )
    proc = _run(tmp_path)
    assert proc.returncode == 0, proc.stdout
