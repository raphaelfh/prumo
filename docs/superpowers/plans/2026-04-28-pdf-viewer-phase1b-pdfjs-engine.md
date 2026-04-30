# PDF Viewer — Phase 1b: PDF.js engine

> **Status:** Shipped — commit [`4e83da6`](../../../).
>
> Retrospective record. The implementation was completed before this plan
> file was authored; this document captures the contract that landed so a
> future agent reading the roadmap doesn't think Phase 1b is still pending.

**Goal:** Implement the `PDFEngine` interface defined in Phase 1a against
`pdfjs-dist` v5, exposing `PDFDocumentHandle` / `PDFPageHandle` with metadata,
outline, page rendering (AbortSignal-aware), and text content with character
offsets and PDF user-space bboxes.

**Predecessor:** Phase 1a (Headless Core).
**Successor:** Phase 2a (compound primitives).

---

## What shipped

### Files created

| Path | Purpose |
|---|---|
| `frontend/pdf-viewer/engines/pdfjs/index.ts` | `PdfJsEngineImpl` — wires worker on import, returns `PdfJsDocumentHandle` |
| `frontend/pdf-viewer/engines/pdfjs/document.ts` | `PdfJsDocumentHandle` — numPages, fingerprint, outline, getPage |
| `frontend/pdf-viewer/engines/pdfjs/page.ts` | `PdfJsPageHandle` — render, getTextContent (returns char offsets + bboxes), renderTextLayer |
| `frontend/pdf-viewer/engines/pdfjs/source.ts` | `sourceToGetDocumentParams` — `PDFSource` ⇒ pdfjs `getDocument` params |
| `frontend/pdf-viewer/__fixtures__/three-page.pdf` | 3-page synthetic fixture for tests |
| `frontend/pdf-viewer/__tests__/engine.test.ts` | 7 engine smoke tests against the fixture |

### Files modified

| Path | Change |
|---|---|
| `frontend/pdf-viewer/core/engine.ts` | `render()` uses `opts.signal` (AbortSignal) for cancellation instead of returning a `cancel()` callback |
| `.gitignore` | (small adjustment) |

---

## Interface refinement

The Phase 1a contract had `RenderResult.cancel()`. Phase 1b switched
cancellation to `RenderOptions.signal: AbortSignal`, aligning with the
standard fetch / Web API pattern. Backwards-incompatible at the type level
but no consumers existed yet (Phase 2a was the first consumer).

## Worker configuration

`frontend/pdf-viewer/engines/pdfjs/index.ts` sets
`pdfjs.GlobalWorkerOptions.workerSrc = PDF_WORKER_SRC` on module load.
Idempotent — re-imports are harmless. Removes the previous side-effect from
`frontend/lib/pdf-config.ts`.

## Test setup quirk

`react-pdf` bundles `pdfjs-dist` v5.4 which uses `DOMMatrix` at module
init — not available in jsdom. The test runner uses the **legacy** build
of `pdfjs-dist` as a worker shim. Production code uses the regular build.

---

## Checklist (✅ all shipped)

- [x] `PdfJsEngineImpl` implements `PDFEngine` (load, destroy)
- [x] `PdfJsDocumentHandle` implements `PDFDocumentHandle` (numPages, fingerprint, getPage, metadata, outline)
- [x] `PdfJsPageHandle` implements `PDFPageHandle` (render with AbortSignal, getTextContent with char offsets + bboxes)
- [x] `PDFSource` discriminated union (`url` | `data` | `lazy`) → `getDocument` params
- [x] `RenderResult.cancel()` removed; replaced with `RenderOptions.signal`
- [x] 7 engine smoke tests against `three-page.pdf` fixture
- [x] Worker config moved into engine module (no more side-effect import in `pdf-config.ts`)

## Multi-instance demo (not shipped here)

The original Phase 1b plan called for a multi-instance smoke demo (two
`<ViewerProvider>`s loading different PDFs concurrently). That demo was
not built; the multi-instance guarantee is covered by the Phase 1a store
isolation test at `frontend/pdf-viewer/__tests__/store.test.ts`. Follow-up
if a UX demo is desired: add a story under `frontend/pdf-viewer/__demo__/`.
