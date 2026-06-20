"""Integration test for DoclingParser.

Skipped automatically when docling is not installed in the current environment
(e.g. dev machines without torch). The CI image installs docling so the test
runs there.
"""

from pathlib import Path

import pytest

from app.infrastructure.parsing.base import BLOCK_TYPES, assign_char_offsets_to_blocks
from app.infrastructure.parsing.docling_parser import DoclingParser

_FIXTURE = Path(__file__).parent.parent / "fixtures" / "parsing" / "sample_two_page.pdf"


def _is_docling_installed() -> bool:
    import importlib.util

    return importlib.util.find_spec("docling") is not None


pytestmark = pytest.mark.skipif(
    not _is_docling_installed(), reason="docling not installed in this environment"
)


def test_docling_parses_blocks_with_valid_invariants():
    blocks = DoclingParser().parse(_FIXTURE.read_bytes())

    assert blocks, "expected at least one block"
    # >= 1 block per page
    pages = {b.page_number for b in blocks}
    assert pages == {1, 2}

    for b in blocks:
        assert b.page_number >= 1  # 1-indexed
        assert b.block_type in BLOCK_TYPES  # closed-7 set
        assert set(b.bbox) == {"x", "y", "width", "height"}
        assert b.bbox["width"] >= 0 and b.bbox["height"] >= 0

    # monotonic block_index within each page
    for page in pages:
        idx = [b.block_index for b in blocks if b.page_number == page]
        assert idx == sorted(idx)
        assert idx[0] == 0

    # offset invariant (service computes these; assert the adapter is compatible)
    assign_char_offsets_to_blocks(blocks)
    from app.infrastructure.parsing.base import concat_page_text

    page_text = concat_page_text(blocks)
    for b in blocks:
        assert b.text == page_text[b.page_number][b.char_start : b.char_end]
