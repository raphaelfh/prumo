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
├── core/          store, context, state, engine interface, rotation helpers
├── engines/pdfjs/ pdfjs-dist 6: load, page render, text layer
├── engines/mock/  in-memory engine for tests
├── hooks/         useDocumentLoader, usePageHandle, usePageScrollSync
├── primitives/    Viewer, CanvasLayer, TextLayer, Reader and its helpers
├── markdown/      the reader's markdown rendering
├── services/      searchService (canvas find-in-document)
├── adapters/      articleFileSource
├── ui/            Toolbar, NavigationControls, ZoomControls, SearchBar, states
└── index.ts       the public API above
```

## Rotation

A page handle's `rotation` is the PDF's own `/Rotate`, and its `size` is the
size the page displays at, so a landscape table page is landscape. The store's
`viewRotation` (toolbar: Rotate view) turns every page on top of that. Draw with
`effectiveRotation(page, viewRotation)` and size boxes with `displayedSize`
(`core/rotation.ts`).
