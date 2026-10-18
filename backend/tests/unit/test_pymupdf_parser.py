import fitz  # PyMuPDF
import pytest

from app.infrastructure.parsing.base import BLOCK_TYPES, render_blocks_to_markdown
from app.infrastructure.parsing.pymupdf_parser import PymupdfParser


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
