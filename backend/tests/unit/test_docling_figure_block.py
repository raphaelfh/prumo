import sys
import types
from types import SimpleNamespace

from app.infrastructure.parsing import docling_parser
from app.infrastructure.parsing.docling_parser import DoclingParser, picture_figure_block


def _bbox() -> dict[str, float]:
    return {"x": 10.0, "y": 20.0, "width": 100.0, "height": 80.0}


# --- picture_figure_block() helper (duck-typed, no docling) ----------------


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


# --- DoclingParser.parse() figure emission (docling import mocked) ----------
#
# Drives parse() end-to-end without the heavy docling dependency by injecting a
# minimal fake import surface + a fake converter. This covers the figure branch
# inside parse() (the helper tests above only cover the helper in isolation).


class _FakeTableItem:
    """Stand-in TableItem class; the fake items below are never instances."""


def _install_fake_docling(monkeypatch, items):
    base_models = types.ModuleType("docling.datamodel.base_models")
    base_models.InputFormat = SimpleNamespace(PDF="pdf")

    class _FakeConverter:
        def __init__(self, **_kwargs):
            pass

        def convert(self, _path):
            document = SimpleNamespace(iterate_items=lambda: [(it, 0) for it in items])
            return SimpleNamespace(document=document)

    converter_mod = types.ModuleType("docling.document_converter")
    converter_mod.DocumentConverter = _FakeConverter
    converter_mod.PdfFormatOption = lambda **_kwargs: None

    core_doc = types.ModuleType("docling_core.types.doc")
    core_doc.TableItem = _FakeTableItem

    monkeypatch.setitem(sys.modules, "docling.datamodel.base_models", base_models)
    monkeypatch.setitem(sys.modules, "docling.document_converter", converter_mod)
    monkeypatch.setitem(sys.modules, "docling_core.types.doc", core_doc)
    # Skip the heavy accelerator/pipeline-options import chain.
    monkeypatch.setattr(docling_parser, "_pdf_pipeline_options", lambda: None)


def _item(label: str, *, page_no: int, bbox: tuple[float, float, float, float], text: str = ""):
    left, top, right, bottom = bbox
    bb = SimpleNamespace(l=left, t=top, r=right, b=bottom)
    return SimpleNamespace(
        prov=[SimpleNamespace(page_no=page_no, bbox=bb)],
        label=SimpleNamespace(value=label),
        text=text,
    )


def test_parse_emits_figure_region_for_picture_item(monkeypatch):
    picture = _item("picture", page_no=1, bbox=(10.0, 200.0, 110.0, 120.0))
    _install_fake_docling(monkeypatch, [picture])

    blocks = DoclingParser().parse(b"%PDF-fake")

    assert len(blocks) == 1
    fig = blocks[0]
    assert fig.block_type == "figure"
    assert fig.text == ""
    assert fig.page_number == 1
    assert fig.block_index == 0
    # bbox normalised to lower-left origin + positive extent
    assert fig.bbox == {"x": 10.0, "y": 120.0, "width": 100.0, "height": 80.0}


def test_parse_interleaves_figure_after_text_with_monotonic_index(monkeypatch):
    text = _item("text", page_no=1, bbox=(0.0, 300.0, 50.0, 290.0), text="Intro paragraph.")
    picture = _item("picture", page_no=1, bbox=(10.0, 200.0, 110.0, 120.0))
    _install_fake_docling(monkeypatch, [text, picture])

    blocks = DoclingParser().parse(b"%PDF-fake")

    assert [b.block_type for b in blocks] == ["paragraph", "figure"]
    assert [b.block_index for b in blocks] == [0, 1]
