"""Golden parse of the deterministic two-column fixture.

Runs the exact ingest sequence (``PymupdfParser().parse`` → ``normalize_blocks``
→ ``assign_char_offsets_to_blocks``) and pins reading order, chrome typing and
normalization. Regenerate deliberately with
``UPDATE_GOLDEN=1 uv run pytest tests/unit/test_pymupdf_parser_golden.py``;
the regenerating run fails so a regen never passes silently.
"""

from __future__ import annotations

import json
import os
from pathlib import Path

import pytest

from app.infrastructure.parsing.base import (
    assign_char_offsets_to_blocks,
    normalize_blocks,
)
from app.infrastructure.parsing.pymupdf_parser import PymupdfParser
from tests.fixtures.parsing.two_column import build_two_column_pdf

_GOLDEN = Path(__file__).resolve().parents[1] / "fixtures" / "parsing" / "two_column.golden.json"


def _parse() -> list[dict]:
    blocks = assign_char_offsets_to_blocks(
        normalize_blocks(PymupdfParser().parse(build_two_column_pdf()))
    )
    return [
        {
            "page": b.page_number,
            "block_index": b.block_index,
            "block_type": b.block_type,
            "text": b.text,
        }
        for b in blocks
    ]


def test_fixture_is_deterministic():
    assert build_two_column_pdf() == build_two_column_pdf()


def test_fixture_carries_zero_width_chars_before_normalization():
    raw = PymupdfParser().parse(build_two_column_pdf())
    assert any("​" in b.text for b in raw)


def test_two_column_golden():
    actual = _parse()
    if os.environ.get("UPDATE_GOLDEN"):
        _GOLDEN.write_text(json.dumps(actual, indent=2, ensure_ascii=False) + "\n")
        pytest.fail("golden updated, review the diff")

    assert actual == json.loads(_GOLDEN.read_text())

    assert not any("​" in b["text"] for b in actual)
    assert "doi:10.1000/test" in [b["text"] for b in actual]
    assert [b["text"] for b in actual].count("Age 54") == 1

    heads = [b for b in actual if b["text"] in {"Short Title et al.", "J Test Med 2026"}]
    assert len(heads) == 4
    assert {b["block_type"] for b in heads} == {"header"}
    page_numbers = [b for b in actual if b["text"] == str(b["page"])]
    assert len(page_numbers) == 4
    assert {b["block_type"] for b in page_numbers} == {"footer"}

    page1 = [b["text"] for b in actual if b["page"] == 1]
    lefts = [i for i, t in enumerate(page1) if t.startswith("LEFT-1-")]
    rights = [i for i, t in enumerate(page1) if t.startswith("RIGHT-1-")]
    assert len(lefts) == 3 and len(rights) == 3
    assert max(lefts) < min(rights)
    abstract = next(i for i, t in enumerate(page1) if t.startswith("ABSTRACT"))
    assert abstract < min(lefts)
