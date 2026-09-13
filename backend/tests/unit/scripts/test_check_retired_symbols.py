"""check_retired_symbols.py: a retired settings component must not come back.

The symbol names are built by concatenation: this file sits under backend/tests,
which the gate scans, and a literal name in code here would fail it.
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[4]
CHECK = REPO_ROOT / "scripts" / "fitness" / "check_retired_symbols.py"
CARD = "Settings" + "Card"
FIELD = "Settings" + "Field"
SLICE = "borderless density pass PR 1"


def _run(root: Path | None = None) -> subprocess.CompletedProcess[str]:
    args = [sys.executable, str(CHECK)]
    if root is not None:
        args += ["--repo-root", str(root)]
    return subprocess.run(args, capture_output=True, text=True, timeout=60)


def _plant(root: Path, rel: str, body: str) -> None:
    f = root / rel
    f.parent.mkdir(parents=True, exist_ok=True)
    f.write_text(body)


def test_flags_a_retired_settings_card_import(tmp_path: Path) -> None:
    _plant(
        tmp_path,
        "frontend/components/user/X.tsx",
        f"import {{{CARD}}} from '@/components/settings';\n",
    )
    proc = _run(tmp_path)
    assert proc.returncode == 1, proc.stdout
    assert f"frontend/components/user/X.tsx:1  {CARD}" in proc.stdout
    assert f"retired in {SLICE}" in proc.stdout
    assert "entry-group trees train" not in proc.stdout


def test_flags_settings_field_usage(tmp_path: Path) -> None:
    _plant(tmp_path, "frontend/components/project/settings/X.tsx", f"<{FIELD} label='x'/>\n")
    proc = _run(tmp_path)
    assert proc.returncode == 1, proc.stdout
    assert FIELD in proc.stdout


def test_prose_mentions_and_longer_names_pass(tmp_path: Path) -> None:
    _plant(
        tmp_path,
        "frontend/components/user/X.tsx",
        f"// {CARD} used to wrap this group\nexport type {CARD}Props = never;\n",
    )
    assert _run(tmp_path).returncode == 0


def test_the_real_tree_is_clean() -> None:
    proc = _run()
    assert proc.returncode == 0, proc.stdout
    assert "none present" in proc.stdout
