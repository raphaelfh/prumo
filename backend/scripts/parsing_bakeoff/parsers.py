"""Candidate parser runners for the bake-off.

Each runner is a thin wrapper that turns a PDF path into a ``ParseRun`` (the
predictions the scorer consumes). Real parser libraries are **lazy-imported**
inside ``available()``/``parse()`` so that a missing dependency disables one
runner without breaking the rest of the sweep — and so this module imports
with zero heavy deps for unit testing.

Wiring status:
* ``StubParser`` — fully working; used by tests and ``--dry-run``.
* ``LlamaParseRunner`` — grounded against the documented ``llama_cloud`` API
  (agentic tier + granular bounding boxes); needs ``LLAMA_CLOUD_API_KEY`` and
  egresses to a cloud API (non-PHI / BAA only).
* ``DoclingRunner`` / ``MinerURunner`` / ``OpenDataLoaderRunner`` — the
  ``available()`` import check is real; the lib-output → ``ParseRun`` mapping
  is the documented integration point, wired when the lib is installed during
  the actual Phase 0 run (we do not fabricate an unverified API here).
"""

from __future__ import annotations

import contextlib
import importlib.util
import os
import statistics
from dataclasses import dataclass, field
from typing import Protocol, runtime_checkable

from parsing_bakeoff.scoring import Box


@dataclass
class ParseRun:
    """One parser's predictions for one document, plus cost/latency."""

    pred_regions: list[Box] = field(default_factory=list)
    pred_cells: list[str] = field(default_factory=list)
    pred_sections: list[str] = field(default_factory=list)
    pred_references: list[str] = field(default_factory=list)
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


@dataclass
class DoclingRunner:
    name: str = "docling"

    def available(self) -> bool:
        return _installed("docling")

    def parse(self, pdf_path: str) -> ParseRun:
        import time

        from docling.document_converter import DocumentConverter
        from docling_core.types.doc import TableItem

        started = time.perf_counter()
        doc = DocumentConverter().convert(pdf_path).document
        regions: list[Box] = []
        cells: list[str] = []
        sections: list[str] = []
        for item, _level in doc.iterate_items():
            for prov in getattr(item, "prov", None) or []:
                bb = prov.bbox  # min/abs → positive extent regardless of coord origin
                regions.append(
                    Box(min(bb.l, bb.r), min(bb.t, bb.b), abs(bb.r - bb.l), abs(bb.t - bb.b))
                )
            if isinstance(item, TableItem):
                cells.extend(
                    c.text.strip() for c in item.data.table_cells if getattr(c, "text", "").strip()
                )
            else:
                label = getattr(getattr(item, "label", None), "value", "")
                if label in ("section_header", "title"):
                    text = getattr(item, "text", "").strip()
                    if text:
                        sections.append(text)
        return ParseRun(
            pred_regions=regions,
            pred_cells=cells,
            pred_sections=sections,
            pred_references=[],
            elapsed_s=time.perf_counter() - started,
            est_cost_usd=0.0,
        )


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

    Cloud API → egress. Use only for non-PHI projects or under a BAA /
    self-hosted LlamaCloud. Needs ``LLAMA_CLOUD_API_KEY``.
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
        import time

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
    """Fast, self-hosted baseline using PyMuPDF (fitz). No model downloads, no
    egress. Native per-block bboxes; tables via PyMuPDF's ``find_tables``;
    headings by a font-size/bold heuristic. A useful lower bound — strong on
    text + bboxes, weak on complex table structure (the rule-based tier in the
    research). Install with ``uv pip install pymupdf`` (single wheel)."""

    name: str = "pymupdf"

    def available(self) -> bool:
        return _installed("pymupdf") or _installed("fitz")

    def parse(self, pdf_path: str) -> ParseRun:
        import time

        import fitz  # PyMuPDF

        started = time.perf_counter()
        regions: list[Box] = []
        cells: list[str] = []
        sections: list[str] = []
        sizes: list[float] = []

        with fitz.open(pdf_path) as doc:
            # Pass 1: span-size distribution → a body-text baseline.
            for page in doc:
                for block in page.get_text("dict").get("blocks", []):
                    for line in block.get("lines", []):
                        for span in line.get("spans", []):
                            if span.get("text", "").strip():
                                sizes.append(float(span["size"]))
            body_size = statistics.median(sizes) if sizes else 0.0

            # Pass 2: blocks (bboxes + heading heuristic) + table cells.
            for page in doc:
                for block in page.get_text("dict").get("blocks", []):
                    if block.get("type") != 0:
                        continue  # image block
                    x0, y0, x1, y1 = block["bbox"]
                    regions.append(Box(x0, y0, x1 - x0, y1 - y0))
                    parts: list[str] = []
                    max_size = 0.0
                    bold = False
                    for line in block.get("lines", []):
                        for span in line.get("spans", []):
                            parts.append(span.get("text", ""))
                            max_size = max(max_size, float(span.get("size", 0)))
                            bold = bold or bool(int(span.get("flags", 0)) & 16)
                    text = " ".join(p for p in parts if p).strip()
                    if text and len(text) <= 120 and (max_size >= body_size * 1.15 or bold):
                        sections.append(text)
                with contextlib.suppress(Exception):  # find_tables is best-effort
                    for table in page.find_tables().tables:
                        for row in table.extract():
                            cells.extend(str(c).strip() for c in row if c and str(c).strip())

        return ParseRun(
            pred_regions=regions,
            pred_cells=cells,
            pred_sections=sections,
            pred_references=[],
            elapsed_s=time.perf_counter() - started,
            est_cost_usd=0.0,
        )


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
        import time

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
