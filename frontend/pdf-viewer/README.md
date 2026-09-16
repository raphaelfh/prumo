---
status: stable
last_reviewed: 2026-09-15
owner: '@raphaelfh'
---

# @prumo/pdf-viewer

The PDF viewer on the extraction and quality-assessment screens: pdf.js pages
with a text layer and find-in-document, plus a parsed-text (markdown) reader.

## Public API

Imported through the `@prumo/pdf-viewer` alias (`index.ts`); nothing else is exported.

| Export | Use |
|---|---|
| `PrumoPdfViewer` | The all-in-one viewer: toolbar, search, canvas pages, reader mode. |
| `createViewerStore()` | A fresh, isolated store. Pass it as `store` to share it with a sibling panel. |
| `subscribeReaderLocate(store, listener)` | React to citation-locate requests outside the viewer. |
| `articleFileSourceFromStorageKey(key)` | A lazy `PDFSource` that signs a Supabase Storage URL on first load. |
| `type ViewerState` | The store's state. |

`@/pdf-viewer/core` (engine-free) also exports `ViewerProvider`, for a parent
that owns the store without importing pdf.js.

## Modules

```text
frontend/pdf-viewer/
├── core/          store, context, state, engine interface, rotation helpers, pageText
├── engines/pdfjs/ pdfjs-dist 6: load, page render, text layer
├── engines/mock/  in-memory engine for tests
├── viewport/      usePageLayout, useVirtualPages, zoomMath, useGestureZoom, useZoomShortcuts, useFitWidth
├── hooks/         useDocumentLoader, usePageHandle, usePageScrollSync (PageLocator)
├── primitives/    Viewer, CanvasLayer, TextLayer, Reader and its helpers
├── markdown/      the reader's markdown rendering
├── services/      searchService (canvas find-in-document, over core/pageText)
├── adapters/      articleFileSource
├── ui/            Toolbar (rotate view), ZoomControls (fit width), NavigationControls, SearchBar, states
└── index.ts       the public API above
```

## Pages and scrolling

`viewport/usePageLayout.ts` computes every page's position from page sizes
alone. Page 1 is read at load; the rest are estimated from it until they mount.
`Viewer.Pages` mounts only the pages in and next to the viewport
(`@tanstack/react-virtual`). The page ⇄ scroll sync asks a `PageLocator`
where pages are — the layout for canvas pages, the DOM for the reader — so
navigating to a page that is not mounted still scrolls there.

## Rotation

A page handle's `rotation` is the PDF's own `/Rotate`, and its `size` is the
size the page displays at, so a landscape table page is landscape. The store's
`viewRotation` (toolbar: Rotate view) turns every page on top of that. Draw with
`effectiveRotation(page, viewRotation)` and size boxes with `displayedSize`
(`core/rotation.ts`).

## Zoom

`zoom` in the store is the committed zoom (`MIN_ZOOM` 0.25 – `MAX_ZOOM` 4,
`viewport/zoomMath.ts`). A pinch or ctrl/⌘ + wheel previews its zoom as a
transform on the page column, keeps the content under the pointer in place,
and commits once the gesture ends (`useGestureZoom`, adapted from Lector). The
toolbar and ⌘/Ctrl `=`/`+` and `-` step by `ZOOM_STEP`; those shortcuts only
act while the pointer or focus is inside the viewer.

Every document opens at fit width (`useFitWidth`): the widest page fills the
viewer and keeps filling it as the viewer resizes, until a manual zoom. The
zoom toolbar's Fit width button and ⌘/Ctrl `0` turn it back on.
