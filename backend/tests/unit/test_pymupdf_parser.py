import fitz  # PyMuPDF
import pytest

from app.infrastructure.parsing.base import BLOCK_TYPES
from app.infrastructure.parsing.pymupdf_parser import PymupdfParser


def _one_page_pdf(text: str) -> bytes:
    doc = fitz.open()
    page = doc.new_page()
    page.insert_text((72, 72), text, fontsize=11)
    return doc.tobytes()


def test_parse_returns_blocks_with_bbox_and_offsets_ready():
    pdf = _one_page_pdf("Methods\nWe enrolled 100 patients.")
    blocks = PymupdfParser().parse(pdf)
    assert blocks, "expected at least one block"
    b = blocks[0]
    assert b.page_number == 1
    assert b.block_index == 0
    assert b.block_type in BLOCK_TYPES
    assert set(b.bbox) == {"x", "y", "width", "height"}
    assert "patients" in " ".join(x.text for x in blocks)


def test_parse_raises_on_empty_document():
    doc = fitz.open()
    doc.new_page()  # blank page, no text
    with pytest.raises(ValueError):
        PymupdfParser().parse(doc.tobytes())
