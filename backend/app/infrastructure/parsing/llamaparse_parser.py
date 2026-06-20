"""LlamaParse (LlamaCloud) DocumentParser adapter (high-quality cloud path).

Cloud egress -> non-PHI projects only (gated by create_document_parser). Pins
the agentic tier so granular word/line/cell bounding boxes are available, maps
the items tree to ParsedBlock, and Y-FLIPS each bbox from LlamaParse's top-left
origin to PDF user-space bottom-left. Reuses the call shape proven in
scripts/parsing_bakeoff/parsers.py (one mapper, not two).
"""

from __future__ import annotations

import tempfile

from app.infrastructure.parsing.base import (
    DocumentParser,
    ParsedBlock,
    normalize_block_type,
)

# LlamaParse item type -> our closed block_type
_TYPE_MAP = {
    "text": "paragraph",
    "heading": "heading",
    "title": "heading",
    "list": "list_item",
    "list_item": "list_item",
    "table": "table_cell",
    "table_cell": "table_cell",
    "figure_caption": "figure_caption",
    "caption": "figure_caption",
}

# Sentinel for a box-less item: bbox is NOT NULL in the DB, so never emit None.
_SENTINEL_BBOX = {"x": 0.0, "y": 0.0, "width": 0.0, "height": 0.0}


class LlamaParseParser(DocumentParser):
    """High-quality cloud parser. Implements the DocumentParser port."""

    def __init__(self, api_key: str, tier: str = "agentic") -> None:
        self._api_key = api_key
        self._tier = tier

    def parse(self, pdf_bytes: bytes) -> list[ParsedBlock]:
        from llama_cloud import LlamaCloud  # lazy: cloud SDK, not a unit dep

        client = LlamaCloud(api_key=self._api_key)
        with tempfile.NamedTemporaryFile(suffix=".pdf") as tmp:
            tmp.write(pdf_bytes)
            tmp.flush()
            uploaded = client.files.create(file=tmp.name, purpose="parse")
            result = client.parsing.parse(
                file_id=uploaded.id,
                tier=self._tier,
                version="latest",
                output_options={"granular_bboxes": ["word", "line", "cell"]},
                expand=["markdown", "items"],
            )

        return self._map_result(result)

    @staticmethod
    def _map_result(result) -> list[ParsedBlock]:
        # page_number -> page height (for the Y-flip).
        page_heights: dict[int, float] = {}
        for page in getattr(result, "pages", None) or []:
            page_heights[int(page.page)] = float(getattr(page, "height", 0.0) or 0.0)

        blocks: list[ParsedBlock] = []
        per_page_index: dict[int, int] = {}

        for item in getattr(result, "items", None) or []:
            text = (getattr(item, "value", "") or "").strip()
            if not text:
                continue
            page_no = int(getattr(item, "page", 1))
            block_type = normalize_block_type(_TYPE_MAP.get(getattr(item, "type", ""), "paragraph"))

            raw_box = getattr(item, "bbox", None)
            if raw_box:
                x = float(raw_box["x"])
                y_top = float(raw_box["y"])
                w = float(raw_box["w"])
                h = float(raw_box["h"])
                page_h = page_heights.get(page_no, 0.0)
                # Y-flip: top-left origin -> bottom-left origin.
                y_bottom = page_h - y_top - h if page_h else y_top
                bbox = {"x": x, "y": y_bottom, "width": w, "height": h}
            else:
                bbox = dict(_SENTINEL_BBOX)

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
            raise ValueError("LlamaParse produced no text blocks")
        return blocks
