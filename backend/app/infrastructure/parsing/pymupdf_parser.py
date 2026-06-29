"""Self-hosted simple parser using base PyMuPDF (fitz).

The free default parser (ADR-0011/0013). Extracts per-block text + real bbox via
`page.get_text("dict")`, classifying each block as `heading` (relative font size)
or `paragraph`. Table cells are emitted as `table_cell` blocks via
`page.find_tables()` carrying the native grid (row/col, is_header, per-cell bbox);
text blocks inside a detected table's bbox are dropped so cells own that text.
Markdown is NOT produced here — the canonical projection is
`render_blocks_to_markdown(blocks)` (one codepath, shared with the reader).

No DB / IO / HTTP — pure given the bytes.
"""

from __future__ import annotations

from typing import Any

import fitz  # PyMuPDF

from app.infrastructure.parsing.base import (
    DocumentParser,
    ParsedBlock,
    assign_char_offsets_to_blocks,
    normalize_block_type,
)

#: A block whose max span size is >= median * this ratio is treated as a heading.
_HEADING_SIZE_RATIO = 1.25
#: Headings are short; longer lines that happen to be large are still body text.
_HEADING_MAX_CHARS = 120


def _block_text(block: dict[str, Any]) -> str:
    lines = []
    for line in block.get("lines", []):
        spans = [s.get("text", "") for s in line.get("spans", [])]
        joined = "".join(spans).strip()
        if joined:
            lines.append(joined)
    return "\n".join(lines).strip()


def _block_max_size(block: dict[str, Any]) -> float:
    sizes = [s.get("size", 0.0) for line in block.get("lines", []) for s in line.get("spans", [])]
    return max(sizes) if sizes else 0.0


def _bbox_from_rect(rect: tuple[float, float, float, float]) -> dict[str, float]:
    x0, y0, x1, y1 = rect
    return {"x": float(x0), "y": float(y0), "width": float(x1 - x0), "height": float(y1 - y0)}


def build_table_cell_blocks(
    *,
    rows: list[list[tuple[str, dict[str, float]]]],
    header_rows: int,
    page_number: int,
    start_index: int,
) -> list[ParsedBlock]:
    """Build contiguous ``table_cell`` ParsedBlocks (row-major) from a grid.

    Each cell is ``(text, bbox)``. Empty-text cells are skipped but still
    consume their ``(row, col)`` slot so coordinates stay faithful. fitz emits
    a flat grid, so ``row_span`` / ``col_span`` are always 1 (real spans come
    from the Docling tier). ``is_header`` is True for the first *header_rows*
    rows. ``char_start`` / ``char_end`` are placeholders (0) — the caller runs
    ``assign_char_offsets_to_blocks`` once over the full page.
    """
    blocks: list[ParsedBlock] = []
    idx = start_index
    for r, row in enumerate(rows):
        for c, (text, bbox) in enumerate(row):
            clean = (text or "").strip()
            if not clean:
                continue
            blocks.append(
                ParsedBlock(
                    page_number=page_number,
                    block_index=idx,
                    text=clean,
                    char_start=0,
                    char_end=0,
                    bbox=bbox,
                    block_type=normalize_block_type("table_cell"),
                    row_index=r,
                    col_index=c,
                    row_span=1,
                    col_span=1,
                    is_header=r < header_rows,
                )
            )
            idx += 1
    return blocks


def _rect_overlaps(
    a: tuple[float, float, float, float], b: tuple[float, float, float, float]
) -> bool:
    """True if rects ``a`` and ``b`` overlap (fitz coords, x0<x1, y0<y1)."""
    ax0, ay0, ax1, ay1 = a
    bx0, by0, bx1, by1 = b
    return not (ax1 <= bx0 or bx1 <= ax0 or ay1 <= by0 or by1 <= ay0)


def _table_to_rows(table: Any) -> tuple[list[list[tuple[str, dict[str, float]]]], int]:
    """Convert a fitz Table to (row-major (text, bbox) grid, header_rows).

    Cell bboxes come from ``table.rows[r].cells`` (a tuple per column, or None
    for a gap); text from ``table.extract()``. When a cell rect is None the
    table-level bbox is used as a fallback so the block still has a box.
    """
    grid = table.extract()  # list[list[str | None]]
    table_bbox = _bbox_from_rect(tuple(table.bbox))
    rows: list[list[tuple[str, dict[str, float]]]] = []
    for r, trow in enumerate(table.rows):
        out_row: list[tuple[str, dict[str, float]]] = []
        cells = list(trow.cells)
        ncols = max(len(cells), len(grid[r]) if r < len(grid) else 0)
        for c in range(ncols):
            text = grid[r][c] if (r < len(grid) and c < len(grid[r])) else ""
            rect = cells[c] if (c < len(cells) and cells[c] is not None) else None
            bbox = _bbox_from_rect(tuple(rect)) if rect is not None else dict(table_bbox)
            out_row.append((text or "", bbox))
        rows.append(out_row)
    # fitz: header.external means the header is a separate row ABOVE table.rows;
    # otherwise the header is row 0 of table.rows. We only mark in-grid headers.
    header = getattr(table, "header", None)
    header_rows = (
        0 if (header is not None and getattr(header, "external", False)) else (1 if rows else 0)
    )
    return rows, header_rows


