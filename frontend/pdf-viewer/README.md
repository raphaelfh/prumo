# @prumo/pdf-viewer

Modular, headless PDF viewer for the Prumo research platform.

## Status

**Phase 2** — React rendering layer on top of PdfJsEngine. The package now
exposes (in addition to everything in Phase 1):

### Phase 2 additions

- **Compound primitives**: `Viewer.Root`, `Viewer.Body`, `Viewer.Pages`, `Viewer.Page`
- **CanvasLayer**: Renders each page to a `<canvas>` via the engine with
  AbortSignal-aware re-render on scale/rotation change and DPR-aware sharpness
- **TextLayer**: Stub — full text-selection/highlight implementation comes with
  the search plugin in the next dispatch
- **UI components**: `<Toolbar>`, `<NavigationControls>`, `<ZoomControls>`,
  `<LoadingState>`, `<ErrorState>` — matching the project's shadcn style
- **Hooks**: `useDocumentLoader`, `usePageHandle`
- **`<PrumoPdfViewer>`**: High-level all-in-one component for the common case
  (mount, load, render, continuous scroll, prev/next, zoom)

Core flow (load → render → continuous scroll → prev/next → zoom) is at parity
with the legacy viewer. Search and thumbnails come in the next dispatch.

**Phase 1 (still active):** Headless core types and per-instance store.

- Type definitions: `PDFSource`, `PDFRect`, `PDFTextRange`, `Citation`,
  `PDFEngine` (interface only — no implementation yet), `ViewerState`.
- Runtime: `createViewerStore(initial?)` factory, `<ViewerProvider>`,
  `useViewerStore<T>(selector)`, `useViewerStoreApi()`.
- `pdfJsEngine` concrete implementation (Phase 1b)

Multi-instance is verified: two `<ViewerProvider>`s on the same page have
fully isolated state.

**Not yet:** IntersectionObserver-driven currentPage sync on scroll (stubbed
with TODO), TextLayer (stubbed), search plugin (Phase 2b), thumbnails,
citation rendering (Phase 3), annotations (Phase 4), reader view (Phase 5).

The full refactor is split across the following plans (one per subsystem):

| Phase | Plan filename | Title |
|---|---|---|
| 0 | `2026-04-28-pdf-viewer-phase0-foundation.md` | Foundation: stack upgrade + scaffolding |
| 1a | `2026-04-28-pdf-viewer-phase1a-core-types-store.md` | Headless core: types + store factory |
| 1b | `2026-XX-XX-pdf-viewer-phase1b-pdfjs-engine.md` | PDF.js engine + multi-instance demo |
| 2a | `2026-XX-XX-pdf-viewer-phase2a-plugins-primitives.md` | Plugin system + compound primitives |
| 2b | `2026-XX-XX-pdf-viewer-phase2b-plugin-migration.md` | Plugin migration (zoom/search/nav/virt/thumbnails) |
| 3 | `2026-XX-XX-pdf-viewer-phase3-citation-api.md` | Citation API + ExtractionEvidence integration |
| 4 | `2026-XX-XX-pdf-viewer-phase4-annotations.md` | W3C annotations + Recogito (blocked on schema coordination) |
| 5 | `2026-XX-XX-pdf-viewer-phase5-reader-view-cleanup.md` | Reader view + a11y + legacy cleanup |

Filenames marked `XX-XX` are placeholder dates — set when each plan is written.

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
