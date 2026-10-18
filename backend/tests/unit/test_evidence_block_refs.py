"""Block refs the model cites (``p3·b12``, ``p3·b12–b18``) → a window of
source blocks, and normalized quote containment inside that window."""

from __future__ import annotations

import threading

import pytest

from app.domain.evidence_block_refs import (
    BlockRef,
    BlockRefIndex,
    normalize_text,
    normalize_with_index_map,
    parse_block_ref,
    quote_in_window,
    ref_window,
)
from app.infrastructure.parsing.base import ParsedBlock

_BBOX = {"x": 0.0, "y": 0.0, "width": 1.0, "height": 1.0}


def _block(page: int, idx: int, text: str) -> ParsedBlock:
    return ParsedBlock(
        page_number=page,
        block_index=idx,
        text=text,
        char_start=0,
        char_end=0,
        bbox=_BBOX,
        block_type="paragraph",
    )


_BLOCKS = [
    _block(1, 0, "Title block."),
    _block(1, 1, "Second block."),
    _block(1, 2, "Third block."),
    _block(1, 3, "Fourth block."),
    _block(2, 0, "Page two first."),
    _block(2, 1, "Page two second."),
]


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("p3·b12", BlockRef(page=3, first=12, last=12)),
        ("[p3·b12]", BlockRef(page=3, first=12, last=12)),
        (" [P3·B12] ", BlockRef(page=3, first=12, last=12)),
        ("p3.b12", BlockRef(page=3, first=12, last=12)),
        ("p3·b12–b18", BlockRef(page=3, first=12, last=18)),
        ("p3.b12-b18", BlockRef(page=3, first=12, last=18)),
        ("[p3·b12–b18]", BlockRef(page=3, first=12, last=18)),
        ("p3·b0", BlockRef(page=3, first=0, last=0)),
    ],
    ids=[
        "dot-sep",
        "brackets",
        "case-space",
        "ascii-dot",
        "range",
        "ascii-range",
        "br-range",
        "b0",
    ],
)
def test_parse_block_ref_accepts(raw: str, expected: BlockRef) -> None:
    assert parse_block_ref(raw) == expected


@pytest.mark.parametrize(
    "raw",
    [
        "p0·b1",
        "p3·b9–b2",
        "page 3",
        "",
        "p3",
        "b12",
        "p3·b12 cont.",
        "p-1·b2",
        "p\u0661·b0",
        "p1·b\u0661",
        "p1·b0–b\uff19",
    ],
    ids=[
        "page-zero",
        "reversed",
        "prose",
        "empty",
        "no-block",
        "no-page",
        "cont",
        "negative",
        "arabic-indic-page",
        "arabic-indic-block",
        "fullwidth-last",
    ],
)
def test_parse_block_ref_rejects(raw: str) -> None:
    assert parse_block_ref(raw) is None


def test_single_ref_window_is_neighbours_on_the_page() -> None:
    window = ref_window(BlockRefIndex(_BLOCKS), BlockRef(page=1, first=1, last=1))
    assert window is not None
    assert window.page == 1
    assert window.block_indexes == (0, 1, 2)
    assert window.text == "Title block.\nSecond block.\nThird block."


def test_single_ref_window_is_clipped_at_page_edges() -> None:
    index = BlockRefIndex(_BLOCKS)
    first = ref_window(index, BlockRef(page=1, first=0, last=0))
    last = ref_window(index, BlockRef(page=1, first=3, last=3))
    assert first is not None and first.block_indexes == (0, 1)
    # Page 2's block 0 never joins page 1's window.
    assert last is not None and last.block_indexes == (2, 3)


def test_range_ref_window_is_the_whole_run() -> None:
    window = ref_window(BlockRefIndex(_BLOCKS), BlockRef(page=1, first=1, last=3))
    assert window is not None
    assert window.block_indexes == (1, 2, 3)


def test_huge_range_ref_window_is_bounded_by_the_page_blocks() -> None:
    # A model-chosen range must not drive an O(range) loop: the window walks
    # the page's blocks, so a 20-digit ``last`` returns at once.
    ref = parse_block_ref("p1·b1–b99999999999999999999")
    assert ref is not None and ref.last == 99999999999999999999
    result: list[object] = []
    worker = threading.Thread(
        target=lambda: result.append(ref_window(BlockRefIndex(_BLOCKS), ref)),
        daemon=True,
    )
    worker.start()
    worker.join(timeout=5)
    assert not worker.is_alive(), "ref_window looped over the ref's integer range"
    window = result[0]
    assert window is not None
    assert window.block_indexes == (1, 2, 3)


def test_unknown_page_or_first_block_has_no_window() -> None:
    index = BlockRefIndex(_BLOCKS)
    assert ref_window(index, BlockRef(page=9, first=0, last=0)) is None
    assert ref_window(index, BlockRef(page=2, first=7, last=7)) is None
    assert ref_window(BlockRefIndex([]), BlockRef(page=1, first=0, last=0)) is None


def test_quote_in_window_tolerates_whitespace_and_nfkc() -> None:
    window = ref_window(
        BlockRefIndex([_block(1, 0, "The ﬁrst  “primary”\noutcome was mortality.")]),
        BlockRef(page=1, first=0, last=0),
    )
    assert window is not None
    assert quote_in_window('first "primary" outcome', window)
    assert quote_in_window("  outcome   was mortality ", window)
    assert not quote_in_window("secondary outcome", window)
    assert not quote_in_window("   ", window)


def test_moved_normalizers_keep_their_behavior() -> None:
    assert normalize_text("  a  ﬁ – b  ") == "a fi - b"
    norm, index_map = normalize_with_index_map(" a  b")
    assert norm == "a b"
    # A folded space maps to the original index of the character after the run.
    assert index_map == [1, 4, 4]
