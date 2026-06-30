from app.infrastructure.parsing.base import ParsedBlock, render_blocks_to_markdown


def _cell(idx, r, c, text):
    return ParsedBlock(
        page_number=1,
        block_index=idx,
        text=text,
        char_start=0,
        char_end=0,
        bbox={"x": 0.0, "y": 0.0, "width": 1.0, "height": 1.0},
        block_type="table_cell",
        row_index=r,
        col_index=c,
        row_span=1,
        col_span=1,
        is_header=(r == 0),
    )


def test_render_table_uses_native_grid():
    # 2 cols x 2 rows; emitted out of column order to prove grid placement wins.
    blocks = [
        _cell(0, 0, 1, "Value"),
        _cell(1, 0, 0, "Metric"),
        _cell(2, 1, 0, "EPV"),
        _cell(3, 1, 1, "11.8"),
    ]
    md = render_blocks_to_markdown(blocks)
    lines = [ln for ln in md.splitlines() if ln.strip()]
    assert lines[0] == "| Metric | Value |"
    assert set(lines[1].replace(" ", "")) <= set("|-")  # separator row
    assert lines[2] == "| EPV | 11.8 |"


def test_render_table_legacy_blocks_use_heuristic():
    # Legacy table_cell blocks (no row/col) still render via the old heuristic.
    legacy = [
        ParsedBlock(
            page_number=1,
            block_index=i,
            text=t,
            char_start=0,
            char_end=0,
            bbox={"x": 0.0, "y": 0.0, "width": 1.0, "height": 1.0},
            block_type="table_cell",
        )
        for i, t in enumerate(["A", "B", "C", "D"])
    ]
    md = render_blocks_to_markdown(legacy)
    assert "|" in md and "A" in md and "D" in md  # produced a GFM table, no crash
