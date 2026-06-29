from types import SimpleNamespace

from app.infrastructure.parsing.docling_parser import docling_cell_fields


def test_docling_cell_fields_maps_offsets_and_spans():
    cell = SimpleNamespace(
        start_row_offset_idx=2,
        end_row_offset_idx=4,
        start_col_offset_idx=1,
        end_col_offset_idx=2,
        column_header=False,
        row_header=False,
    )
    assert docling_cell_fields(cell) == {
        "row_index": 2,
        "col_index": 1,
        "row_span": 2,
        "col_span": 1,
        "is_header": False,
    }


def test_docling_cell_fields_marks_headers():
    cell = SimpleNamespace(
        start_row_offset_idx=0,
        end_row_offset_idx=1,
        start_col_offset_idx=0,
        end_col_offset_idx=1,
        column_header=True,
        row_header=False,
    )
    assert docling_cell_fields(cell)["is_header"] is True


def test_docling_cell_fields_tolerates_missing_attrs():
    cell = SimpleNamespace()  # nothing
    out = docling_cell_fields(cell)
    assert out == {
        "row_index": None,
        "col_index": None,
        "row_span": None,
        "col_span": None,
        "is_header": None,
    }
