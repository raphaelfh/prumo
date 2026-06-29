"""Docling DocumentParser adapter (standard self-hosted path).

Wraps docling's DocumentConverter. Heavy deps (torch + model weights) are
lazy-imported inside parse() so app boot and non-parsing tests stay light.
Maps docling DocItem labels onto the closed block_type set, reads bbox from
each item's prov, and emits ParsedBlock with char offsets as 0 placeholders
(DocumentParsingService assigns real offsets).

OCR is disabled: our inputs are born-digital scientific PDFs with an embedded
text layer, so OCR adds nothing. docling's default ``do_ocr=True`` loads
RapidOCR, whose torch backend crashes on the PP-OCRv6 default it adopted in
3.9 ("Unsupported configuration: torch.PP-OCRv6.det.small") when onnxruntime
is absent. Disabling OCR skips the RapidOCR import entirely. Table structure
stays on (FAST + cell matching: cell text comes verbatim from the PDF text
layer) since scientific tables are load-bearing for extraction.
"""

from __future__ import annotations

import tempfile
from typing import TYPE_CHECKING, TypedDict

from app.infrastructure.parsing.base import (
    DocumentParser,
    ParsedBlock,
    normalize_block_type,
)

if TYPE_CHECKING:
    from docling.datamodel.pipeline_options import PdfPipelineOptions

# docling label.value -> our closed block_type
_LABEL_MAP = {
    "section_header": "heading",
    "title": "heading",
    "list_item": "list_item",
    "caption": "figure_caption",
    "page_header": "header",
    "page_footer": "footer",
    "text": "paragraph",
    "paragraph": "paragraph",
}


def _pdf_pipeline_options() -> PdfPipelineOptions:
    """Build the PDF pipeline options for the self-hosted parser.

    OCR off (born-digital text layer; avoids the RapidOCR/PP-OCRv6/torch crash),
    table structure on in FAST mode with cell matching, accelerator pinned to
    CPU (the worker has no GPU). Lazy-imports docling to keep app boot light.
    """
    from docling.datamodel.accelerator_options import (
        AcceleratorDevice,
        AcceleratorOptions,
    )
    from docling.datamodel.pipeline_options import (
        PdfPipelineOptions,
        TableFormerMode,
        TableStructureOptions,
    )

    options = PdfPipelineOptions()
    options.do_ocr = False
    options.do_table_structure = True
    options.table_structure_options = TableStructureOptions(
        mode=TableFormerMode.FAST,
        do_cell_matching=True,
    )
    options.accelerator_options = AcceleratorOptions(device=AcceleratorDevice.CPU)
    return options


class _DoclingCellFields(TypedDict):
    """Native cell-grid fields lifted from a docling TableCell."""

    row_index: int | None
    col_index: int | None
    row_span: int | None
    col_span: int | None
    is_header: bool | None


def docling_cell_fields(cell: object) -> _DoclingCellFields:
    """Map a docling TableCell to native cell-grid fields.

    docling exposes start/end row+col offset indices (half-open) plus
    column_header / row_header booleans. Spans derive from the offset deltas.
    Missing attributes degrade to None (older docling versions / odd cells).
    """
    sr = getattr(cell, "start_row_offset_idx", None)
    er = getattr(cell, "end_row_offset_idx", None)
    sc = getattr(cell, "start_col_offset_idx", None)
    ec = getattr(cell, "end_col_offset_idx", None)
    row_span = (er - sr) if (sr is not None and er is not None) else None
    col_span = (ec - sc) if (sc is not None and ec is not None) else None
    is_header = None
    if hasattr(cell, "column_header") or hasattr(cell, "row_header"):
        is_header = bool(
            getattr(cell, "column_header", False) or getattr(cell, "row_header", False)
        )
    return {
        "row_index": sr,
        "col_index": sc,
        "row_span": row_span,
        "col_span": col_span,
        "is_header": is_header,
    }


class DoclingParser(DocumentParser):
    """Self-hosted layout parser. Implements the DocumentParser port."""

    def parse(self, pdf_bytes: bytes) -> list[ParsedBlock]:
        from docling.datamodel.base_models import InputFormat
        from docling.document_converter import (
            DocumentConverter,
            PdfFormatOption,
        )
        from docling_core.types.doc import TableItem

        converter = DocumentConverter(
            format_options={
                InputFormat.PDF: PdfFormatOption(pipeline_options=_pdf_pipeline_options())
            }
        )

        # docling reads from a path; write the bytes to a temp file.
        with tempfile.NamedTemporaryFile(suffix=".pdf") as tmp:
            tmp.write(pdf_bytes)
            tmp.flush()
            doc = converter.convert(tmp.name).document

        blocks: list[ParsedBlock] = []
        per_page_index: dict[int, int] = {}

        for item, _level in doc.iterate_items():
            provs = getattr(item, "prov", None) or []
            if not provs:
                continue
            prov = provs[0]
            page_no = int(getattr(prov, "page_no", 1))  # docling is 1-indexed
            bb = prov.bbox

            # bbox -> PDF user space, origin bottom-left, positive extent.
            # docling bbox coords can be top-left; use min/abs to normalise the
            # extent and keep the origin at the lower-left of the rect.
            x = min(bb.l, bb.r)
            y = min(bb.t, bb.b)
            width = abs(bb.r - bb.l)
            height = abs(bb.t - bb.b)
            bbox = {"x": float(x), "y": float(y), "width": float(width), "height": float(height)}

            if isinstance(item, TableItem):
                # Emit one table_cell block per non-empty cell. Every cell of a
                # table reuses the table-level ``bbox`` built above, so each cell
                # MUST get its own copy (``dict(bbox)``) — sharing one mutable
                # dict across cells is a latent aliasing hazard. Do not collapse.
                for cell in item.data.table_cells:
                    text = getattr(cell, "text", "").strip()
                    if not text:
                        continue
                    idx = per_page_index.get(page_no, 0)
                    per_page_index[page_no] = idx + 1
                    grid = docling_cell_fields(cell)
                    blocks.append(
                        ParsedBlock(
                            page_number=page_no,
                            block_index=idx,
                            text=text,
                            char_start=0,
                            char_end=0,
                            bbox=dict(bbox),
                            block_type="table_cell",
                            row_index=grid["row_index"],
                            col_index=grid["col_index"],
                            row_span=grid["row_span"],
                            col_span=grid["col_span"],
                            is_header=grid["is_header"],
                        )
                    )
                continue

            text = getattr(item, "text", "").strip()
            if not text:
                continue
            label = getattr(getattr(item, "label", None), "value", "")
            block_type = normalize_block_type(_LABEL_MAP.get(label, "paragraph"))
            idx = per_page_index.get(page_no, 0)
            per_page_index[page_no] = idx + 1
            blocks.append(
                ParsedBlock(
                    page_number=page_no,
                    block_index=idx,
                    text=text,
                    char_start=0,
                    char_end=0,
                    bbox=bbox,
                    block_type=block_type,
                )
            )

        if not blocks:
            raise ValueError("docling produced no text blocks")
        return blocks
