"""The vulture baseline header justifies entries with mechanisms that exist.

The header's admission rule names the shapes a baseline entry may take. A
shape whose mechanism was deleted (a file it points to, a count that no
longer matches its bullets) licenses entries nothing justifies any more.
"""

from __future__ import annotations

import importlib.util
import re
from pathlib import Path

_REPO = Path(__file__).resolve().parents[4]
_SCRIPT = _REPO / "scripts" / "vulture_baseline.py"
_BASELINE = _REPO / "backend" / ".vulture_baseline"
_NUMBERS = {"one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6}


def _header(tmp_path: Path) -> str:
    spec = importlib.util.spec_from_file_location("vulture_baseline", _SCRIPT)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    out = tmp_path / "baseline"
    module.write_baseline(out, set())
    return out.read_text()


def test_shape_count_matches_the_bullets(tmp_path: Path) -> None:
    header = _header(tmp_path)
    count = re.search(r"one of (\w+) shapes", header)
    assert count is not None
    bullets = re.findall(r"^#   \* ", header, flags=re.MULTILINE)
    assert _NUMBERS[count.group(1)] == len(bullets)


def test_every_referenced_module_exists(tmp_path: Path) -> None:
    header = _header(tmp_path)
    modules = re.findall(r"\b(\w+\.py)\b", header)
    app = _REPO / "backend" / "app"
    missing = [m for m in modules if m != "vulture_baseline.py" and not any(app.rglob(m))]
    assert missing == []


def test_committed_baseline_carries_the_current_header(tmp_path: Path) -> None:
    assert _BASELINE.read_text().startswith(_header(tmp_path))
