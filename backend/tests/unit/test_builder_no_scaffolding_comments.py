"""Guard: the extraction xlsx builder package carries no US/T042/SC scaffolding comments."""

from __future__ import annotations

from pathlib import Path

import app.services.exports.extraction as pkg

BANNED = ("US1", "US2", "US3", "T042", "SC-003")


def test_builder_package_has_no_scaffolding_comments() -> None:
    pkg_dir = Path(pkg.__file__).parent
    offenders: list[str] = []
    for py in sorted(pkg_dir.rglob("*.py")):
        text = py.read_text(encoding="utf-8")
        for needle in BANNED:
            if needle in text:
                offenders.append(f"{py.name}: {needle}")
    assert not offenders, f"scaffolding text present: {offenders}"
