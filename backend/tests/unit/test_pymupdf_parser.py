import fitz  # PyMuPDF
import pytest

from app.infrastructure.parsing.base import BLOCK_TYPES, render_blocks_to_markdown
from app.infrastructure.parsing.pymupdf_parser import PymupdfParser, _Entry, _reading_order


def _one_page_pdf(text: str) -> bytes:
    doc = fitz.open()
    page = doc.new_page()
    page.insert_text((72, 72), text, fontsize=11)
    return doc.tobytes()


def _paged_pdf(pages: list[dict[str, str]]) -> bytes:
    """One A4 page per dict: optional ``top`` (top band), ``body``, ``bottom`` (bottom band)."""
    doc = fitz.open()
    for spec in pages:
        page = doc.new_page()  # A4: 595 x 842 pt; 8% band = ~67 pt
        height = page.rect.height
        if "top" in spec:
            page.insert_text((72, 40), spec["top"], fontsize=9)
        page.insert_text((72, 300), spec["body"], fontsize=11)
        if "bottom" in spec:
            page.insert_text((290, height - 25), spec["bottom"], fontsize=9)
    return doc.tobytes()


def _types_by_text(blocks) -> dict[str, str]:
    return {b.text: b.block_type for b in blocks}


def test_parse_returns_blocks_with_bbox_and_offsets_ready():
    pdf = _one_page_pdf("Methods\nWe enrolled 100 patients.")
    blocks = PymupdfParser().parse(pdf)
    assert blocks, "expected at least one block"
    b = blocks[0]
    assert b.page_number == 1
    assert b.block_index == 0
    assert b.block_type in BLOCK_TYPES
    assert set(b.bbox) == {"x", "y", "width", "height"}
    assert b.char_end > b.char_start
    assert "patients" in " ".join(x.text for x in blocks)


def test_parse_raises_on_empty_document():
    doc = fitz.open()
    doc.new_page()  # blank page, no text
    with pytest.raises(ValueError):
        PymupdfParser().parse(doc.tobytes())


def test_running_heads_typed_as_chrome():
    pages = [
        {
            "top": f"J Clin Epi 2024; 12:{n}",
            "body": f"Body paragraph number {n} about patients.",
            "bottom": f"{n}",
        }
        for n in range(1, 5)
    ]
    blocks = PymupdfParser().parse(_paged_pdf(pages))
    types = _types_by_text(blocks)
    for n in range(1, 5):
        assert types[f"J Clin Epi 2024; 12:{n}"] == "header"
        assert types[f"{n}"] == "footer"
        assert types[f"Body paragraph number {n} about patients."] in {"paragraph", "heading"}
    md = render_blocks_to_markdown(blocks)
    assert "J Clin Epi" not in md
    assert "Body paragraph number 3 about patients." in md


def test_body_text_repeated_once_is_not_chrome():
    sentence = "A body sentence that happens to sit high on the first page."
    pages = [{"top": sentence, "body": "First page body."}] + [
        {"body": f"Page {n} body text."} for n in range(2, 5)
    ]
    blocks = PymupdfParser().parse(_paged_pdf(pages))
    assert _types_by_text(blocks)[sentence] == "paragraph"


def test_page_n_of_m_footer():
    blocks = PymupdfParser().parse(
        _paged_pdf([{"body": "Some body text here.", "bottom": "Page 2 of 3"}])
    )
    types = _types_by_text(blocks)
    assert types["Page 2 of 3"] == "footer"
    assert types["Some body text here."] == "paragraph"


def test_short_document_half_pages_rule():
    pages = [
        {"top": "Smith et al. Running Title", "body": "First page body."},
        {"top": "Smith et al. Running Title", "body": "Second page body."},
    ]
    blocks = PymupdfParser().parse(_paged_pdf(pages))
    heads = [b for b in blocks if b.text == "Smith et al. Running Title"]
    assert len(heads) == 2
    assert {b.block_type for b in heads} == {"header"}


