from app.infrastructure.parsing.base import ParsedBlock


def test_parsed_block_defaults_cell_grid_to_none():
    b = ParsedBlock(
        page_number=1,
        block_index=0,
        text="x",
        char_start=0,
        char_end=1,
        bbox={"x": 0.0, "y": 0.0, "width": 1.0, "height": 1.0},
        block_type="paragraph",
    )
    assert b.row_index is None and b.col_index is None
    assert b.row_span is None and b.col_span is None and b.is_header is None


def test_parsed_block_accepts_cell_grid():
    b = ParsedBlock(
        page_number=1,
        block_index=3,
        text="11.8",
        char_start=0,
        char_end=4,
        bbox={"x": 0.0, "y": 0.0, "width": 1.0, "height": 1.0},
        block_type="table_cell",
        row_index=1,
        col_index=2,
        row_span=1,
        col_span=1,
        is_header=False,
    )
    assert (b.row_index, b.col_index, b.row_span, b.col_span, b.is_header) == (1, 2, 1, 1, False)
