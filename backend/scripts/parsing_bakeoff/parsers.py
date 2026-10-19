"""Candidate parser runners for the bake-off.

Each runner is a thin wrapper that turns a PDF path into a ``ParseRun`` (the
predictions the scorer consumes). Real parser libraries are **lazy-imported**
inside ``available()``/``parse()`` so that a missing dependency disables one
runner without breaking the rest of the sweep — and so this module imports
with zero heavy deps for unit testing.

Wiring status:
* ``StubParser`` — fully working; used by tests and ``--dry-run``.
* ``PyMuPDFRunner`` / ``DoclingRunner`` — measure the app's own parsers
  (``app.infrastructure.parsing``) followed by the ingest normalization pass,
  i.e. exactly the blocks ingest stores.
* ``LlamaParseRunner`` — grounded against the documented ``llama_cloud`` API
  (agentic tier + granular bounding boxes); needs ``LLAMA_CLOUD_API_KEY`` and
  egresses to a cloud API; needs ``LLAMA_CLOUD_API_KEY``.
* ``MinerURunner`` / ``OpenDataLoaderRunner`` — the
  ``available()`` import check is real; the lib-output → ``ParseRun`` mapping
  is the documented integration point, wired when the lib is installed during
  the actual Phase 0 run (we do not fabricate an unverified API here).
"""

from __future__ import annotations

import importlib.util
import os
import time
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Protocol, runtime_checkable

from parsing_bakeoff.scoring import Block, Box

if TYPE_CHECKING:
    from app.infrastructure.parsing.base import DocumentParser, ParsedBlock


@dataclass
class ParseRun:
    """One parser's predictions for one document, plus cost/latency."""

    pred_regions: list[Box] = field(default_factory=list)
    pred_cells: list[str] = field(default_factory=list)
    pred_sections: list[str] = field(default_factory=list)
    pred_references: list[str] = field(default_factory=list)
    #: Stored blocks in reading order (page, then block index).
    blocks: list[Block] = field(default_factory=list)
    #: Page height in points per 1-indexed page (chrome bands).
    page_heights: dict[int, float] = field(default_factory=dict)
    elapsed_s: float = 0.0
    est_cost_usd: float = 0.0
    error: str | None = None


class ParserNotWiredError(NotImplementedError):
    """The lib is importable but its output→ParseRun mapping is not yet wired.

    Carries the exact next step so a Phase-0 operator (with the lib installed)
    knows where to finish the integration.
    """


@runtime_checkable
class BakeoffParser(Protocol):
    name: str

    def available(self) -> bool:
        """True when this runner can actually run (lib importable / key set)."""

    def parse(self, pdf_path: str) -> ParseRun:  # noqa: ARG002 - port signature; arg unused in stub/unwired runners
        """Parse one PDF into predictions. Should set ``error`` rather than
        raise for *expected* per-document failures (e.g. an OCR miss); may
        raise for programmer errors (unavailable runner)."""


def _installed(module: str) -> bool:
    return importlib.util.find_spec(module) is not None


@dataclass
class StubParser:
    """Deterministic parser for tests and ``--dry-run``. Returns ``preset``
    (or an empty run) for every document — proves the plumbing end to end."""

    name: str = "stub"
    preset: ParseRun = field(default_factory=ParseRun)

    def available(self) -> bool:
        return True

    def parse(self, pdf_path: str) -> ParseRun:  # noqa: ARG002 - port signature; arg unused in stub/unwired runners
        return self.preset


def run_from_parsed_blocks(
    parsed: list[ParsedBlock],
    page_heights: dict[int, float],
    *,
    elapsed_s: float,
    bottom_left_origin: bool = False,
) -> ParseRun:
    """Map app ``ParsedBlock``s to a ``ParseRun``: blocks in reading order with
    top-left boxes, regions from every block, cells from ``table_cell`` blocks
    and sections from ``heading`` blocks. ``bottom_left_origin`` flips a
    parser's bottom-left boxes using the page height."""
    blocks: list[Block] = []
    for pb in sorted(parsed, key=lambda b: (b.page_number, b.block_index)):
        bb = pb.bbox
        y = bb["y"]
        if bottom_left_origin:
            y = page_heights.get(pb.page_number, 0.0) - (bb["y"] + bb["height"])
        box = Box(bb["x"], y, bb["width"], bb["height"])
        blocks.append(Block(pb.page_number, pb.text, pb.block_type, box))
    return ParseRun(
        pred_regions=[b.box for b in blocks],
        pred_cells=[b.text for b in blocks if b.block_type == "table_cell" and b.text],
        pred_sections=[b.text for b in blocks if b.block_type == "heading" and b.text],
        pred_references=[],
        blocks=blocks,
        page_heights=page_heights,
        elapsed_s=elapsed_s,
        est_cost_usd=0.0,
    )