class PymupdfParser(DocumentParser):
    """DocumentParser implementation backed by PyMuPDF (fitz)."""

    def parse(self, pdf_bytes: bytes) -> list[ParsedBlock]:
        doc = fitz.open(stream=pdf_bytes, filetype="pdf")
        try:
            # Pass 1: per page, defensively convert tables + collect text blocks
            # (dropping text that overlaps a SUCCESSFULLY converted table so the
            # cells own that text). Gather span sizes for the heading heuristic.
            per_page: dict[int, dict[str, Any]] = {}
            all_sizes: list[float] = []

            for page_index in range(doc.page_count):
                page = doc.load_page(page_index)
                page_number = page_index + 1

                try:
                    found = list(page.find_tables().tables)
                except Exception:  # find_tables is best-effort; never fail the parse
                    found = []
                # Convert each table defensively: a malformed table is skipped
                # (its text stays as paragraphs) rather than aborting the parse.
                converted: list[tuple[tuple[float, float, float, float], list[Any], int]] = []
                for table in found:
                    try:
                        rows, header_rows = _table_to_rows(table)
                    except Exception:
                        continue
                    if rows:
                        converted.append((tuple(table.bbox), rows, header_rows))
                table_rects = [rect for rect, _r, _h in converted]

                raw_blocks = page.get_text("dict").get("blocks", [])
                text_blocks: list[dict[str, Any]] = []
                image_blocks: list[dict[str, Any]] = [
                    b for b in raw_blocks if b.get("type") == 1 and b.get("bbox")
                ]
                for block in raw_blocks:
                    if block.get("type", 0) != 0:  # 0 = text block
                        continue
                    if not _block_text(block):
                        continue
                    if any(_rect_overlaps(tuple(block["bbox"]), tr) for tr in table_rects):
                        continue  # a converted table's cells carry this text
                    text_blocks.append(block)
                    s = _block_max_size(block)
                    if s > 0:
                        all_sizes.append(s)

                per_page[page_number] = {
                    "text": text_blocks,
                    "tables": converted,
                    "images": image_blocks,
                }

            if (
                not all_sizes
                and not any(p["tables"] for p in per_page.values())
                and not any(p["images"] for p in per_page.values())
            ):
                raise ValueError("PymupdfParser produced no text blocks")

            median = sorted(all_sizes)[len(all_sizes) // 2] if all_sizes else 0.0

            # Pass 2: interleave text + tables per page in reading order (top-y,
            # then x) and assign a single monotonic block_index per page.
            blocks: list[ParsedBlock] = []
            for page_index in range(doc.page_count):
                page_number = page_index + 1
                data = per_page.get(page_number, {"text": [], "tables": [], "images": []})

                entries: list[tuple[float, float, str, Any]] = []
                for block in data["text"]:
                    x0, y0, x1, y1 = block["bbox"]
                    entries.append((float(y0), float(x0), "text", block))
                for rect, rows, header_rows in data["tables"]:
                    tx0, ty0, tx1, ty1 = rect
                    entries.append((float(ty0), float(tx0), "table", (rows, header_rows)))
                for img in data.get("images", []):
                    ix0, iy0, ix1, iy1 = img["bbox"]
                    entries.append((float(iy0), float(ix0), "figure", img))
                entries.sort(key=lambda e: (e[0], e[1]))

                idx = 0
                for _y, _x, kind, payload in entries:
                    if kind == "text":
                        text = _block_text(payload)
                        x0, y0, x1, y1 = payload["bbox"]
                        size = _block_max_size(payload)
                        is_heading = (
                            median > 0
                            and size >= median * _HEADING_SIZE_RATIO
                            and len(text) <= _HEADING_MAX_CHARS
                        )
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
                                block_type=normalize_block_type(
                                    "heading" if is_heading else "paragraph"
                                ),
                            )
                        )
                        idx += 1
                    elif kind == "table":
                        rows, header_rows = payload
                        cell_blocks = build_table_cell_blocks(
                            rows=rows,
                            header_rows=header_rows,
                            page_number=page_number,
                            start_index=idx,
                        )
                        blocks.extend(cell_blocks)
                        idx += len(cell_blocks)
                    elif kind == "figure":
                        x0, y0, x1, y1 = payload["bbox"]
                        blocks.append(
                            ParsedBlock(
                                page_number=page_number,
                                block_index=idx,
                                text="",
                                char_start=0,
                                char_end=0,
                                bbox={
                                    "x": float(x0),
                                    "y": float(y0),
                                    "width": float(x1 - x0),
                                    "height": float(y1 - y0),
                                },
                                block_type=normalize_block_type("figure"),
                            )
                        )
                        idx += 1

            if not blocks:
                # ``blocks`` here can hold figures / table cells with no text,
                # so this is "no blocks at all", not "no text blocks".
                raise ValueError("PymupdfParser produced no blocks")
            return assign_char_offsets_to_blocks(blocks)
        finally:
            doc.close()
