"""Deterministic two-column PDF builder for the PyMuPDF golden test.

Fixed A4 page size, the base-14 ``helv`` font, fixed sizes and ``insert_textbox``
only; no metadata, no document id, no timestamps or randomness, so two builds
are byte-equal.

Four pages, so each of the two alternating running heads (odd / even pages)
appears on two pages and is typed chrome by the repeat rule.

U+200B cannot be encoded in a base-14 font, so the DOI line is written with a
``~`` placeholder and page 1's ``helv`` font gets a one-entry ``/ToUnicode``
CMap mapping ``~`` to U+200B; extraction then yields the zero-width space as a
real PDF with an embedded font would. No other text in the fixture uses ``~``.
"""

from __future__ import annotations

import fitz  # PyMuPDF

_PAGE_W, _PAGE_H = 595, 842
_PAGES = 4
_FONT = "helv"
_LEFT = (50, 290)
_RIGHT = (305, 545)
_FULL = (50, 545)
_ZW_PLACEHOLDER = "~"
_ZW_TO_UNICODE = (
    b"/CIDInit /ProcSet findresource begin 12 dict begin begincmap "
    b"/CMapName /ZeroWidth def "
    b"/CIDSystemInfo <</Registry (Adobe) /Ordering (UCS) /Supplement 0>> def "
    b"1 begincodespacerange <00> <FF> endcodespacerange "
    b"1 beginbfchar <7E> <200B> endbfchar "
    b"endcmap CMapName currentdict /CMap defineresource pop end end"
)


def _box(page: fitz.Page, x: tuple[int, int], y0: float, y1: float, text: str, size: float) -> None:
    rect = fitz.Rect(x[0], y0, x[1], y1)
    overflow = page.insert_textbox(rect, text, fontname=_FONT, fontsize=size)
    if overflow < 0:  # the builder must never silently truncate a sentence
        raise ValueError(f"text does not fit its box: {text!r}")


def _column_text(side: str, page: int, slot: str) -> str:
    return (
        f"{side}-{page}-{slot} This sentence belongs to the {side.lower()} column "
        f"of page {page}, slot {slot}, and reads as one paragraph."
    )


def _map_placeholder_to_zero_width(doc: fitz.Document, page: fitz.Page) -> None:
    font_xref = next(f[0] for f in page.get_fonts() if f[4] == _FONT)
    cmap_xref = doc.get_new_xref()
    doc.update_object(cmap_xref, "<<>>")
    doc.update_stream(cmap_xref, _ZW_TO_UNICODE, compress=False)
    doc.xref_set_key(font_xref, "ToUnicode", f"{cmap_xref} 0 R")


def build_two_column_pdf() -> bytes:
    doc = fitz.open()
    for page_number in range(1, _PAGES + 1):
        page = doc.new_page(width=_PAGE_W, height=_PAGE_H)
        head = "Short Title et al." if page_number % 2 else "J Test Med 2026"
        _box(page, _FULL, 30, 48, head, 8)
        _box(page, (280, 320), 812, 830, str(page_number), 8)

        y = 80.0
        if page_number == 1:
            _box(page, _FULL, y, y + 35, "A Two Column Golden Fixture Title For Reading Order", 18)
            y += 45
            _box(
                page,
                _FULL,
                y,
                y + 60,
                "ABSTRACT This full-width abstract spans both columns and must be "
                "read before either column of the first page begins.",
                10,
            )
            y += 80

        for slot in ("a", "b", "c"):
            _box(page, _LEFT, y, y + 70, _column_text("LEFT", page_number, slot), 10)
            _box(page, _RIGHT, y + 5, y + 75, _column_text("RIGHT", page_number, slot), 10)
            y += 100

        if page_number == 1:
            doi = f"doi:10.{_ZW_PLACEHOLDER}1000/{_ZW_PLACEHOLDER}test"
            _box(page, _LEFT, y, y + 20, doi, 10)
            _box(page, _LEFT, y + 40, y + 60, "Age ........ 54", 10)
            _map_placeholder_to_zero_width(doc, page)

    doc.set_metadata({})
    data = doc.tobytes(garbage=0, deflate=False, no_new_id=True)
    doc.close()
    return data
