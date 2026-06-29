from types import SimpleNamespace

from app.infrastructure.parsing.docling_parser import picture_figure_block


def _bbox() -> dict[str, float]:
    return {"x": 10.0, "y": 20.0, "width": 100.0, "height": 80.0}


def test_picture_label_emits_text_less_figure_block():
    item = SimpleNamespace(label=SimpleNamespace(value="picture"))
    block = picture_figure_block(item, bbox=_bbox(), page_number=3, block_index=5)
    assert block is not None
    assert block.block_type == "figure"
    assert block.text == ""
    assert block.page_number == 3
    assert block.block_index == 5
    assert block.bbox == _bbox()
    # figure regions carry no native cell-grid
    assert block.row_index is None and block.col_index is None


def test_image_label_emits_figure_block():
    item = SimpleNamespace(label=SimpleNamespace(value="image"))
    block = picture_figure_block(item, bbox=_bbox(), page_number=1, block_index=0)
    assert block is not None
    assert block.block_type == "figure"
    assert block.text == ""


def test_text_label_is_not_a_figure():
    item = SimpleNamespace(label=SimpleNamespace(value="text"))
    assert picture_figure_block(item, bbox=_bbox(), page_number=1, block_index=0) is None


def test_missing_label_is_not_a_figure():
    item = SimpleNamespace()  # no .label at all
    assert picture_figure_block(item, bbox=_bbox(), page_number=1, block_index=0) is None