def test_bare_decimal_in_bottom_band_stays_content():
    blocks = PymupdfParser().parse(
        _paged_pdf([{"body": "Mean follow-up in years.", "bottom": "12.5"}])
    )
    assert _types_by_text(blocks)["12.5"] == "paragraph"


@pytest.mark.parametrize("text", ["2019", "2019 cohort"], ids=["bare-year", "year-phrase"])
def test_year_in_top_band_of_one_page_doc_stays_content(text):
    blocks = PymupdfParser().parse(_paged_pdf([{"top": text, "body": "Body text of the page."}]))
    assert _types_by_text(blocks)[text] == "paragraph"


@pytest.mark.parametrize("prefix", ["Table", "Figure", "Fig."], ids=["table", "figure", "fig"])
def test_numbered_captions_repeated_in_top_band_stay_content(prefix):
    pages = [{"top": f"{prefix} {n}", "body": f"Body text of page {n}."} for n in range(1, 4)]
    blocks = PymupdfParser().parse(_paged_pdf(pages))
    types = _types_by_text(blocks)
    for n in range(1, 4):
        assert types[f"{prefix} {n}"] == "paragraph"


def _entry(x0: float, y0: float, x1: float, y1: float, label: str) -> _Entry:
    return _Entry(x0, y0, x1, y1, "text", label)


_PAGE_W = 595.0


def test_single_column_order_unchanged():
    # Single-column page: 5 blocks at known y positions, inserted out of order.
    doc = fitz.open()
    page = doc.new_page()
    ys = [400, 120, 640, 260, 520]
    for y in ys:
        page.insert_text((72, y), f"Line at y {y} of the single column body.", fontsize=11)
    blocks = PymupdfParser().parse(doc.tobytes())
    assert [b.text for b in blocks] == [
        f"Line at y {y} of the single column body." for y in sorted(ys)
    ]

    entries = [
        _entry(72, 300, 300, 320, "c"),
        _entry(72, 100, 520, 120, "a"),
        _entry(90, 200, 400, 220, "b2"),
        _entry(72, 200, 400, 220, "b1"),
        _entry(72, 500, 520, 520, "d"),
    ]
    ordered = _reading_order(entries, _PAGE_W)
    assert [e.payload for e in ordered] == ["a", "b1", "b2", "c", "d"]
    assert ordered == sorted(entries, key=lambda e: (e.y0, e.x0))


def test_two_column_band_reads_left_column_first():
    entries = [
        _entry(305, 110, 545, 180, "right-110"),
        _entry(50, 200, 290, 270, "left-200"),
        _entry(50, 40, 545, 70, "title"),
        _entry(305, 210, 545, 280, "right-210"),
        _entry(50, 100, 290, 170, "left-100"),
    ]
    ordered = _reading_order(entries, _PAGE_W)
    assert [e.payload for e in ordered] == [
        "title",
        "left-100",
        "left-200",
        "right-110",
        "right-210",
    ]


def test_full_width_entry_splits_bands():
    entries = [
        _entry(305, 410, 545, 470, "b2-right"),
        _entry(50, 300, 545, 330, "caption"),
        _entry(50, 100, 290, 170, "b1-left-1"),
        _entry(305, 105, 545, 170, "b1-right-1"),
        _entry(50, 200, 290, 270, "b1-left-2"),
        _entry(305, 205, 545, 270, "b1-right-2"),
        _entry(50, 400, 290, 470, "b2-left"),
    ]
    ordered = _reading_order(entries, _PAGE_W)
    assert [e.payload for e in ordered] == [
        "b1-left-1",
        "b1-left-2",
        "b1-right-1",
        "b1-right-2",
        "caption",
        "b2-left",
        "b2-right",
    ]


def test_narrow_gap_is_not_a_column_boundary():
    # Gap of 5 pt (< 2% of 595 = 11.9 pt): one column, (y0, x0) order.
    entries = [
        _entry(50, 110, 290, 130, "a"),
        _entry(295, 100, 545, 120, "b"),
    ]
    assert [e.payload for e in _reading_order(entries, _PAGE_W)] == ["b", "a"]
