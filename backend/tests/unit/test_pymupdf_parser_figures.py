import fitz

from app.infrastructure.parsing.pymupdf_parser import PymupdfParser


def _pdf_with_image() -> bytes:
    doc = fitz.open()
    page = doc.new_page(width=300, height=300)
    page.insert_text((40, 40), "A figure follows below.")
    # a small embedded raster image -> a type==1 block
    pix = fitz.Pixmap(fitz.csRGB, fitz.IRect(0, 0, 40, 30))
    pix.clear_with(128)
    page.insert_image(fitz.Rect(60, 120, 220, 240), pixmap=pix)
    out = doc.tobytes()
    doc.close()
    return out


def test_parse_emits_figure_region_block():
    blocks = PymupdfParser().parse(_pdf_with_image())
    figures = [b for b in blocks if b.block_type == "figure"]
    assert figures, "expected at least one figure region block"
    fig = figures[0]
    assert fig.text == ""
    assert fig.bbox["width"] > 0 and fig.bbox["height"] > 0
    # still produced the page's text
    assert any("figure follows" in (b.text or "") for b in blocks)
    # figure has no cell-grid
    assert fig.row_index is None and fig.col_index is None
