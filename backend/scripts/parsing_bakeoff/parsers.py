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

import importlib.util
import os
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

    def parse(self, pdf_path: str) -> ParseRun:  # noqa: ARG002 - port signature; arg unused in stub/unwired runners
        # Entry point: docling.document_converter.DocumentConverter().convert(pdf_path)
        # → result.document, which carries layout items + bboxes per page.
        raise ParserNotWiredError(
            "DoclingRunner: install `docling` and map DocumentConverter output "
            "(texts/tables with prov bboxes) → ParseRun here."
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
    # Public LlamaParse list pricing is ~$0.003/page (cost-mode) and higher for
    # the agentic tier; treat as an estimate, refined from the real bill.
    est_cost_per_page_usd: float = 0.03

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


#: name → factory. ``--dry-run`` uses StubParser instead of these.
REGISTRY: dict[str, type] = {
    "docling": DoclingRunner,
    "mineru": MinerURunner,
    "opendataloader": OpenDataLoaderRunner,
    "llamaparse": LlamaParseRunner,
}
