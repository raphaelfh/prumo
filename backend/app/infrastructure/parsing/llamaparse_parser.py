"""LlamaParse (LlamaCloud) DocumentParser adapter (high-quality cloud path).

Cloud parser; selected per project via create_document_parser. Pins the
agentic tier so granular word/line/cell bounding boxes are available, maps
the items tree to ParsedBlock, and Y-FLIPS each bbox from LlamaParse's top-left
origin to PDF user-space bottom-left. Reuses the call shape proven in
scripts/parsing_bakeoff/parsers.py (one mapper, not two).
"""

from __future__ import annotations

import tempfile
from typing import Any

from app.infrastructure.parsing.base import (
    DocumentParser,
    ParsedBlock,
    normalize_block_type,
)

# LlamaParse item ``type`` discriminator -> our closed block_type. The llama_cloud
# 2.x items tree is a discriminated union (text/heading/list/code/table/image/
# link/header/footer); anything unmapped normalises to "paragraph".
_TYPE_MAP = {
    "text": "paragraph",
    "heading": "heading",
    "title": "heading",
    "list": "list_item",
    "list_item": "list_item",
    "code": "paragraph",
    "table": "table_cell",
    "table_cell": "table_cell",
    "image": "figure_caption",
    "figure_caption": "figure_caption",
    "caption": "figure_caption",
    "link": "paragraph",
    "header": "header",
    "footer": "footer",
}

# Sentinel for a box-less item: bbox is NOT NULL in the DB, so never emit None.
_SENTINEL_BBOX = {"x": 0.0, "y": 0.0, "width": 0.0, "height": 0.0}


def _item_text(item: Any) -> str:
    """Best-effort visible text for any item variant.

    text/heading/code expose ``value``; link exposes ``text``; image exposes
    ``caption``; list/table/header/footer expose only rendered ``md``. Try the
    richest field first, then fall back to the markdown projection.
    """
    for attr in ("value", "text", "caption"):
        candidate = getattr(item, attr, None)
        if isinstance(candidate, str) and candidate.strip():
            return candidate.strip()
    md = getattr(item, "md", None)
    return md.strip() if isinstance(md, str) else ""


def _union_bbox(raw_boxes: Any, page_height: float) -> dict[str, float]:
    """Collapse a list of granular ``BBox`` into one PDF-space bbox.

    LlamaParse returns ``bbox`` as a LIST of word/line/cell boxes in a
    top-left origin; we take their union and Y-flip it to the PDF bottom-left
    origin (points). Returns the sentinel when there are no boxes (the DB
    column is NOT NULL).
    """
    boxes = [b for b in (raw_boxes or []) if b is not None]
    if not boxes:
        return dict(_SENTINEL_BBOX)
    x0 = y0_top = float("inf")
    x1 = y1_top = float("-inf")
    for b in boxes:
        x, y, w, h = float(b.x), float(b.y), float(b.w), float(b.h)
        x0 = min(x0, x)
        y0_top = min(y0_top, y)
        x1 = max(x1, x + w)
        y1_top = max(y1_top, y + h)
    width = x1 - x0
    height = y1_top - y0_top
    y_bottom = page_height - y0_top - height if page_height else y0_top
    return {"x": x0, "y": y_bottom, "width": width, "height": height}


def _blocks_from_markdown(result: Any) -> list[ParsedBlock]:
    """Fallback: one paragraph block per rendered markdown page.

    Used when the structured items tree is empty but the document still
    produced page markdown, so the reader is never left blank. No bboxes are
    available on this path (sentinel).
    """
    markdown = getattr(result, "markdown", None)
    blocks: list[ParsedBlock] = []
    for page in getattr(markdown, "pages", None) or []:
        if not getattr(page, "success", False):
            continue
        text = (getattr(page, "markdown", "") or "").strip()
        if not text:
            continue
        page_no = int(getattr(page, "page_number", None) or len(blocks) + 1)
        blocks.append(
            ParsedBlock(
                page_number=page_no,
                block_index=0,
                text=text,
                char_start=0,
                char_end=0,
                bbox=dict(_SENTINEL_BBOX),
                block_type="paragraph",
            )
        )
    return blocks


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
    def _map_result(result: Any) -> list[ParsedBlock]:
        # llama_cloud 2.x shape: result.items.pages[] -> {items, page_height,
        # page_number, success}; each item is a discriminated-union block with
        # .type, a text field, and bbox as a LIST of granular boxes. (The old
        # flat ``result.items`` / ``result.pages`` assumption produced zero
        # blocks — see tests/unit/test_llamaparse_parser.py.)
        items = getattr(result, "items", None)
        blocks: list[ParsedBlock] = []

        for page in getattr(items, "pages", None) or []:
            if not getattr(page, "success", False):
                continue  # ItemsPageFailedStructuredPage carries no items
            page_height = float(getattr(page, "page_height", 0.0) or 0.0)
            page_no = int(getattr(page, "page_number", 1) or 1)
            idx = 0
            for item in getattr(page, "items", None) or []:
                text = _item_text(item)
                if not text:
                    continue
                block_type = normalize_block_type(
                    _TYPE_MAP.get(getattr(item, "type", "") or "", "paragraph")
                )
                bbox = _union_bbox(getattr(item, "bbox", None), page_height)
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
                idx += 1

        if not blocks:
            # Structured items empty but the doc may still have page markdown.
            blocks = _blocks_from_markdown(result)

        if not blocks:
            raise ValueError("LlamaParse produced no text blocks")
        return blocks
