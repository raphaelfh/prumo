"""Self-hosted simple parser using base PyMuPDF (fitz).

The free default parser (ADR-0011/0013). Extracts per-block text + real bbox via
`page.get_text("dict")`, classifying each block as `heading` (relative font size)
or `paragraph`. Markdown is NOT produced here — the canonical projection is
`render_blocks_to_markdown(blocks)` (one codepath, shared with the reader). Table
reconstruction is out of scope for the simple tier (cells render as paragraph
text); the high-fidelity tiers (LlamaParse / Docling) own structured tables.

No DB / IO / HTTP — pure given the bytes.
"""

from __future__ import annotations

import fitz  # PyMuPDF

from app.infrastructure.parsing.base import (
    ParsedBlock,
    assign_char_offsets_to_blocks,
    normalize_block_type,
)

#: A block whose max span size is >= median * this ratio is treated as a heading.
_HEADING_SIZE_RATIO = 1.25
#: Headings are short; longer lines that happen to be large are still body text.
_HEADING_MAX_CHARS = 120


def _block_text(block: dict) -> str:
    lines = []
    for line in block.get("lines", []):
        spans = [s.get("text", "") for s in line.get("spans", [])]
        joined = "".join(spans).strip()
        if joined:
            lines.append(joined)
    return "\n".join(lines).strip()


def _block_max_size(block: dict) -> float:
    sizes = [s.get("size", 0.0) for line in block.get("lines", []) for s in line.get("spans", [])]
    return max(sizes) if sizes else 0.0


class PymupdfParser:
    """DocumentParser implementation backed by PyMuPDF (fitz)."""

    def parse(self, pdf_bytes: bytes) -> list[ParsedBlock]:
        doc = fitz.open(stream=pdf_bytes, filetype="pdf")
        try:
            raw: list[tuple[int, dict]] = []
            for page_index in range(doc.page_count):
                page = doc.load_page(page_index)
                page_dict = page.get_text("dict")
                for block in page_dict.get("blocks", []):
                    if block.get("type", 0) != 0:  # 0 = text block
                        continue
                    text = _block_text(block)
                    if text:
                        raw.append((page_index + 1, block))
            if not raw:
                raise ValueError("PymupdfParser produced no text blocks")

            sizes = [_block_max_size(b) for _, b in raw if _block_max_size(b) > 0]
            median = sorted(sizes)[len(sizes) // 2] if sizes else 0.0

            blocks: list[ParsedBlock] = []
            per_page_idx: dict[int, int] = {}
            for page_number, block in raw:
                text = _block_text(block)
                x0, y0, x1, y1 = block["bbox"]
                size = _block_max_size(block)
                is_heading = (
                    median > 0
                    and size >= median * _HEADING_SIZE_RATIO
                    and len(text) <= _HEADING_MAX_CHARS
                )
                idx = per_page_idx.get(page_number, 0)
                per_page_idx[page_number] = idx + 1
                blocks.append(
                    ParsedBlock(
                        page_number=page_number,
                        block_index=idx,
                        text=text,
                        char_start=0,
                        char_end=0,
                        bbox={
                            "x": float(x0),
                            "y": float(y0),
                            "width": float(x1 - x0),
                            "height": float(y1 - y0),
                        },
                        block_type=normalize_block_type("heading" if is_heading else "paragraph"),
                    )
                )
            return assign_char_offsets_to_blocks(blocks)
        finally:
            doc.close()
