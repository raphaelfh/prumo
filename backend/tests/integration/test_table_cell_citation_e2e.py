import fitz

from app.infrastructure.parsing.base import (
    concat_page_text,
    render_blocks_to_markdown,
)
from app.infrastructure.parsing.pymupdf_parser import PymupdfParser
from app.services.evidence_anchor_service import build_anchor


def _table_pdf() -> bytes:
    doc = fitz.open()
    page = doc.new_page(width=300, height=200)
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


def test_table_value_anchors_to_its_cell_block():
    blocks = PymupdfParser().parse(_table_pdf())
    # the parsed blocks already have offsets (parse calls assign_char_offsets);
    # re-assert the page-text invariant holds for the "11.8" cell.
    page_text = concat_page_text(blocks)[1]
    cell = next(b for b in blocks if b.text == "11.8")
    assert page_text[cell.char_start : cell.char_end] == "11.8"

    pos = build_anchor("11.8", blocks)
    assert pos is not None
    # anchored to the cell's own block_index, on a non-prose anchor kind
    assert cell.block_index in pos.anchor.block_ids
    assert pos.anchor.kind in ("hybrid", "region", "text")

    # the rendered GFM table places the value (grid-correct projection)
    md = render_blocks_to_markdown(blocks)
    assert "11.8" in md and "|" in md
