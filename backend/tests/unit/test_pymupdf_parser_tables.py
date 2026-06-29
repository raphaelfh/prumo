import fitz  # PyMuPDF

from app.infrastructure.parsing.pymupdf_parser import (
    PymupdfParser,
    build_table_cell_blocks,
)


def test_build_table_cell_blocks_assigns_grid_and_headers():
    bbox = {"x": 0.0, "y": 0.0, "width": 1.0, "height": 1.0}
    rows = [
        [("EPV", bbox), ("Value", bbox)],
        [("ratio", bbox), ("11.8", bbox)],
    ]
    blocks = build_table_cell_blocks(rows=rows, header_rows=1, page_number=2, start_index=5)

    assert [b.block_index for b in blocks] == [5, 6, 7, 8]
    assert all(b.block_type == "table_cell" and b.page_number == 2 for b in blocks)
    header = [b for b in blocks if b.is_header]
    body = [b for b in blocks if not b.is_header]
    assert {(b.text, b.col_index) for b in header} == {("EPV", 0), ("Value", 1)}
    assert {(b.text, b.row_index, b.col_index) for b in body} == {
        ("ratio", 1, 0),
        ("11.8", 1, 1),
    }
    assert all(b.row_span == 1 and b.col_span == 1 for b in blocks)


def test_build_table_cell_blocks_skips_empty_text_but_keeps_coords():
    bbox = {"x": 0.0, "y": 0.0, "width": 1.0, "height": 1.0}
    rows = [[("a", bbox), ("", bbox)], [("", bbox), ("d", bbox)]]
    blocks = build_table_cell_blocks(rows=rows, header_rows=0, page_number=1, start_index=0)
    assert {(b.text, b.row_index, b.col_index) for b in blocks} == {
        ("a", 0, 0),
        ("d", 1, 1),
    }


def _ruled_table_pdf() -> bytes:
    """A one-page PDF with a 2x2 ruled table find_tables can detect."""
    doc = fitz.open()
    page = doc.new_page(width=300, height=200)
    # outer + inner grid lines (lines strategy needs ruling)
    xs, ys = [40, 160, 280], [40, 90, 140]
    for x in xs:
        page.draw_line((x, ys[0]), (x, ys[-1]))
    for y in ys:
        page.draw_line((xs[0], y), (xs[-1], y))
    page.insert_text((50, 70), "EPV")
    page.insert_text((170, 70), "Value")
    page.insert_text((50, 120), "ratio")
    page.insert_text((170, 120), "11.8")
    out = doc.tobytes()
    doc.close()
    return out


def _plain_text_pdf() -> bytes:
    doc = fitz.open()
    page = doc.new_page(width=300, height=200)
    page.insert_text((50, 50), "Just a paragraph of body text, no table here.")
    out = doc.tobytes()
    doc.close()
    return out


def test_parse_emits_table_cells_with_grid():
    pdf = _ruled_table_pdf()
    # Prove the fixture is table-detectable first, so a find_tables miss fails
    # loudly here instead of as a confusing empty-set assertion below.
    probe = fitz.open(stream=pdf, filetype="pdf")
    assert list(probe[0].find_tables().tables), "fixture must contain a detectable table"
    probe.close()

    blocks = PymupdfParser().parse(pdf)
    cells = [b for b in blocks if b.block_type == "table_cell"]
    texts = {b.text for b in cells}
    assert {"EPV", "Value", "ratio", "11.8"} <= texts
    # the "11.8" cell carries a concrete (row, col)
    v = next(b for b in cells if b.text == "11.8")
    assert v.row_index is not None and v.col_index is not None
    # char offsets stay consistent with concat_page_text for the cell
    from app.infrastructure.parsing.base import concat_page_text

    page_text = concat_page_text(blocks)[v.page_number]
    assert page_text[v.char_start : v.char_end] == "11.8"
    # no duplicate paragraph block re-emits a table value
    paras = [b for b in blocks if b.block_type != "table_cell"]
    assert all("11.8" not in (p.text or "") for p in paras)


def test_parse_tolerates_find_tables_failure(monkeypatch):
    """A find_tables crash never aborts the parse (text blocks still returned)."""

    def _boom(self, *a, **k):
        raise RuntimeError("find_tables blew up")

    monkeypatch.setattr(fitz.Page, "find_tables", _boom, raising=True)
    blocks = PymupdfParser().parse(_plain_text_pdf())
    assert any(b.block_type in ("paragraph", "heading") for b in blocks)
    assert all(b.block_type != "table_cell" for b in blocks)


def test_parse_skips_table_when_conversion_fails(monkeypatch):
    """A table that fails row conversion is skipped; the parse still succeeds."""
    import app.infrastructure.parsing.pymupdf_parser as mod

    def _boom(table):
        raise ValueError("bad table")

    monkeypatch.setattr(mod, "_table_to_rows", _boom, raising=True)
    blocks = PymupdfParser().parse(_ruled_table_pdf())
    # conversion failed -> no cells, table text NOT dropped (degrades to prose)
    assert all(b.block_type != "table_cell" for b in blocks)
    assert blocks  # parse still produced blocks


def test_table_to_rows_uses_table_bbox_when_cell_rect_missing():
    """A None cell rect falls back to the table-level bbox (no crash)."""
    from app.infrastructure.parsing.pymupdf_parser import _table_to_rows

    class _Row:
        def __init__(self, cells):
            self.cells = cells

    class _Table:
        bbox = (40.0, 40.0, 280.0, 140.0)
        header = None
        rows = [_Row([(40, 40, 160, 90), None])]

        def extract(self):
            return [["A", "B"]]

    rows, _header_rows = _table_to_rows(_Table())
    assert len(rows) == 1 and len(rows[0]) == 2
    # second cell (None rect) uses the table bbox
    assert rows[0][1][1] == {"x": 40.0, "y": 40.0, "width": 240.0, "height": 100.0}