def _page_heights(pdf_bytes: bytes) -> dict[int, float]:
    import fitz  # PyMuPDF

    with fitz.open(stream=pdf_bytes, filetype="pdf") as doc:
        return {i + 1: float(page.rect.height) for i, page in enumerate(doc)}


def _run_app_parser(
    parser: DocumentParser, pdf_path: str, *, bottom_left_origin: bool = False
) -> ParseRun:
    """Time ``parse`` + the ingest normalization pass on one PDF (what ingest stores)."""
    from app.infrastructure.parsing.base import normalize_blocks

    with open(pdf_path, "rb") as fh:
        pdf_bytes = fh.read()
    started = time.perf_counter()
    parsed = normalize_blocks(parser.parse(pdf_bytes))
    elapsed = time.perf_counter() - started
    return run_from_parsed_blocks(
        parsed,
        _page_heights(pdf_bytes),
        elapsed_s=elapsed,
        bottom_left_origin=bottom_left_origin,
    )


@dataclass
class DoclingRunner:
    """The app's ``DoclingParser`` (OCR off, TableFormer FAST, CPU). Its boxes
    keep docling's bottom-left origin, so they are flipped for the chrome band."""

    name: str = "docling"

    def available(self) -> bool:
        return _installed("docling")

    def parse(self, pdf_path: str) -> ParseRun:
        from app.infrastructure.parsing.docling_parser import DoclingParser

        return _run_app_parser(DoclingParser(), pdf_path, bottom_left_origin=True)


@dataclass
class MinerURunner:
    name: str = "mineru"

    def available(self) -> bool:
        return _installed("magic_pdf") or _installed("mineru")

    def parse(self, pdf_path: str) -> ParseRun:  # noqa: ARG002 - port signature; arg unused in stub/unwired runners
        raise ParserNotWiredError(
            "MinerURunner: install MinerU (`magic_pdf`) and map its middle-JSON "
            "(blocks + bboxes per page) → ParseRun here. GPU recommended."
        )


@dataclass
class OpenDataLoaderRunner:
    name: str = "opendataloader"

    def available(self) -> bool:
        return _installed("opendataloader_pdf") or _installed("opendataloader")

    def parse(self, pdf_path: str) -> ParseRun:  # noqa: ARG002 - port signature; arg unused in stub/unwired runners
        raise ParserNotWiredError(
            "OpenDataLoaderRunner: install OpenDataLoader-PDF and map its block "
            "output (the tool named in the 2026-04-28 spec) → ParseRun here."
        )


@dataclass
class LlamaParseRunner:
    """LlamaParse (LlamaCloud) agentic tier with granular bounding boxes.

    Cloud API → egress. Needs ``LLAMA_CLOUD_API_KEY``.
    """

    name: str = "llamaparse"
    tier: str = "agentic"
    # LlamaParse: $1.25 per 1000 credits; this runner pins the agentic tier
    # (10 cr/page) -> $0.0125/page (~$0.19 per 15-page paper). Other tiers:
    # fast 1cr, cost-effective 3cr, agentic-plus 45cr. Refine from the real bill.
    est_cost_per_page_usd: float = 0.0125

    def available(self) -> bool:
        return _installed("llama_cloud") and bool(os.environ.get("LLAMA_CLOUD_API_KEY"))

    def parse(self, pdf_path: str) -> ParseRun:  # noqa: ARG002 - port signature; arg unused in stub/unwired runners  # pragma: no cover - needs network+key
        from llama_cloud import LlamaCloud  # lazy: not a unit-test dep

        client = LlamaCloud()  # reads LLAMA_CLOUD_API_KEY
        started = time.perf_counter()
        uploaded = client.files.create(file=pdf_path, purpose="parse")
        result = client.parsing.parse(
            file_id=uploaded.id,
            tier=self.tier,
            version="latest",
            output_options={"granular_bboxes": ["word", "line", "cell"]},
            expand=["markdown", "items"],
        )
        elapsed = time.perf_counter() - started
        # Map result.items (+ the granular-bbox JSONL sidecar) → ParseRun.
        # Exact field names are confirmed against the SDK at run time; kept
        # behind this single call so the rest of the harness is lib-agnostic.
        regions, cells, sections, refs, pages = _map_llamaparse_result(result)
        return ParseRun(
            pred_regions=regions,
            pred_cells=cells,
            pred_sections=sections,
            pred_references=refs,
            elapsed_s=elapsed,
            est_cost_usd=pages * self.est_cost_per_page_usd,
        )


