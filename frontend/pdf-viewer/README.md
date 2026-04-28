# @prumo/pdf-viewer

Modular, headless PDF viewer for the Prumo research platform.

## Status

**Phase 2b shipped.** The module is at full parity with the legacy viewer
on the load/render/scroll/zoom/search axes. The next milestone — Phase 3
(Citation API + ExtractionEvidence integration) — is **blocked on database
schema items** described in
[`docs/superpowers/specs/2026-04-28-pdf-viewer-database-requirements.md`](../../docs/superpowers/specs/2026-04-28-pdf-viewer-database-requirements.md).

Currently exposed:

- **Headless core (Phase 1a):** `PDFSource`, `PDFRect`, `PDFTextRange`, `Citation`,
  `PDFEngine`, `ViewerState`, `createViewerStore(initial?)`, `<ViewerProvider>`,
  `useViewerStore<T>(selector)`, `useViewerStoreApi()`.
- **Engine (Phase 1b):** `PdfJsEngineImpl` against pdfjs-dist v5 — load,
  render with `AbortSignal`, text content with char offsets + bboxes.
- **Primitives + UI shell (Phase 2a):** `Viewer.Root` / `Body` / `Pages` /
  `Page` compound primitives, `CanvasLayer`, `<Toolbar>`,
  `<NavigationControls>`, `<ZoomControls>`, `<LoadingState>`, `<ErrorState>`,
  `useDocumentLoader`, `usePageHandle`, all-in-one `<PrumoPdfViewer>`.
- **TextLayer + search (Phase 2b):** real pdfjs-dist v5 `TextLayer` rendered
  above each page; per-document search service with WeakMap text cache;
  case / whole-word options; `<SearchBar>` UI with Cmd/Ctrl+F, Enter /
  Shift+Enter / Esc shortcuts.
- **Domain adapter:** `articleFileSource(articleId)` resolves an article
  to a lazy `PDFSource` via Supabase Storage signed URL.

Multi-instance is verified: two `<ViewerProvider>`s on the same page have
fully isolated state.

**Not yet:** IntersectionObserver-driven currentPage sync on scroll
(stubbed with TODO in `Viewer.Body`), thumbnails, citation rendering
(Phase 3), W3C annotations (Phase 4), reader view (Phase 5).

The refactor plan files:

| Phase | Plan filename | Status |
|---|---|---|
| 0 | `2026-04-28-pdf-viewer-phase0-foundation.md` | Shipped |
| 1a | `2026-04-28-pdf-viewer-phase1a-core-types-store.md` | Shipped |
| 1b | `2026-04-28-pdf-viewer-phase1b-pdfjs-engine.md` | Shipped |
| 2a | `2026-04-28-pdf-viewer-phase2a-primitives-ui.md` | Shipped |
| 2b | `2026-04-28-pdf-viewer-phase2b-textlayer-search.md` | Shipped |
| 3 | `2026-XX-XX-pdf-viewer-phase3-citation-api.md` | Pending — DB blocker |
| 4 | `2026-XX-XX-pdf-viewer-phase4-annotations.md` | Pending — schema coordination |
| 5 | `2026-XX-XX-pdf-viewer-phase5-reader-view-cleanup.md` | Pending |

## Architecture (target — end of Phase 5)

```
@prumo/pdf-viewer/
├── core/             — PDFEngine interface, store factory, primitives
├── engines/pdfjs/    — concrete PDF.js v5 implementation
├── engines/pdfium/   — (reserved) future PDFium-WASM implementation
├── plugins/          — toolbar, search, zoom, nav, virtualization,
│                       thumbnails, annotations, ai-citations, region-capture
└── ui/               — opt-in shadcn-style toolbar components
```

Engine swappable behind `PDFEngine`. State per-instance (Zustand factory + Context). Plugins tree-shakable.

## Importing

```ts
import {
  createViewerStore,
  ViewerProvider,
  useViewerStore,
  useViewerStoreApi,
} from '@prumo/pdf-viewer';
import type {
  ViewerState,
  PDFSource,
  Citation,
  PDFEngine,
} from '@prumo/pdf-viewer';
```

Multi-instance use:

```tsx
function TwoViewers() {
  return (
    <>
      <ViewerProvider><LeftViewer /></ViewerProvider>
      <ViewerProvider><RightViewer /></ViewerProvider>
    </>
  );
}
```

This README will continue to expand with consumer-facing API documentation as Phase 1b+ ships.
