"""page_text_blocks: keyset paging of article text by character budget
(task 7a; spec §5.1)."""

from __future__ import annotations

import pytest

from app.services.article_text_block_read_service import page_text_blocks
from app.utils.opaque_cursor import InvalidCursorError
from tests.integration.conftest import SEED
from tests.integration.mcp.article_seed import insert_article, insert_blocks, insert_pdf


def _prefix_len(c):  # "[p{page}·b{idx}] " or "[p{page}·b{idx} cont.] "
    return len(f"[p{c.page_number}·b{c.block_index}{' cont.' if c.char_offset else ''}] ")


async def _all_pages(db, fid, **kw):
    pages, cursor = [], None
    while True:
        page = await page_text_blocks(
            db,
            article_file_id=fid,
            cursor=cursor,
            page_from=kw.get("page_from"),
            page_to=kw.get("page_to"),
            budget=kw.get("budget", 28_000),
        )
        pages.append(page)
        if page.next_cursor is None:
            return pages
        cursor = page.next_cursor


async def _file_with(db, blocks):
    aid = await insert_article(db, SEED.primary_project, title="Paging")
    fid = await insert_pdf(db, SEED.primary_project, aid)
    await insert_blocks(db, fid, blocks)
    return fid


async def test_small_file_one_page(db_session):
    fid = await _file_with(
        db_session, [(1, 0, "a", "paragraph"), (1, 1, "b", "paragraph"), (2, 0, "c", "heading")]
    )
    [page] = await _all_pages(db_session, fid)
    assert [(c.page_number, c.block_index, c.char_offset, c.text) for c in page.chunks] == [
        (1, 0, 0, "a"),
        (1, 1, 0, "b"),
        (2, 0, 0, "c"),
    ]


async def test_budget_stops_before_block_that_does_not_fit(db_session):
    fid = await _file_with(db_session, [(1, i, "x" * 60, "paragraph") for i in range(4)])
    pages = await _all_pages(db_session, fid, budget=100)
    assert [len(p.chunks) for p in pages] == [1, 1, 1, 1]
    assert [p.chunks[0].block_index for p in pages] == [0, 1, 2, 3]


async def test_oversized_block_split_reaches_every_char(db_session):
    big = "".join(chr(0x4E00 + i % 500) for i in range(70_000))  # non-ASCII: code-point slicing
    fid = await _file_with(db_session, [(3, 7, big, "paragraph")])
    pages = await _all_pages(db_session, fid)
    chunks = [c for p in pages for c in p.chunks]
    assert (
        len(pages) == 3
        and chunks[0].char_offset == 0
        and all(c.char_offset > 0 for c in chunks[1:])
    )
    assert "".join(c.text for c in chunks) == big
    for p in pages:
        assert sum(_prefix_len(c) + len(c.text) + 1 for c in p.chunks) <= 28_000


async def test_page_range_filters(db_session):
    fid = await _file_with(db_session, [(n, 0, f"page {n}", "paragraph") for n in range(1, 6)])
    [page] = await _all_pages(db_session, fid, page_from=2, page_to=3)
    assert [c.page_number for c in page.chunks] == [2, 3]


async def test_bad_cursor_raises(db_session):
    fid = await _file_with(db_session, [(1, 0, "a", "paragraph")])
    with pytest.raises(InvalidCursorError):
        await page_text_blocks(
            db_session, article_file_id=fid, page_from=None, page_to=None, cursor="!!"
        )