def _map_llamaparse_result(result: object):  # noqa: ARG001 - mapping filled in during the real run
    """Map a LlamaParse result → (regions, cells, sections, refs, n_pages).

    Isolated so the SDK-shape coupling lives in exactly one place; filled in
    against the live SDK during the Phase 0 run.
    """
    raise ParserNotWiredError(
        "LlamaParseRunner: finish the result→ParseRun mapping against the live "
        "llama_cloud SDK (items tree + granular-bbox JSONL sidecar)."
    )


@dataclass
class PyMuPDFRunner:
    """The app's ``PymupdfParser`` (the free default ingest parser): block
    bboxes, chrome typing, column-aware reading order, ``find_tables`` cells.
    No model downloads, no egress."""

    name: str = "pymupdf"

    def available(self) -> bool:
        return _installed("pymupdf") or _installed("fitz")

    def parse(self, pdf_path: str) -> ParseRun:
        from app.infrastructure.parsing.pymupdf_parser import PymupdfParser

        return _run_app_parser(PymupdfParser(), pdf_path)


def _sections_from_markdown(md: str) -> list[str]:
    """ATX headings (``# …``) → heading text."""
    out: list[str] = []
    for line in md.splitlines():
        s = line.strip()
        if s.startswith("#"):
            heading = s.lstrip("#").strip()
            if heading:
                out.append(heading)
    return out


def _cells_from_markdown(md: str) -> list[str]:
    """Cells from GitHub-style pipe tables; separator rows (``---``) skipped."""
    out: list[str] = []
    for line in md.splitlines():
        s = line.strip()
        if s.count("|") < 2:
            continue
        cells = [c.strip() for c in s.strip("|").split("|")]
        is_separator = bool(cells) and all(c and set(c) <= set("-: ") for c in cells)
        if is_separator:
            continue
        out.extend(c for c in cells if c)
    return out


@dataclass
class MarkItDownRunner:
    """Microsoft MarkItDown — converts a PDF (pdfminer under the hood) to
    Markdown for LLM prep. No bboxes; tables/headings only as far as they
    surface in the emitted Markdown. A fast, text-oriented convenience baseline.
    Install with ``uv pip install "markitdown[pdf]"``."""

    name: str = "markitdown"

    def available(self) -> bool:
        return _installed("markitdown")

    def parse(self, pdf_path: str) -> ParseRun:
        from markitdown import MarkItDown

        started = time.perf_counter()
        result = MarkItDown().convert(pdf_path)
        md = getattr(result, "markdown", None) or getattr(result, "text_content", "") or ""
        return ParseRun(
            pred_regions=[],  # MarkItDown emits Markdown text, no coordinates
            pred_cells=_cells_from_markdown(md),
            pred_sections=_sections_from_markdown(md),
            pred_references=[],
            elapsed_s=time.perf_counter() - started,
            est_cost_usd=0.0,
        )


#: name → factory. ``--dry-run`` uses StubParser instead of these.
REGISTRY: dict[str, type] = {
    "pymupdf": PyMuPDFRunner,
    "markitdown": MarkItDownRunner,
    "docling": DoclingRunner,
    "mineru": MinerURunner,
    "opendataloader": OpenDataLoaderRunner,
    "llamaparse": LlamaParseRunner,
}
